"""Read an existing configuration.nix and work out what it actually sets.

Nix is a full programming language, so this does not try to evaluate anything.
It asks Nix itself to parse the file (`nix-instantiate --parse`), which returns
a normalised, fully-parenthesised form with comments stripped and `a.b.c = x`
expanded into nested attribute sets. Walking that is far more reliable than
running regexes over the original source.

If Nix is not on PATH the same walker runs over the raw file instead; that
copes with ordinary hand-written configs but not with anything clever.

Nothing here writes to the user's file.
"""

import os
import re
import shutil
import subprocess
import tempfile

# `_module` is internal bookkeeping and never appears in a hand-written file.
SKIP_KEYS = {"_module"}

# These describe the module's structure rather than a system setting. They are
# not options, so they cannot be matched against the catalogue, but dropping
# them breaks the build: without `imports`, hardware-configuration.nix never
# gets loaded and fileSystems has no device or fsType.
MODULE_KEYS = {"imports", "options", "disabledModules"}

# Wrappers that only annotate a value's priority; the value inside is the
# interesting part.
PRIORITY_CALLS = re.compile(
    r"^\(?\(?(?:lib\.|\(lib\)\.)?mk(?:Force|Default|Override\s+\S+|VMOverride)\)?\s+(.*)\)?$",
    re.S)


class NixSyntaxError(ValueError):
    pass


# ------------------------------------------------------------------ scanning

def _skip_ws(s, i):
    while i < len(s):
        c = s[i]
        if c in " \t\r\n":
            i += 1
        elif c == "#":
            while i < len(s) and s[i] != "\n":
                i += 1
        elif s.startswith("/*", i):
            end = s.find("*/", i + 2)
            i = len(s) if end < 0 else end + 2
        else:
            break
    return i


def _skip_string(s, i):
    """i points at the opening quote. Returns the index just past the close."""
    if s.startswith("''", i):
        i += 2
        while i < len(s):
            if s.startswith("'''", i) or s.startswith("''$", i) or s.startswith("''\\", i):
                i += 3
            elif s.startswith("''", i):
                return i + 2
            elif s.startswith("${", i):
                i = _skip_balanced(s, i + 1) 
            else:
                i += 1
        raise NixSyntaxError("unterminated '' string")
    i += 1  # opening "
    while i < len(s):
        c = s[i]
        if c == "\\":
            i += 2
        elif s.startswith("${", i):
            i = _skip_balanced(s, i + 1)
        elif c == '"':
            return i + 1
        else:
            i += 1
    raise NixSyntaxError("unterminated string")


def _skip_balanced(s, i):
    """i points at an opening bracket. Returns the index just past its match."""
    pairs = {"{": "}", "[": "]", "(": ")"}
    close = pairs[s[i]]
    depth = 0
    while i < len(s):
        c = s[i]
        if c in pairs:
            depth += 1
            i += 1
        elif c in "}])":
            depth -= 1
            i += 1
            if depth == 0:
                return i
        elif c in "\"'" and (c == '"' or s.startswith("''", i)):
            i = _skip_string(s, i)
        elif c == "#" or s.startswith("/*", i):
            i = _skip_ws(s, i)
        else:
            i += 1
    raise NixSyntaxError("unbalanced " + close)


# A `with …` or `let …` that has not been closed off yet, sitting at the end of
# the value collected so far.
_PENDING_CLAUSE = re.compile(r"(^|[\s(])(with|let)\s+[^;]*$")


def _split_attrs(body):
    """Split an attribute-set body into (key, value_text) pairs."""
    out = []
    i = 0
    while True:
        i = _skip_ws(body, i)
        if i >= len(body):
            return out

        if body.startswith("inherit", i) and not body[i + 7:i + 8].isalnum():
            i = body.find(";", i)
            if i < 0:
                return out
            i += 1
            continue

        # key, possibly dotted and possibly quoted
        key_start = i
        while i < len(body):
            c = body[i]
            if c == '"':
                i = _skip_string(body, i)
            elif c == "$" and body.startswith("${", i):
                i = _skip_balanced(body, i + 1)
            elif c == "=" and not body.startswith("==", i):
                break
            elif c == ";":
                break
            else:
                i += 1
        if i >= len(body) or body[i] != "=":
            return out
        key = body[key_start:i].strip()
        i += 1

        val_start = i
        while i < len(body):
            c = body[i]
            if c in "{[(":
                i = _skip_balanced(body, i)
            elif c == '"' or body.startswith("''", i):
                i = _skip_string(body, i)
            elif c == "#" or body.startswith("/*", i):
                i = _skip_ws(body, i)
            elif c == ";":
                # `with pkgs; [ … ]` and `let … ;  … in …` both put a semicolon
                # at depth zero without ending the value. Nix's own normalised
                # output parenthesises these, but the fallback reader sees the
                # file as written.
                if _PENDING_CLAUSE.search(body[val_start:i]):
                    i += 1
                    continue
                break
            else:
                i += 1
        out.append((key, body[val_start:i].strip()))
        i += 1


def _split_list(body):
    """Split a list body into element texts.

    `[ foo(bar) ]` is two elements and `[ a."b" ]` is one — Nix's own parser
    says so. The difference matters because these elements get sorted: cutting
    `rubyPackages."http_parser.rb"` in two left `rubyPackages.` behind, which
    reads like a name and is not valid Nix.
    """
    out = []
    i = 0
    while True:
        i = _skip_ws(body, i)
        if i >= len(body):
            return out
        start = i
        c = body[i]
        if c in "{[(":
            i = _skip_balanced(body, i)
        elif c == '"' or body.startswith("''", i):
            i = _skip_string(body, i)
        else:
            while i < len(body) and body[i] not in " \t\r\n([{":
                # A quote ends the element unless it is an attribute hanging
                # off the selection so far, as in `rubyPackages."…"`.
                if body[i] == '"':
                    if body[i - 1] != ".":
                        break
                    i = _skip_string(body, i)
                    continue
                i += 1
        out.append(body[start:i].strip())


# ------------------------------------------------------------- normalisation

# Nix rejects a file that defines one attribute twice, and it does so in the
# parser — `{ a = { b = 1; }; a.b = 1; }` never reaches evaluation. That is a
# whole file refused over one repeated line, and refusing it is the wrong
# answer here: the rest of it is the user's settings, and nixgen is the tool
# that can show them the clash. So this one error falls back to reading the
# file directly instead of giving up. Nothing else does — a real syntax error
# still stops the import, because guessing at a broken file is how a generated
# file ends up quietly wrong.
_ALREADY_DEFINED = re.compile(r"attribute '([^']+)' already defined")


def normalise(text):
    """Hand the file to Nix and take back its canonical form.

    Returns (source, used_nix, tmpdir, duplicate) — `duplicate` is the
    attribute path Nix found twice, when that is why we fell back.
    """
    nix = shutil.which("nix-instantiate")
    if not nix:
        return text, False, None, None
    tmpdir = tempfile.mkdtemp(prefix="nixgen-")
    tmp = os.path.join(tmpdir, "configuration.nix")
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
    try:
        proc = subprocess.run([nix, "--parse", tmp], capture_output=True, text=True, timeout=30)
        if proc.returncode != 0:
            msg = (proc.stderr or "").replace(tmp, "configuration.nix").strip()
            dup = _ALREADY_DEFINED.search(msg)
            if dup:
                return text, False, None, dup.group(1)
            raise NixSyntaxError(msg[:600] or "nix could not parse this file")
        return proc.stdout, True, tmpdir, None
    except subprocess.TimeoutExpired:
        return text, False, None, None
    finally:
        os.unlink(tmp)
        os.rmdir(tmpdir)


def _module_body(src):
    """Find the attribute set the module actually returns."""
    i = _skip_ws(src, 0)
    # unwrap the outer parens Nix adds, the `{ config, ... }:` header, and
    # any number of enclosing `let ... in`
    while i < len(src):
        if src[i] == "(":
            end = _skip_balanced(src, i)
            inner = src[i + 1:end - 1]
            if inner.strip():
                src, i = inner, _skip_ws(inner, 0)
                continue
        if src.startswith("let", i) and not src[i + 3:i + 4].isalnum():
            j = src.find(" in ", i)
            if j < 0:
                break
            i = _skip_ws(src, j + 4)
            continue
        if src[i] == "{":
            end = _skip_balanced(src, i)
            after = _skip_ws(src, end)
            if after < len(src) and src[after] == ":":
                i = _skip_ws(src, after + 1)   # that brace was the argument list
                continue
            return src[i + 1:end - 1]
        # a bare `arg: body` header
        m = re.match(r"[A-Za-z_][\w'-]*\s*:", src[i:])
        if m:
            i = _skip_ws(src, i + m.end())
            continue
        break
    raise NixSyntaxError("could not find the module's attribute set")


# ------------------------------------------------------------- value mapping

_ATOM = re.compile(r"^\(*\s*(.*?)\s*\)*$", re.S)


def _unparen(v):
    v = v.strip()
    while v.startswith("(") and v.endswith(")"):
        try:
            if _skip_balanced(v, 0) == len(v):
                v = v[1:-1].strip()
                continue
        except NixSyntaxError:
            pass
        break
    return v


# Nix's normalised output parenthesises every atom and every selection base.
# None of that is needed in the file we write back out.
_PAREN_SEL = re.compile(r"\(([A-Za-z_][\w'-]*)\)\.")
_PAREN_ATOM = re.compile(
    r"\((\d+(?:\.\d+)?"                          # numbers, but see below
    r"|true|false|null"                          # keywords
    r"|[A-Za-z_][\w.'-]*"                        # identifiers and selections
    r"|\.{0,2}/[\w./+~-]*|~/[\w./+~-]*"          # path literals
    r'|"(?:[^"\\]|\\.)*")\)'                    # simple strings
)
# The sign is deliberately not in that pattern. `[ (-1) ]` parses and `[ -1 ]`
# does not, so a negative number keeps its parentheses. Nix's own output never
# reaches here as `(-1)` — it comes back as `(__sub 0 1)` — but the fallback
# reader works on the raw source, where the literal form is what is there.


# Nix has no negative literal. `-5` goes in and `(__sub 0 5)` comes back out,
# which parses and means the same thing but is not what anyone wrote. Carried
# text is meant to be recognisable as your own line, so it is turned back.
_NEG_CALL = re.compile(r"\(__sub\s+0\s+(\d+(?:\.\d+)?)\)")
_DOUBLED_NEG = re.compile(r"\(\((-\d+(?:\.\d+)?)\)\)")


def _undo_parens(expr):
    """Collapse the parentheses Nix's normalised output adds.

    `python313Packages.requests` comes back as `((python313Packages).requests)`.
    Only the head of a selection is wrapped, however long the chain, so one
    pass would do for a single value; the loop is for shapes nested inside one
    another.
    """
    out = expr
    for _ in range(6):
        prev = out
        out = _PAREN_SEL.sub(r"\1.", out)
        out = _PAREN_ATOM.sub(r"\1", out)
        if out == prev:
            break
    # After the loop: the brackets a negative number needs are put on here,
    # and `_PAREN_ATOM` above is the reason they survive — it deliberately
    # does not match a signed number.
    out = _NEG_CALL.sub(r"(-\1)", out)
    return _DOUBLED_NEG.sub(r"(\1)", out)


def tidy(expr):
    """Undo the redundant parentheses Nix adds, leaving valid Nix behind."""
    return _wrap_list(_unparen(_undo_parens(" ".join(expr.split()))))


_LIST_EXPR = re.compile(r"^(with\s+[\w.]+\s*;\s*)?\[(.*)\]$", re.S)


def _wrap_list(expr, indent="  "):
    """Put one element per line once a list gets long.

    An imported `environment.systemPackages` can run to hundreds of characters
    on one line, which is unreadable and produces a useless diff.
    """
    m = _LIST_EXPR.match(expr.strip())
    if not m:
        return expr
    prefix = (m.group(1) or "").strip()
    try:
        items = _split_list(m.group(2))
    except NixSyntaxError:
        return expr
    if len(items) < 4 and len(expr) < 72:
        return expr
    head = (prefix + " " if prefix else "") + "["
    body = "".join(f"\n{indent}  {it}" for it in items)
    return f"{head}{body}\n{indent}]"


# A package name in the shapes it arrives in: `firefox`,
# `python313Packages.requests`, `rubyPackages."http_parser.rb"`. The quoted
# alternative earns its place — a segment that had to be quoted can hold a dot
# of its own, so this must not be a plain `[\w.'-]+`. What goes back out is
# `nixgen_core.render_package`, which is stricter; this only has to recognise.
_PKG_SEG = r"""(?:[\w'-]+|"[^"\\]*")"""
_PKG_NAME = re.compile(_PKG_SEG + r"(?:\." + _PKG_SEG + r")*")
_PKG_QUALIFIED = re.compile(r"pkgs\.(" + _PKG_SEG + r"(?:\." + _PKG_SEG + r")*)")


_ESCAPES = {"n": "\n", "r": "\r", "t": "\t"}


def unescape(s):
    """Undo the escapes inside a Nix `"…"` string.

    Nix's rules, not Python's. `codecs`' unicode_escape was doing this before
    and got two things wrong: it decodes UTF-8 bytes as latin-1, so `日本語`
    came back as mojibake and any accented word with it; and it invents
    escapes Nix does not have — `\\u0041` is the five characters `u0041` in a
    Nix string, not `A`. Nix turns `\\n`, `\\r` and `\\t` into control
    characters and everything else after a backslash into itself.
    """
    out, i = [], 0
    while i < len(s):
        if s[i] == "\\" and i + 1 < len(s):
            out.append(_ESCAPES.get(s[i + 1], s[i + 1]))
            i += 2
        else:
            out.append(s[i])
            i += 1
    return "".join(out)


def classify(value):
    """Turn a value expression into ('kind', python_value) or ('raw', text)."""
    # _undo_parens before _unparen: the brackets Nix puts round a
    # negative number are what tells `(-5)` from a subtraction, and
    # stripping the outer pair first would throw that away.
    v = _unparen(_undo_parens(value))

    m = PRIORITY_CALLS.match(v)
    if m:
        v = _unparen(m.group(1))

    if v in ("true", "false"):
        return "bool", v == "true"
    if v == "null":
        return "null", None
    if re.fullmatch(r"-?\d+", v):
        return "int", int(v)
    if re.fullmatch(r"-?\d+\.\d+", v):
        return "float", float(v)

    if v.startswith('"') and v.endswith('"') and "${" not in v:
        try:
            if _skip_string(v, 0) == len(v):
                out = unescape(v[1:-1])
                return ("lines" if "\n" in out else "str"), out
        except NixSyntaxError:
            pass

    if v.startswith("''") and v.endswith("''") and "${" not in v:
        return "lines", v[2:-2].strip("\n")

    # `with pkgs; [ ... ]` and plain lists of packages
    wm = re.match(r"^with\s+pkgs\s*;\s*(\[.*\])$", v, re.S)
    scope = None
    if wm:
        scope, v = "pkgs", _unparen(wm.group(1))

    if v.startswith("[") and v.endswith("]"):
        items = [_unparen(_undo_parens(x)) for x in _split_list(v[1:-1])]
        kinds = [classify(x) for x in items]
        if scope == "pkgs":
            names = [x for x in items if _PKG_NAME.fullmatch(x)]
            if len(names) == len(items):
                return "packages", names
        if all(k in ("str", "int", "bool", "float") for k, _ in kinds):
            return "list", [val for _, val in kinds]
        if all(_PKG_QUALIFIED.fullmatch(x) for x in items):
            return "packages", [_PKG_QUALIFIED.fullmatch(x).group(1) for x in items]
        return "raw", value.strip()

    m = _PKG_QUALIFIED.fullmatch(v)
    if m:
        return "package", m.group(1)

    if v.startswith("{") and v.endswith("}"):
        return "attrs", v

    return "raw", value.strip()


# ----------------------------------------------------------------- flattening

def _expand_key(key):
    """`services."my host".root` -> ['services', 'my host', 'root']"""
    parts, buf, i = [], "", 0
    while i < len(key):
        c = key[i]
        if c == '"':
            end = _skip_string(key, i)
            parts.append(key[i + 1:end - 1])
            buf = ""
            i = end
        elif c == ".":
            if buf.strip():
                parts.append(buf.strip())
            buf = ""
            i += 1
        else:
            buf += c
            i += 1
    if buf.strip():
        parts.append(buf.strip())
    return parts


def flatten(body, prefix=()):
    """Yield (dotted_path, value_text) for every leaf assignment."""
    for key, value in _split_attrs(body):
        path = prefix + tuple(_expand_key(key))
        if path[0] in SKIP_KEYS:
            continue
        kind, _ = classify(value)
        if kind == "attrs":
            inner = _unparen(value)
            yield from flatten(inner[1:-1], path)
        else:
            yield path, value


def strip_self_import(source, filename="generated.nix"):
    """Drop a reference to the file we are about to write.

    Importing a configuration.nix that already said
    `imports = [ ./hardware-configuration.nix ./generated.nix ]` used to carry
    that line straight into generated.nix, which then imported itself. The
    module system does not notice; it just recurses until

        error: stack overflow; max-call-depth exceeded

    which gives no clue where the problem is. So cut it here instead.
    """
    body = _unparen(source)
    if not (body.startswith("[") and body.endswith("]")):
        return source, False
    items = _split_list(body[1:-1])
    kept = [x for x in items if not _unparen(x).rstrip("/").endswith("/" + filename)]
    if len(kept) == len(items):
        return source, False
    return ("[ " + " ".join(kept) + " ]") if kept else "[ ]", True


def sort_list_expr(expr):
    """Alphabetise the elements of `[ … ]` or `with pkgs; [ … ]`, keeping any
    element the form could not model (an override call, say) in place among
    the rest."""
    from nixgen_core import sort_key
    m = _LIST_EXPR.match(expr.strip())
    if not m:
        return expr
    prefix = (m.group(1) or "").strip()
    try:
        items = _split_list(m.group(2))
    except NixSyntaxError:
        return expr
    if len(items) < 2:
        return expr
    body = " ".join(sorted(items, key=sort_key))
    return _wrap_list((prefix + " " if prefix else "") + "[ " + body + " ]")


def read_config(text):
    """Main entry point. Returns (entries, used_nix, notes, duplicate)."""
    src, used_nix, tmpdir, duplicate = normalise(text)
    body = _module_body(src)
    entries, notes = [], []
    stray = False

    def restore_paths(expr):
        nonlocal stray
        if not tmpdir:
            return expr
        out = expr.replace(tmpdir + "/", "./")
        if "/nixgen-" in out:
            stray = True
        return out

    for segments, value in flatten(body):
        kind, parsed = classify(value)
        entries.append({
            "segments": list(segments),
            "path": ".".join(segments),
            "kind": kind,
            "value": parsed,
            "source": restore_paths(tidy(value)),
            "structural": segments[0] in MODULE_KEYS,
        })
    if duplicate:
        # The form holds one card per attribute, and the file held two. Nix
        # itself has no answer for which wins — it refuses the file — so the
        # last one written is taken, the way a reader going down the page
        # would, and the notice tells them to look at that card. Leaving both
        # would hand back a file as unbuildable as the one that came in.
        seen = {}
        for e in entries:
            seen[e["path"]] = e
        entries = list(seen.values())
    if stray:
        notes.append("A relative path pointed outside the file's own directory and "
                     "could not be restored — check any ../ paths by hand.")
    if not used_nix and not duplicate:
        notes.append("nix-instantiate was not available, so the file was read directly. "
                     "Unusual syntax may have been missed.")
    return entries, used_nix, notes, duplicate
