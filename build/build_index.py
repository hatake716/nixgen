#!/usr/bin/env python3
"""Turn the raw channel JSON dumps into a compact SQLite index.

Input :  data/options.json   (~11 MB)   data/packages.json  (~380 MB)
Output:  data/nixgen.sqlite  (~20 MB)

Run this after fetch-data.sh. It streams packages.json so peak memory stays
low even though the raw file is large.
"""

import argparse
import json
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nixgen_core import parse_type, is_supported  # noqa: E402


# How prominent each top-level namespace is, used only to break ties in search
# results. Someone typing "firewall" almost always means networking.firewall,
# not nix.firewall — nothing here changes what is found, only the order.
NS_RANK = {
    "services": 0, "networking": 0, "hardware": 0, "boot": 0, "programs": 0,
    "environment": 0, "users": 0, "time": 0, "i18n": 0, "console": 0,
    "security": 1, "virtualisation": 1, "system": 1, "fonts": 1, "sound": 1,
    "xdg": 1, "location": 1, "powerManagement": 1, "swapDevices": 1,
    "fileSystems": 1, "nixpkgs": 1,
    "nix": 2, "systemd": 2, "documentation": 2, "specialisation": 2,
}
DEFAULT_NS_RANK = 3

SCHEMA = """
PRAGMA journal_mode = OFF;
PRAGMA synchronous  = OFF;

DROP TABLE IF EXISTS options;
DROP TABLE IF EXISTS options_fts;
DROP TABLE IF EXISTS packages;
DROP TABLE IF EXISTS packages_fts;
DROP TABLE IF EXISTS meta;

CREATE TABLE options (
    path        TEXT PRIMARY KEY,
    type_str    TEXT,
    type_json   TEXT,
    supported   INTEGER,
    default_txt TEXT,
    example_txt TEXT,
    description TEXT,
    declared_in TEXT,
    read_only   INTEGER,
    has_slot    INTEGER,
    depth       INTEGER,
    ns_rank     INTEGER,
    is_enable   INTEGER
);
CREATE VIRTUAL TABLE options_fts USING fts5(
    path, description, content='options', content_rowid='rowid', tokenize='porter unicode61'
);

CREATE TABLE packages (
    attr        TEXT PRIMARY KEY,
    pname       TEXT,
    version     TEXT,
    description TEXT,
    unfree      INTEGER,
    broken      INTEGER
);
CREATE VIRTUAL TABLE packages_fts USING fts5(
    attr, description, content='packages', content_rowid='rowid', tokenize='porter unicode61'
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
"""


def literal(field):
    """Option defaults/examples arrive as {_type: literalExpression, text: ...}."""
    if field is None:
        return None
    if isinstance(field, dict):
        return field.get("text") or field.get("value")
    return json.dumps(field, ensure_ascii=False)


def load_options(con, path):
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)

    rows = []
    for key, opt in data.items():
        if key.startswith("_module"):
            continue
        type_str = opt.get("type", "")
        node = parse_type(type_str)
        top = key.split(".", 1)[0]
        rows.append((
            key,
            type_str,
            json.dumps(node, ensure_ascii=False),
            1 if is_supported(node) else 0,
            literal(opt.get("default")),
            literal(opt.get("example")),
            (opt.get("description") or "").strip(),
            (opt.get("declarations") or [None])[0],
            1 if opt.get("readOnly") else 0,
            1 if ("<" in key or "*" in key) else 0,
            key.count("."),
            NS_RANK.get(top, DEFAULT_NS_RANK),
            1 if key.endswith(".enable") else 0,
        ))

    con.executemany("INSERT OR REPLACE INTO options VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    con.execute("INSERT INTO options_fts(rowid, path, description) "
                "SELECT rowid, path, description FROM options")
    return len(rows)


def load_packages(con, path):
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)["packages"]

    rows = []
    for attr, pkg in data.items():
        meta = pkg.get("meta") or {}
        # `available` is False for every unfree package, because the channel
        # eval runs without allowUnfree. Filtering on it would silently drop
        # Steam, VS Code, Obsidian and friends, so keep everything and let the
        # UI flag what needs extra config.
        rows.append((
            attr,
            pkg.get("pname") or attr,
            pkg.get("version") or "",
            (meta.get("description") or "").strip(),
            1 if meta.get("unfree") else 0,
            1 if meta.get("broken") else 0,
        ))

    con.executemany("INSERT OR REPLACE INTO packages VALUES (?,?,?,?,?,?)", rows)
    con.execute("INSERT INTO packages_fts(rowid, attr, description) "
                "SELECT rowid, attr, description FROM packages")
    return len(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data")
    ap.add_argument("--channel", default="nixos-26.05")
    args = ap.parse_args()

    db = os.path.join(args.data, "nixgen.sqlite")
    if os.path.exists(db):
        os.remove(db)

    con = sqlite3.connect(db)
    con.executescript(SCHEMA)

    print("indexing options...", flush=True)
    n_opt = load_options(con, os.path.join(args.data, "options.json"))
    print(f"  {n_opt:,} options", flush=True)

    print("indexing packages (this takes a minute)...", flush=True)
    n_pkg = load_packages(con, os.path.join(args.data, "packages.json"))
    print(f"  {n_pkg:,} packages", flush=True)

    con.executemany("INSERT INTO meta VALUES (?,?)", [
        ("channel", args.channel),
        ("option_count", str(n_opt)),
        ("package_count", str(n_pkg)),
    ])
    con.commit()
    con.execute("VACUUM")
    con.close()

    size = os.path.getsize(db) / 1e6
    print(f"wrote {db} ({size:.1f} MB)")


if __name__ == "__main__":
    main()
