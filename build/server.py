#!/usr/bin/env python3
"""Local web server for nixgen. Standard library only — no pip, no npm."""

import argparse
import datetime
import errno
import gzip
import io
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from nixgen_core import (parse_type, path_names, render_module,  # noqa: E402
                         render_path, sort_key, split_path)
from nix_import import (read_config, strip_self_import, sort_list_expr,  # noqa: E402
                        NixSyntaxError)
from starter import starter_files  # noqa: E402
import releases  # noqa: E402

DB_PATH = None
STATIC = os.path.join(HERE, "static")


# Databases we know about, by release. The one named on the command line does
# not follow the nixgen-<channel>.sqlite convention, so it is recorded here at
# startup rather than found by scanning.
_KNOWN_DBS = {}


def data_dir():
    return os.path.dirname(os.path.abspath(DB_PATH))


def remember_db(path=None):
    path = path or DB_PATH
    channel = get_meta(path).get("channel")
    if channel:
        _KNOWN_DBS[channel] = path
    return channel


def switch_db(path):
    """Point every later query at another release's database."""
    global DB_PATH
    DB_PATH = path
    channel = remember_db(path)
    # Survive a restart: without this, the next launch quietly goes back to
    # whatever --db pointed at.
    if channel:
        try:
            with open(os.path.join(data_dir(), "CURRENT"), "w") as fh:
                fh.write(channel)
        except OSError:
            pass


def built_channels():
    """Releases that already have a database here, so switching is instant."""
    out = dict(_KNOWN_DBS)
    here = data_dir()
    for channel in releases.releases():
        path = releases.db_for(here, channel)
        if os.path.exists(path):
            out[channel] = path
    return out


# --------------------------------------------------------------------- search

_TOKEN = re.compile(r"[A-Za-z0-9_.<>-]+")


def fts_query(raw):
    """Build a safe FTS5 MATCH expression: every token becomes a prefix term."""
    tokens = _TOKEN.findall(raw or "")
    if not tokens:
        return None
    return " AND ".join('"%s"*' % t.replace('"', '') for t in tokens)


def db(path=None):
    con = sqlite3.connect(path or DB_PATH)
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


def packages_by_attr(attrs):
    """Rows for an explicit list of attributes, in the order asked for.

    A lookup rather than a search: the curated lists in the UI name packages
    outright. Anything nixpkgs has since renamed simply does not come back,
    which is the behaviour to want — a shorter list beats a name that resolves
    to nothing at `nixos-rebuild`.
    """
    if not attrs:
        return []
    con = db()
    rows = con.execute(
        "SELECT attr, version, description, unfree, broken FROM packages "
        "WHERE attr IN (%s)" % ",".join("?" * len(attrs)), attrs).fetchall()
    con.close()
    found = {r["attr"]: dict(r) for r in rows}
    return [found[a] for a in attrs if a in found]


def get_option(path):
    con = db()
    row = con.execute("SELECT * FROM options WHERE path = ?", (path,)).fetchone()
    con.close()
    if not row:
        return None
    out = dict(row)
    out["type"] = json.loads(out.pop("type_json"))
    return out


def get_meta(path=None):
    con = db(path)
    rows = con.execute("SELECT key, value FROM meta").fetchall()
    con.close()
    return {r["key"]: r["value"] for r in rows}


def meta_for(channel):
    """The meta of that channel's own database, or {} if it has none here.

    Deliberately does not go through built_channels(): that probes the channel
    server for the channel list, and this runs on every keystroke in Setup.
    """
    path = _KNOWN_DBS.get(channel) or releases.db_for(data_dir(), channel)
    return get_meta(path) if os.path.exists(path) else {}


def revision_for(channel):
    """(commit, came_from_the_index) for the generated flake.nix to pin.

    A database records the revision it was indexed from, and that is the one
    the options on offer actually came from, so it wins. A channel with no
    database here — picked in the selector but not built yet — falls back to
    asking the channel server, which pins something reproducible but says
    nothing about the option list; the generated file spells that difference
    out, so the two cases are kept apart rather than merged.
    """
    rev = meta_for(channel).get("revision")
    if rev:
        return rev, True
    return releases.revision(channel), False


def unused_indexes():
    """Databases for channels that can no longer be picked.

    A channel drops off the list when NixOS moves on, and its 37 MB database
    stays behind where nothing will ever look at it again. Three guards, all
    of them load-bearing: only names nixgen wrote itself, never the database
    in use, and never a channel still on offer.
    """
    keep = set(releases.releases()) | {get_meta().get("channel")}
    here = os.path.abspath(DB_PATH)
    out = []
    for channel, path in sorted(releases.indexes(data_dir()).items()):
        if channel in keep or os.path.abspath(path) == here:
            continue
        try:
            size = os.path.getsize(path)
        except OSError:
            continue
        out.append({"channel": channel, "path": path, "bytes": size})
    return out


def age_days(snapshot):
    """Whole days between an ISO snapshot stamp and now, or None."""
    if not snapshot:
        return None
    try:
        when = datetime.datetime.fromisoformat(snapshot)
    except ValueError:
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=datetime.timezone.utc)
    now = datetime.datetime.now(datetime.timezone.utc)
    return max(0, (now - when).days)


# --------------------------------------------------------------------- import

def match_option(segments):
    """Find the catalogue option for a path taken from someone's config.

    Catalogue paths carry placeholders (`services.nginx.virtualHosts.<name>.root`)
    where a real config has a name, so an exact lookup is tried first and then
    a segment-by-segment comparison that lets placeholders absorb one segment
    each. Returns (row, slot_values).

    Segments arrive as plain names, catalogue paths quote the ones that need
    it, so the lookup goes through render_path rather than a bare join —
    `boot.kernel.sysctl."net.core.rmem_max"` is never found otherwise, and
    that is an option people actually set."""
    con = db()
    joined = render_path(segments)
    row = con.execute("SELECT * FROM options WHERE path = ?", (joined,)).fetchone()
    if row:
        con.close()
        return dict(row), []

    cands = con.execute(
        "SELECT * FROM options WHERE has_slot = 1 AND depth = ? AND path LIKE ?",
        (len(segments) - 1, segments[0] + ".%")).fetchall()
    con.close()

    for c in cands:
        parts = split_path(c["path"])
        if len(parts) != len(segments):
            continue
        slots, ok = [], True
        for want, name, got in zip(parts, path_names(c["path"]), segments):
            if want.startswith("<") or want == "*":
                slots.append(got)
            elif name != got:
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
            # An empty list fits any list type. `[ ]` carries no evidence of
            # what it would have held, and reading it as "not a list of
            # packages" left an empty environment.systemPackages sitting in
            # the file as an expression, with no way to add anything to it.
            if not value:
                return True, []
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
        if e["path"] == "environment.systemPackages":
            e["source"] = sort_list_expr(e["source"])
        if e.get("structural"):
            if e["path"] == "imports":
                e["source"], dropped = strip_self_import(e["source"])
                if dropped:
                    notes.append("Removed ./generated.nix from imports — this file "
                                 "cannot import itself, and doing so makes nixos-rebuild "
                                 "fail with a stack overflow.")
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

        # Package lists read better alphabetised, and Nix does not care.
        if ok and e["kind"] == "packages" and isinstance(value, list):
            value = sorted(value, key=sort_key)
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


# ---------------------------------------------------------------- app icons

# Where a freedesktop icon theme puts application icons: <theme>/<size>/apps.
# Scalable first, then the largest raster that is not enormous — 512px icons
# for a 22px tile are a waste of bytes on every row.
_ICON_SIZES = ["scalable", "256x256", "128x128", "96x96", "84x84", "72x72",
               "64x64", "48x48", "42x42", "32x32", "24x24", "22x22", "16x16"]
_ICONS = None


def icon_roots():
    """Icon directories this machine already has.

    Nothing is downloaded and nothing is added to the closure: these are the
    themes the system and the user profile carry, plus whatever `XDG_DATA_DIRS`
    points at. Which means the icons you get are the ones your machine has —
    good on a desktop with a full theme installed, thin on a bare install, and
    the UI falls back to a letter rather than an empty square either way.
    """
    home = os.path.expanduser("~")
    roots = ["/run/current-system/sw/share/icons",
             os.path.join(home, ".nix-profile/share/icons"),
             os.path.join(home, ".local/share/icons"),
             "/usr/share/icons"]
    roots += [os.path.join(d, "icons")
              for d in (os.environ.get("XDG_DATA_DIRS") or "").split(":") if d]
    seen, out = set(), []
    for r in roots:
        real = os.path.realpath(r)
        if real in seen or not os.path.isdir(real):
            continue
        seen.add(real)
        out.append(real)
    return out


def icon_index():
    """name -> file, built once from the themes on the machine.

    A lookup table rather than a path built from the request: the name in a
    query is never joined to a directory, so there is nothing here to point at
    /etc/shadow. Sizes are walked worst-first so the best one wins by
    overwriting.
    """
    global _ICONS
    if _ICONS is not None:
        return _ICONS
    index = {}
    # Themes disagree about the order of the two directories: Papirus and
    # hicolor are <theme>/64x64/apps, kora is <theme>/apps/scalable. Both are
    # real and both are common, so the size is read from whichever component
    # has it rather than assumed to be the first.
    for root in icon_roots():
        for theme in _subdirs(root):
            found = []
            for a in _subdirs(theme):
                if os.path.basename(a) == "apps":
                    found.append(a)
                    found += _subdirs(a)
                else:
                    apps = os.path.join(a, "apps")
                    if os.path.isdir(apps):
                        found.append(apps)
            for apps in sorted(found, key=_icon_rank, reverse=True):
                try:
                    entries = os.listdir(apps)
                except OSError:
                    continue
                for fname in entries:
                    stem, ext = os.path.splitext(fname)
                    if ext.lower() in (".svg", ".png"):
                        index[stem.lower()] = os.path.join(apps, fname)
    _ICONS = index
    return index


def _subdirs(path):
    try:
        return [e.path for e in os.scandir(path) if e.is_dir()]
    except OSError:
        return []


def _icon_rank(path):
    """Worst first, so the better directory overwrites it."""
    for part in path.split(os.sep):
        if part in _ICON_SIZES:
            return len(_ICON_SIZES) - _ICON_SIZES.index(part)
    return 0


def icon_for(attr):
    """The file for a package attribute, or None.

    The attribute is not the icon name: `kdePackages.gwenview` is `gwenview`,
    `xfce.thunar` is `thunar`, and GNOME and KDE ship theirs under a reverse
    domain. Every candidate is tried against the index; a name that matches
    nothing simply has no icon, which the UI draws as a letter.
    """
    if not attr:
        return None
    last = attr.split(".")[-1]
    trimmed = re.sub(r"-(gtk|qt|bin|full|desktop|desktopeditors|with-plugins)$", "", last)
    candidates = [attr, last, trimmed,
                  last.replace("_", "-"), last.replace("-", "_"),
                  "org.gnome." + last, "org.kde." + last, "org.xfce." + last,
                  last.replace("gnome-", "org.gnome."),
                  last.replace("xfce4-", "org.xfce."),
                  re.sub(r"^kde", "", last)]
    index = icon_index()
    for c in candidates:
        hit = index.get(c.lower())
        if hit:
            return hit
    return None


BUNDLE_FILES = ("configuration.nix", "flake.nix", "generated.nix")


def bundle_name(host):
    """A directory name for the archive, from the host name the form holds.

    Anything that is not a plain name is dropped rather than escaped: this ends
    up as a path in an archive somebody will extract, and `nixos` is a better
    answer than a clever one.
    """
    clean = re.sub(r"[^A-Za-z0-9._-]", "", host.strip() if isinstance(host, str) else "")
    return clean.strip(".-") or "nixos"


def bundle(payload):
    """The three files as one .tar.gz, for the Download all three button.

    tar.gz rather than zip because of who is on the other end: NixOS ships
    gnutar and gzip in the default system path and does not ship unzip, so
    `tar -xzf` is a command that works on a fresh install and `unzip` is one
    that sends you to look for a package first.

    Everything is inside a directory named after the host, so extracting it
    cannot land a configuration.nix on top of one already sitting in the
    directory somebody happened to be in. The names are this side's, not the
    request's, for the same reason.

    Deterministic: fixed mtimes and modes, so the same three files produce the
    same bytes and a diff of two downloads is about their contents.
    """
    files = payload.get("files")
    files = files if isinstance(files, dict) else {}
    root = bundle_name(payload.get("host"))
    buf = io.BytesIO()
    # mtime=0 in the gzip header too — the default writes the current time,
    # which would make every download differ from the last one.
    with gzip.GzipFile(filename="", mode="wb", fileobj=buf, mtime=0) as gz:
        with tarfile.open(fileobj=gz, mode="w") as tar:
            for name in BUNDLE_FILES:
                text = files.get(name)
                raw = (text if isinstance(text, str) else "").encode("utf-8")
                info = tarfile.TarInfo(f"{root}/{name}")
                info.size = len(raw)
                info.mtime = 0
                info.mode = 0o644
                info.uid = info.gid = 0
                info.uname = info.gname = "root"
                tar.addfile(info, io.BytesIO(raw))
    return root, buf.getvalue()


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

        if u.path == "/api/icon":
            path = icon_for(one("attr", ""))
            if not path:
                return self._send(404, b"no icon", "text/plain")
            try:
                with open(path, "rb") as fh:
                    raw = fh.read(400_000)
            except OSError:
                return self._send(404, b"no icon", "text/plain")
            ctype = "image/svg+xml" if path.endswith(".svg") else "image/png"
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(raw)))
            # The only thing here worth caching: a file in the store that
            # cannot change while this server is running, asked for once per
            # row of every list.
            self.send_header("Cache-Control", "max-age=86400")
            self.end_headers()
            return self.wfile.write(raw)

        if u.path == "/api/meta":
            return self._json(get_meta())
        if u.path == "/api/search":
            kind = one("kind", "options")
            q = one("q", "")
            limit = min(int(one("limit", "60")), 200)
            if kind == "packages":
                return self._json({"results": search_packages(q, limit)})
            return self._json({"results": search_options(q, limit, one("supported") == "1")})
        if u.path == "/api/releases":
            built = built_channels()
            meta = get_meta()
            snapshot = meta.get("snapshot")
            age = age_days(snapshot)
            indexed = meta.get("channel")
            return self._json({
                "channels": releases.releases(one("refresh") == "1"),
                "indexed": indexed,
                "built": sorted(built, reverse=True),
                # How old the option list is, and when it stops being worth
                # trusting. Unstable answers "tomorrow"; a numbered release
                # takes weeks. Without this, an index quietly rots.
                "snapshot": snapshot,
                "age_days": age,
                "stale": age is not None and age >= releases.stale_after(indexed),
                "unstable": releases.UNSTABLE,
                # The NixOS version each built channel is, so picking one in
                # the selector can move `system.stateVersion` with it.
                # `nixos-unstable` is 26.11 today and its name will never say so.
                "release_of": {ch: get_meta(p).get("release")
                               for ch, p in built.items()},
                # Indexes for channels that dropped off the list. Nothing else
                # would ever remove them, and each one is about 37 MB.
                "unused": [{"channel": u["channel"], "bytes": u["bytes"]}
                           for u in unused_indexes()],
            })
        if u.path == "/api/reindex/status":
            return self._json(releases.status)
        if u.path == "/api/starter":
            channel = (one("channel") if releases.is_channel(one("channel"))
                       else get_meta().get("channel", "nixos-26.05"))
            # Asking for the branch means no commit is needed, so do not go
            # looking for one — that lookup can reach the network. It is also
            # the default, so the common request never touches the network.
            pin = one("pin", "branch")
            rev, from_index = ((None, False) if pin == "branch"
                               else revision_for(channel))
            return self._json(starter_files(
                one("host"), one("user"), one("system"), channel,
                revision=rev, from_index=from_index, pin=pin,
                release=meta_for(channel).get("release"),
                bootloader=one("bootloader"),
                grub_device=one("grub_device"),
                networkmanager=one("networkmanager"),
                make_user=one("make_user"),
                groups=one("groups"),
                flakes=one("flakes"),
                state_version=one("state_version")))
        if u.path == "/api/packages":
            # Bounded because it names every row it wants: the curated lists
            # are a handful each, and nothing else should be asking.
            attrs = [a for a in one("attrs", "").split(",") if a][:40]
            return self._json({"results": packages_by_attr(attrs)})
        if u.path == "/api/option":
            opt = get_option(one("path", ""))
            return self._json(opt or {"error": "not found"}, 200 if opt else 404)
        return self._send(404, b"not found", "text/plain")

    def do_POST(self):
        """Answer, or say why not.

        Without this, a request the UI would never send — a truncated body, a
        field of the wrong shape — reached the handler, raised, and the
        connection was dropped with the traceback going to the terminal. The
        browser sees a failed fetch either way, but a status and a message can
        be read, and the terminal is where somebody is watching for real
        trouble. This catches the malformed request, not the broken index:
        those still raise on their own.
        """
        try:
            return self._post()
        except (ValueError, TypeError, AttributeError, KeyError) as exc:
            return self._json({"error": f"{type(exc).__name__}: {exc}"}, 400)

    def _post(self):
        u = urlparse(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        payload = json.loads(self.rfile.read(length) or b"{}")
        if not isinstance(payload, dict):
            raise TypeError("the request body is not an object")

        if u.path == "/api/render":
            return self._json({"text": render(payload)})
        if u.path == "/api/import":
            try:
                return self._json(import_config(payload.get("text", "")))
            except NixSyntaxError as exc:
                return self._json({"error": str(exc)}, 200)
        if u.path == "/api/reindex":
            channel = payload.get("channel", "")
            if not releases.is_channel(channel):
                return self._json({"error": "not a channel nixgen knows"}, 200)
            # `refresh` asks for the data to be fetched again even though a
            # database is already here. Without it there would be no way to
            # follow a channel that moves — switching to unstable would keep
            # handing back whatever snapshot happened to be indexed first.
            ready = None if payload.get("refresh") else built_channels().get(channel)
            if ready:
                switch_db(ready)
                releases.status.update(state="done", channel=channel,
                                       message=f"Switched to {channel}.")
                return self._json({"switched": True, "channel": channel})
            if releases.status["state"] in ("starting", "fetching", "indexing"):
                return self._json({"busy": True, "status": releases.status})
            releases.build(data_dir(), channel,
                           on_done=lambda ch, path: switch_db(path))
            return self._json({"started": True, "channel": channel})
        if u.path == "/api/indexes/remove":
            # The client names channels, never paths, and only channels this
            # side has already decided are unreachable can be removed. Nothing
            # a request says can widen that set.
            wanted = set(payload.get("channels") or [])
            removed, freed = [], 0
            for entry in unused_indexes():
                if entry["channel"] not in wanted:
                    continue
                try:
                    os.remove(entry["path"])
                except OSError as exc:
                    return self._json({"error": str(exc)}, 200)
                _KNOWN_DBS.pop(entry["channel"], None)
                removed.append(entry["channel"])
                freed += entry["bytes"]
            return self._json({"removed": removed, "bytes": freed})
        if u.path == "/api/validate":
            return self._json(validate(payload.get("text", "")))
        if u.path == "/api/bundle":
            root, raw = bundle(payload)
            self.send_response(200)
            self.send_header("Content-Type", "application/gzip")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Content-Disposition",
                             f'attachment; filename="{root}.tar.gz"')
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return self.wfile.write(raw)
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
    remember_db()

    # Pick up the release chosen on a previous run.
    marker = os.path.join(data_dir(), "CURRENT")
    if os.path.exists(marker):
        with open(marker) as fh:
            wanted = fh.read().strip()
        path = releases.db_for(data_dir(), wanted)
        if wanted != get_meta().get("channel") and os.path.exists(path):
            DB_PATH = path
            remember_db()

    url = f"http://{args.host}:{args.port}/"

    # Bind before announcing anything. Printing "serving …" and opening a
    # browser and only then failing to listen sends someone to whatever else
    # is on that port — which, when it is an older nixgen, looks exactly like
    # the new one having started and changed nothing.
    try:
        httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as exc:
        if exc.errno != errno.EADDRINUSE:
            sys.exit(f"could not listen on {args.host}:{args.port} — {exc}")
        sys.exit(
            f"port {args.port} is already in use, so nixgen did not start.\n"
            f"\n"
            f"  Often it is nixgen itself, left running from earlier. Open\n"
            f"  {url} and look at the build id in the header: if it is\n"
            f"  not the version you expected, that is the old one answering.\n"
            f"\n"
            f"  Otherwise use another port:  nixgen --port {args.port + 1}")

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
    httpd.serve_forever()


if __name__ == "__main__":
    main()
