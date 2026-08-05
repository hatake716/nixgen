#!/usr/bin/env python3
"""Local web server for nixgen. Standard library only — no pip, no npm."""

import argparse
import datetime
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from nixgen_core import parse_type, render_module  # noqa: E402
from nix_import import read_config, NixSyntaxError  # noqa: E402
from starter import starter_files  # noqa: E402

DB_PATH = None
STATIC = os.path.join(HERE, "static")


# --------------------------------------------------------------------- search

_TOKEN = re.compile(r"[A-Za-z0-9_.<>-]+")


def fts_query(raw):
    """Build a safe FTS5 MATCH expression: every token becomes a prefix term."""
    tokens = _TOKEN.findall(raw or "")
    if not tokens:
        return None
    return " AND ".join('"%s"*' % t.replace('"', '') for t in tokens)


def db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def search_options(q, limit=60, only_supported=False):
    """Tiered ranking.

    Search *is* the product here — 24k options are unusable without a good
    order — so results are bucketed by how the query matched the path, then
    broken by depth, then by whether the leaf is `.enable`, then by how
    prominent the top-level namespace is. Whole-segment matching does most of
    the work: it is what separates networking.firewall from services.firewalld
    and time.timeZone from services.sogo.timezone.
    """
    con = db()
    match = fts_query(q)
    cols = ("o.path, o.type_str, o.supported, o.default_txt, o.description, o.has_slot")
    tail = "o.depth, NOT o.is_enable, o.ns_rank, length(o.path), o.path"

    if not match:
        rows = con.execute(
            f"SELECT {cols} FROM options o "
            f"{'WHERE o.supported = 1' if only_supported else ''} "
            f"ORDER BY {tail} LIMIT ?", (limit,)).fetchall()
        con.close()
        return [dict(r) for r in rows]

    tokens = _TOKEN.findall(q)
    qs = q.strip()
    in_path = " AND ".join(["o.path LIKE ?"] * len(tokens))
    # A "segment" hit means the word is a whole dot-delimited part of the path:
    # networking.firewall.enable matches "firewall", services.firewalld does not.
    as_segment = " AND ".join(["('.' || o.path || '.') LIKE ?"] * len(tokens))
    where = "AND o.supported = 1" if only_supported else ""

    sql = f"""
    SELECT {cols}
    FROM options_fts f JOIN options o ON o.rowid = f.rowid
    WHERE options_fts MATCH ? {where}
    ORDER BY (CASE
                WHEN o.path = ?    THEN 0   -- the whole path was typed
                WHEN o.path LIKE ? THEN 1   -- path starts with what was typed
                WHEN {as_segment}  THEN 2   -- every word is a whole path segment
                WHEN o.path GLOB ? THEN 3   -- last word is the leaf, same case
                WHEN {in_path}     THEN 4   -- every word appears in the path
                ELSE 5 END),                -- only the description matched
             {tail}
    LIMIT ?"""
    params = ([match, qs, qs + "%"]
              + ["%." + t + ".%" for t in tokens]
              + ["*." + tokens[-1]]
              + ["%" + t + "%" for t in tokens] + [limit])
    rows = con.execute(sql, params).fetchall()
    con.close()
    return [dict(r) for r in rows]


def search_packages(q, limit=60):
    """Attribute-name matches beat description matches: someone typing "fish
    shell" wants the `fish` package, not everything described as fish-like."""
    con = db()
    match = fts_query(q)
    if not match:
        rows = con.execute(
            "SELECT attr, version, description, unfree, broken FROM packages "
            "ORDER BY attr LIMIT ?", (limit,)).fetchall()
        con.close()
        return [dict(r) for r in rows]

    tokens = _TOKEN.findall(q)
    qs = q.strip()
    first = tokens[0]
    sql = """
    SELECT p.attr, p.version, p.description, p.unfree, p.broken
    FROM packages_fts f JOIN packages p ON p.rowid = f.rowid
    WHERE packages_fts MATCH ?
    ORDER BY (CASE
                WHEN p.attr = ?      THEN 0
                WHEN p.attr = ?      THEN 1
                WHEN p.attr LIKE ?   THEN 2
                WHEN p.attr LIKE ?   THEN 3
                ELSE 4 END),
             p.broken, p.attr NOT GLOB '[a-z]*',
             length(p.attr), p.attr
    LIMIT ?"""
    params = (match, qs, first, first + "%", "%" + first + "%", limit)
    rows = con.execute(sql, params).fetchall()
    con.close()
    return [dict(r) for r in rows]


def get_option(path):
    con = db()
    row = con.execute("SELECT * FROM options WHERE path = ?", (path,)).fetchone()
    con.close()
    if not row:
        return None
    out = dict(row)
    out["type"] = json.loads(out.pop("type_json"))
    return out


def get_meta():
    con = db()
    rows = con.execute("SELECT key, value FROM meta").fetchall()
    con.close()
    return {r["key"]: r["value"] for r in rows}


# --------------------------------------------------------------------- import

def match_option(segments):
    """Find the catalogue option for a path taken from someone's config.

    Catalogue paths carry placeholders (`services.nginx.virtualHosts.<name>.root`)
    where a real config has a name, so an exact lookup is tried first and then
    a segment-by-segment comparison that lets placeholders absorb one segment
    each. Returns (row, slot_values)."""
    con = db()
    joined = ".".join(segments)
    row = con.execute("SELECT * FROM options WHERE path = ?", (joined,)).fetchone()
    if row:
        con.close()
        return dict(row), []

    cands = con.execute(
        "SELECT * FROM options WHERE has_slot = 1 AND depth = ? AND path LIKE ?",
        (len(segments) - 1, segments[0] + ".%")).fetchall()
    con.close()

    for c in cands:
        parts = c["path"].split(".")
        if len(parts) != len(segments):
            continue
        slots, ok = [], True
        for want, got in zip(parts, segments):
            if want.startswith("<") or want == "*":
                slots.append(got)
            elif want != got:
                ok = False
                break
        if ok:
            return dict(c), slots
    return None, []


def _unwrap_attrs(node):
    """Peel nullable wrappers to see whether an option is a free-form attrs."""
    while node["kind"] == "nullable":
        node = node["inner"]
    return node if node["kind"] == "attrs" else None


def match_attrs_prefix(segments):
    """`environment.variables.EDITOR` is not an option; `environment.variables`
    is, and it is an attribute set. Walk back until a prefix matches one."""
    for cut in range(len(segments) - 1, 0, -1):
        prefix, rest = segments[:cut], segments[cut:]
        # go through match_option so `systemd.user.services.<name>.environment`
        # is reachable from `systemd.user.services.dropbox.environment`
        row, slots = match_option(prefix)
        if not row:
            continue
        node = json.loads(row["type_json"])
        inner = node
        for _ in rest:
            inner = _unwrap_attrs(inner)
            if inner is None:
                break
            inner = inner["inner"]
        if inner is not None:
            return row, rest, inner, slots
    return None, [], None, []


def nest(keys, value):
    for k in reversed(keys):
        value = {k: value}
    return value


def deep_merge(a, b):
    """Two lines writing into the same attribute set become one attribute set.
    `environment.sessionVariables.X` and `.Y` must not emit two assignments."""
    if isinstance(a, dict) and isinstance(b, dict):
        out = dict(a)
        for k, v in b.items():
            out[k] = deep_merge(out[k], v) if k in out else v
        return out
    return b


_SCALARS = {"str", "lines", "path", "enum"}


def to_widget_value(node, kind, value, source):
    """Fit an imported value onto the option's widget. (ok, value)."""
    k = node["kind"]

    if k == "nullable":
        if kind == "null":
            return True, {"__null": True, "v": None}
        ok, v = to_widget_value(node["inner"], kind, value, source)
        return (True, {"__null": False, "v": v}) if ok else (False, None)

    if k == "raw":
        return True, source
    if kind == "raw":
        return False, None          # a real widget cannot hold an expression

    if k == "bool":
        return (True, value) if kind == "bool" else (False, None)
    if k in ("int", "float"):
        return (True, value) if kind in ("int", "float") else (False, None)
    if k in _SCALARS:
        return (True, value) if kind in ("str", "lines") else (False, None)
    if k == "package":
        return (True, value) if kind in ("package", "str") else (False, None)

    if k == "list":
        inner = node["inner"]["kind"]
        if kind == "packages":
            return (True, value) if inner == "package" else (False, None)
        if kind == "list":
            if inner in _SCALARS or inner in ("bool", "int", "float"):
                return True, value
        return False, None

    return False, None


def _why_unknown(segments):
    """A path can be missing because the option was renamed or removed, or
    because it lives inside a free-form submodule this tool cannot see into."""
    con = db()
    for cut in range(len(segments) - 1, 0, -1):
        row = con.execute("SELECT path, type_str FROM options WHERE path = ?",
                          (".".join(segments[:cut]),)).fetchone()
        if row:
            con.close()
            return f"{row['path']} exists but is free-form ({row['type_str']}), " \
                   f"so its keys are not in the catalogue."
    n = con.execute("SELECT count(*) FROM options WHERE path LIKE ?",
                    (segments[0] + ".%",)).fetchone()[0]
    con.close()
    if n:
        return "No such option in this release — it may have been renamed or removed."
    return "Unknown top-level attribute for this release."


def import_config(text):
    entries, used_nix, notes = read_config(text)
    matched, expression, unknown, structure = [], [], [], []
    by_option = {}

    for e in entries:
        if e.get("structural"):
            # imports / options / disabledModules are module structure, not
            # settings. They are copied through untouched: without `imports`
            # the rest of the system config never gets loaded.
            structure.append({
                "path": e["path"], "segments": e["segments"],
                "source": e["source"], "preview": e["source"][:160],
                "note": "verbatim — module structure",
            })
            continue
        row, slots = match_option(e["segments"])
        rest, leaf_node = [], None
        if not row:
            row, rest, leaf_node, slots = match_attrs_prefix(e["segments"])
        if not row:
            unknown.append({
                "path": e["path"], "segments": e["segments"],
                "source": e["source"], "preview": e["source"][:160],
                "why": _why_unknown(e["segments"]),
                "note": "verbatim — not an option in this release",
            })
            continue

        node = json.loads(row["type_json"])
        if rest:
            ok, inner_value = to_widget_value(leaf_node, e["kind"], e["value"], e["source"])
            value = nest(rest, inner_value) if ok else None
            if ok and node["kind"] == "nullable":
                value = {"__null": False, "v": value}
        else:
            ok, value = to_widget_value(node, e["kind"], e["value"], e["source"])
        if not ok:
            # The form cannot hold a conditional or a let-bound reference, so
            # the expression is carried over into the output untouched.
            expression.append({
                "path": e["path"], "segments": e["segments"],
                "option": row["path"], "source": e["source"],
                "preview": e["source"][:160],
                "type_str": row["type_str"], "description": row["description"],
                "note": "verbatim from your configuration.nix",
            })
            continue
        key = (row["path"], tuple(slots))
        if rest and key in by_option:
            prev = by_option[key]
            if prev["type"]["kind"] == "nullable":
                prev["value"]["v"] = deep_merge(prev["value"]["v"], value["v"])
            else:
                prev["value"] = deep_merge(prev["value"], value)
            prev["under"] = sorted(set(prev["under"]) | {rest[0]})
            continue

        entry = {
            "path": row["path"],
            "slots": slots,
            "under": rest,
            "value": value,
            "type": node,
            "type_str": row["type_str"],
            "description": row["description"],
            "default_txt": row["default_txt"],
            "example_txt": row["example_txt"],
        }
        by_option[key] = entry
        matched.append(entry)

    return {"matched": matched, "expression": expression, "unknown": unknown,
            "structure": structure, "used_nix": used_nix, "notes": notes}


# --------------------------------------------------------------------- render

def render(payload):
    entries = []
    for item in payload.get("entries", []):
        node = item.get("type") or parse_type(item.get("type_str", ""))
        entries.append({
            "path": item.get("path"),
            "segments": item.get("segments"),
            "type": node,
            "value": item.get("value"),
            "note": item.get("note"),
        })
    stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    return render_module(entries, payload.get("channel", "nixos"), stamp)


def validate(text):
    """Syntax-check with the real Nix parser when it is on PATH."""
    nix = shutil.which("nix-instantiate")
    if not nix:
        return {"ok": None, "message": "nix-instantiate not found on PATH — syntax check skipped."}
    with tempfile.NamedTemporaryFile("w", suffix=".nix", delete=False, encoding="utf-8") as fh:
        fh.write(text)
        tmp = fh.name
    try:
        proc = subprocess.run([nix, "--parse", tmp], capture_output=True, text=True, timeout=30)
        if proc.returncode == 0:
            return {"ok": True, "message": "Parses cleanly."}
        err = (proc.stderr or "").replace(tmp, "generated.nix").strip()
        return {"ok": False, "message": err[:2000]}
    except subprocess.TimeoutExpired:
        return {"ok": None, "message": "Syntax check timed out."}
    finally:
        os.unlink(tmp)


# ---------------------------------------------------------------- http plumbing

class Handler(BaseHTTPRequestHandler):
    server_version = "nixgen"

    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        raw = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False))

    def do_GET(self):
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        one = lambda k, d=None: (qs.get(k) or [d])[0]

        if u.path in ("/", "/index.html"):
            return self._file("index.html", "text/html; charset=utf-8")
        if u.path == "/app.js":
            return self._file("app.js", "text/javascript; charset=utf-8")
        if u.path == "/app.css":
            return self._file("app.css", "text/css; charset=utf-8")

        if u.path == "/api/meta":
            return self._json(get_meta())
        if u.path == "/api/search":
            kind = one("kind", "options")
            q = one("q", "")
            limit = min(int(one("limit", "60")), 200)
            if kind == "packages":
                return self._json({"results": search_packages(q, limit)})
            return self._json({"results": search_options(q, limit, one("supported") == "1")})
        if u.path == "/api/starter":
            return self._json(starter_files(
                one("host"), one("user"), one("system"),
                get_meta().get("channel", "nixos-26.05")))
        if u.path == "/api/option":
            opt = get_option(one("path", ""))
            return self._json(opt or {"error": "not found"}, 200 if opt else 404)
        return self._send(404, b"not found", "text/plain")

    def do_POST(self):
        u = urlparse(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        payload = json.loads(self.rfile.read(length) or b"{}")

        if u.path == "/api/render":
            return self._json({"text": render(payload)})
        if u.path == "/api/import":
            try:
                return self._json(import_config(payload.get("text", "")))
            except NixSyntaxError as exc:
                return self._json({"error": str(exc)}, 200)
        if u.path == "/api/validate":
            return self._json(validate(payload.get("text", "")))
        return self._send(404, b"not found", "text/plain")

    def _file(self, name, ctype):
        p = os.path.join(STATIC, name)
        if not os.path.exists(p):
            return self._send(404, b"missing asset", "text/plain")
        with open(p, "rb") as fh:
            return self._send(200, fh.read(), ctype)


def main():
    global DB_PATH
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=os.path.join(os.getcwd(), "data", "nixgen.sqlite"))
    ap.add_argument("--port", type=int, default=8823)
    # Localhost by default on purpose: there is no authentication.
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    DB_PATH = args.db
    if not os.path.exists(DB_PATH):
        sys.exit(f"index not found at {DB_PATH}\nrun ./fetch-data.sh then python3 build/build_index.py")

    url = f"http://{args.host}:{args.port}/"
    meta = get_meta()
    print(f"nixgen — {meta.get('channel')} · "
          f"{int(meta.get('option_count', 0)):,} options · "
          f"{int(meta.get('package_count', 0)):,} packages")
    print(f"serving {url}   (ctrl-c to stop)")
    if not args.no_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
