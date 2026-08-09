#!/usr/bin/env python3
"""Render thousands of real options with hostile values and parse the result.

Every renderer change should be run through this before it ships. Three real
bugs came out of it that no amount of reading the code had found:

  * placeholders in option paths are not all `<name>` — also `<n>` and `*`
  * `[ -1 ]` does not parse; negative numbers inside a list need parentheses
  * `if`, `rec`, `or`, `let` are reserved and must be quoted as attribute names

Usage:
    python3 tools/fuzz.py                    # a few seeds, default index
    python3 tools/fuzz.py --seeds 1 2 3 --n 8000
    python3 tools/fuzz.py --db ~/.local/share/nixgen/nixgen.sqlite

Needs `nix-instantiate` on PATH; without it there is nothing to check against.
"""

import argparse
import json
import os
import random
import shutil
import sqlite3
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "build"))

from nixgen_core import render_module, split_path  # noqa: E402

# Values chosen to break naive quoting and escaping.
VALUES = ['hello', 'Asia/Tokyo', 'a"b\\c', '${notInterp}', 'multi\nline',
          "it's", "''weird''", '', '#comment', '*/', '日本語']

# Substituted for <name> placeholders. The last four are Nix keywords and a
# leading digit, all of which need quoting as attribute names.
NAMES = ['web', 'my host', '127.0.0.1', 'a-b', 'ok_name', 'with.dot', '',
         'if', 'rec', 'let', 'or', '1abc']


def value_for(node, depth=0):
    kind = node["kind"]
    if kind == "bool":
        return random.choice([True, False])
    if kind == "enum":
        return random.choice(node["values"])
    if kind == "int":
        lo = node.get("min", -9)
        hi = node.get("max", lo + 100)
        return random.randint(lo, min(hi, lo + 100))
    if kind == "float":
        return random.choice([1.5, -0.25])
    if kind in ("str", "lines"):
        return random.choice(VALUES)
    if kind == "path":
        return random.choice(["/etc/foo", "./rel", "relative"])
    if kind == "package":
        return random.choice(["ripgrep", "firefox"])
    if kind == "nullable":
        return None if random.random() < .3 else value_for(node["inner"], depth + 1)
    if kind == "list":
        if depth > 2:
            return []
        return [value_for(node["inner"], depth + 1) for _ in range(random.randint(0, 3))]
    if kind == "attrs":
        if depth > 2:
            return {}
        return {random.choice(['a', 'x y', '127.0.0.1', '', 'if']):
                value_for(node["inner"], depth + 1)
                for _ in range(random.randint(0, 2))}
    return "{ }"


def segments_for(path):
    return [random.choice(NAMES) if (s.startswith("<") or s == "*") else s
            for s in split_path(path)]


def run(db, seed, count, keep):
    random.seed(seed)
    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT path, type_json FROM options WHERE supported = 1").fetchall()
    con.close()

    picked = random.sample(list(rows), min(count, len(rows)))
    by_path = {}
    for row in picked:
        segs = segments_for(row["path"])
        by_path[".".join(segs)] = {
            "segments": segs,
            "type": json.loads(row["type_json"]),
            "value": value_for(json.loads(row["type_json"])),
        }
    entries = list(by_path.values())
    text = render_module(entries, "fuzz", "test")

    tmp = os.path.join(tempfile.mkdtemp(prefix="nixgen-fuzz-"), "generated.nix")
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
    proc = subprocess.run(["nix-instantiate", "--parse", tmp],
                          capture_output=True, text=True)
    ok = proc.returncode == 0
    print(f"seed {seed:<5} {len(entries):>6,} options  {len(text) // 1024:>4} KB  "
          f"{'OK' if ok else 'FAIL'}")
    if not ok:
        print(proc.stderr[:1200])
        print(f"kept the file at {tmp}")
    elif not keep:
        shutil.rmtree(os.path.dirname(tmp), ignore_errors=True)
    return ok


# Random sampling alone will not reliably hit a specific bug — the negative
# number has to land inside a list on that particular seed. These cases run
# every time so a fixed bug stays fixed.
REGRESSIONS = [
    ("negative number in a list",
     [{"segments": ["services", "x", "ports"],
       "type": {"kind": "list", "inner": {"kind": "int"}},
       "value": [84, 20, -1]}]),
    ("Nix keyword as a name",
     [{"segments": ["systemd", "services", "if", "enable"],
       "type": {"kind": "bool"}, "value": True}]),
    ("name with dots and spaces",
     [{"segments": ["services", "nginx", "virtualHosts", "my site.example.com", "root"],
       "type": {"kind": "path"}, "value": "/var/www"}]),
    ("quotes, newlines and interpolation in a string",
     [{"segments": ["systemd", "services", "x", "script"],
       "type": {"kind": "lines"},
       "value": 'echo "hi ; there"\n${notInterp}\n'}]),
    ("empty containers",
     [{"segments": ["a", "b"], "type": {"kind": "list", "inner": {"kind": "str"}}, "value": []},
      {"segments": ["a", "c"], "type": {"kind": "attrs", "inner": {"kind": "str"}}, "value": {}}]),
    ("null through a nullable",
     [{"segments": ["time", "timeZone"],
       "type": {"kind": "nullable", "inner": {"kind": "str"}},
       "value": {"__null": True, "v": None}}]),
]


def regressions():
    """Returns the number that failed."""
    failed = 0
    for name, entries in REGRESSIONS:
        text = render_module(entries, "fuzz", "test")
        with tempfile.NamedTemporaryFile("w", suffix=".nix", delete=False,
                                         encoding="utf-8") as fh:
            fh.write(text)
            path = fh.name
        proc = subprocess.run(["nix-instantiate", "--parse", path],
                              capture_output=True, text=True)
        ok = proc.returncode == 0
        print(f"  {'OK  ' if ok else 'FAIL'} {name}")
        if not ok:
            failed += 1
            print("       " + (proc.stderr or "").strip().splitlines()[0][:110])
            print("       " + text.strip().splitlines()[-2].strip()[:110])
        os.unlink(path)

    # Package lists are expected to come out sorted.
    node = {"kind": "list", "inner": {"kind": "package"}}
    text = render_module([{"segments": ["environment", "systemPackages"],
                           "type": node, "value": ["zsh", "aalib", "ripgrep"]}],
                         "fuzz", "test")
    names = [ln.strip() for ln in text.split("\n")
             if ln.strip().startswith("pkgs.")]
    ok = names == sorted(names)
    print(f"  {'OK  ' if ok else 'FAIL'} package lists are sorted")
    return failed + (0 if ok else 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=os.path.join(
        os.path.dirname(HERE), "data", "nixgen.sqlite"))
    ap.add_argument("--seeds", type=int, nargs="+", default=[11, 47, 808])
    ap.add_argument("--n", type=int, default=8000)
    ap.add_argument("--keep", action="store_true", help="keep the rendered file")
    args = ap.parse_args()

    if not shutil.which("nix-instantiate"):
        sys.exit("nix-instantiate is not on PATH — there is nothing to check against")
    if not os.path.exists(args.db):
        sys.exit(f"no index at {args.db}; build one first, or pass --db")

    print("regressions:")
    failures = regressions()
    print("random sampling:")
    failures += sum(0 if run(args.db, s, args.n, args.keep) else 1
                    for s in args.seeds)
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
