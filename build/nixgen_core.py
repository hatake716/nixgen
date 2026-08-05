"""Type-string parsing and Nix rendering for the NixOS option generator.

NixOS publishes option metadata with `type` as a *human-readable string*
("null or (list of string)"), not a structured schema.  This module turns
those strings into a small type tree so the UI can pick a widget, and turns
user values back into Nix source.
"""

import json
import re

# ---------------------------------------------------------------- type parsing

_INT_RANGES = [
    (re.compile(r"^(\d+) bit unsigned integer; between (-?\d+) and (-?\d+)"), True),
    (re.compile(r"^integer between (-?\d+) and (-?\d+)"), False),
]


def _split_top(s, sep):
    """Split on `sep` at paren/quote depth zero."""
    out, depth, buf, i, quote = [], 0, [], 0, False
    while i < len(s):
        c = s[i]
        if quote:
            buf.append(c)
            if c == "\\" and i + 1 < len(s):
                buf.append(s[i + 1])
                i += 2
                continue
            if c == '"':
                quote = False
            i += 1
            continue
        if c == '"':
            quote = True
            buf.append(c)
        elif c == "(":
            depth += 1
            buf.append(c)
        elif c == ")":
            depth -= 1
            buf.append(c)
        elif depth == 0 and s.startswith(sep, i):
            out.append("".join(buf).strip())
            buf = []
            i += len(sep)
            continue
        else:
            buf.append(c)
        i += 1
    out.append("".join(buf).strip())
    return out


def _unwrap(s):
    s = s.strip()
    while s.startswith("(") and s.endswith(")"):
        # only strip if the parens actually match each other
        depth = 0
        for i, c in enumerate(s):
            depth += (c == "(") - (c == ")")
            if depth == 0 and i < len(s) - 1:
                return s
        s = s[1:-1].strip()
    return s


def parse_type(t):
    """Return {'kind': ..., ...}. Unknown shapes fall back to kind 'raw'."""
    if not t:
        return {"kind": "raw", "label": "unknown"}
    s = _unwrap(t)

    # A free-form submodule behaves as its underlying attribute set here.
    for prefix in ("open submodule of ", "submodule of "):
        if s.startswith(prefix):
            return parse_type(s[len(prefix):])

    # nullable ----------------------------------------------------------------
    if s.startswith("null or "):
        return {"kind": "nullable", "inner": parse_type(s[len("null or "):]), "label": s}

    # union -------------------------------------------------------------------
    parts = _split_top(s, " or ")
    if len(parts) > 1:
        return {"kind": "raw", "label": s}

    # enum --------------------------------------------------------------------
    if s.startswith("one of "):
        vals = re.findall(r'"((?:[^"\\]|\\.)*)"', s[len("one of "):])
        if vals:
            return {"kind": "enum", "values": [v.encode().decode("unicode_escape") for v in vals], "label": s}

    # containers --------------------------------------------------------------
    for prefix, kind in (
        ("list of ", "list"),
        ("attribute set of ", "attrs"),
        ("lazy attribute set of ", "attrs"),
    ):
        if s.startswith(prefix):
            return {"kind": kind, "inner": parse_type(s[len(prefix):]), "label": s}

    # scalars -----------------------------------------------------------------
    if s == "boolean":
        return {"kind": "bool", "label": s}
    if s == "package":
        return {"kind": "package", "label": s}
    if s in ("path", "absolute path"):
        return {"kind": "path", "label": s}

    for rx, has_bits in _INT_RANGES:
        m = rx.match(s)
        if m:
            g = m.groups()
            lo, hi = (g[1], g[2]) if has_bits else (g[0], g[1])
            return {"kind": "int", "min": int(lo), "max": int(hi), "label": s}
    if s == "signed integer":
        return {"kind": "int", "label": s}
    if s.startswith("unsigned integer"):
        return {"kind": "int", "min": 0, "label": s}
    if s.startswith("positive integer"):
        return {"kind": "int", "min": 1, "label": s}
    if s.startswith("floating point number"):
        return {"kind": "float", "label": s}

    if s.startswith("strings concatenated"):
        return {"kind": "lines", "label": s}
    if s in ("string", "non-empty string", "single-line string",
             "string, not containing newlines", "printable string, not containing newlines",
             "string, not containing newlines or colons"):
        return {"kind": "str", "label": s}
    if s.startswith("string matching the pattern "):
        return {"kind": "str", "pattern": s[len("string matching the pattern "):], "label": s}
    if s.startswith("string") or s.startswith("non-empty string"):
        return {"kind": "str", "label": s}

    return {"kind": "raw", "label": s}


WIDGET_KINDS = {"bool", "enum", "int", "float", "str", "lines", "path", "package"}


def is_supported(node):
    """True when the type tree maps entirely onto real widgets (no raw escape)."""
    k = node["kind"]
    if k in WIDGET_KINDS:
        return True
    if k in ("nullable", "list", "attrs"):
        return is_supported(node["inner"])
    return False


# ------------------------------------------------------------- nix rendering

_ESCAPES = {"\\": "\\\\", '"': '\\"', "\n": "\\n", "\t": "\\t", "${": "\\${"}


def nix_string(s):
    out = s.replace("\\", "\\\\").replace('"', '\\"')
    out = out.replace("\n", "\\n").replace("\t", "\\t").replace("${", "\\${")
    return '"' + out + '"'


def nix_lines(s):
    body = s.replace("''", "'''").replace("${", "''${")
    indented = "\n".join("    " + ln for ln in body.split("\n"))
    return "''\n" + indented + "\n  ''"


NIX_KEYWORDS = {"assert", "else", "if", "in", "inherit", "let", "or", "rec", "then", "with"}


def nix_ident(k):
    if k in NIX_KEYWORDS:
        return nix_string(k)
    return k if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_'-]*", k) else nix_string(k)


def render_value(node, value, indent=2):
    """value comes from the UI as JSON. Returns a Nix expression string."""
    k = node["kind"]
    pad = " " * indent

    if k == "nullable":
        # The UI carries nullable values as {__null: bool, v: <inner>}; a bare
        # value or None can also arrive from an imported file.
        if value is None:
            return "null"
        if isinstance(value, dict) and "__null" in value:
            if value["__null"]:
                return "null"
            value = value.get("v")
            if value is None:
                return "null"
        return render_value(node["inner"], value, indent)

    if k == "bool":
        return "true" if value else "false"
    if k in ("int", "float"):
        # `[ -1 ]` does not parse: the minus is read as an operator.
        return f"({value})" if float(value) < 0 else str(value)
    if k == "enum" or k == "str":
        return nix_string(str(value))
    if k == "lines":
        return nix_lines(str(value))
    if k == "path":
        v = str(value).strip()
        return v if v.startswith("/") or v.startswith("./") else nix_string(v)
    if k == "package":
        v = str(value).strip()
        return v if v.startswith("pkgs.") or "." in v else "pkgs." + v

    if k == "list":
        items = value or []
        if not items:
            return "[ ]"
        rendered = [render_value(node["inner"], it, indent + 2) for it in items]
        # Package lists grow; one per line stays readable and diffs cleanly.
        inline_ok = node["inner"]["kind"] != "package" or len(rendered) == 1
        if (inline_ok and len(rendered) <= 6
                and all(len(r) < 24 and "\n" not in r for r in rendered)):
            return "[ " + " ".join(rendered) + " ]"
        body = "\n".join(f"{pad}  {r}" for r in rendered)
        return "[\n" + body + f"\n{pad}]"

    if k == "attrs":
        items = value or {}
        if not items:
            return "{ }"
        body = "\n".join(
            f"{pad}  {nix_ident(kk)} = {render_value(node['inner'], vv, indent + 2)};"
            for kk, vv in items.items()
        )
        return "{\n" + body + f"\n{pad}}}"

    # raw: user typed Nix directly
    return str(value).strip()


_SEGMENT = re.compile(r"<[^>]*>|[^.]+")


def split_path(path):
    """Split an option path on dots, treating <placeholders> as atomic."""
    return _SEGMENT.findall(path)


def render_path(segments):
    """Join segments into a Nix attribute path, quoting anything unusual."""
    return ".".join(nix_ident(s) for s in segments)


HEADER = """# Generated by nixgen — do not edit by hand.
# channel: {channel}   generated: {stamp}
#
# Import it:  imports = [ ./generated.nix ];
# Or use it in place of your configuration.nix.
# Either way keep it beside ./hardware-configuration.nix.

{{ config, lib, pkgs, ... }}:

{{
"""


def render_module(entries, channel, stamp):
    """entries: [{'path' or 'segments', 'type': {...}, 'value': ...}]

    `segments` wins when present: the UI has already substituted <name> slots
    with whatever the user typed, and those may need quoting.
    """
    out = [HEADER.format(channel=channel, stamp=stamp)]
    for e in sorted(entries, key=lambda x: x.get("path") or ".".join(x["segments"])):
        segs = e.get("segments") or split_path(e["path"])
        expr = render_value(e["type"], e["value"])
        note = e.get("note")
        tail = f"  # {note}" if note else ""
        out.append(f"  {render_path(segs)} = {expr};{tail}\n")
    out.append("}\n")
    return "".join(out)
