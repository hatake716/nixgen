#!/usr/bin/env python3
"""Read configurations back in and check that nothing was lost or broken.

fuzz.py covers the renderer. This covers the other direction — nix_import.py
and the grouping in server.py — which is what happens when someone presses
Import configuration.nix.

Three bugs in that path had to be found by clicking around in a browser, and
all three would have shown up here:

  * `((python313Packages).requests)` is how Nix hands back a dotted name. It
    was not recognised, so one such package turned its whole list into text
    that could no longer be edited.
  * `[ (-1) ]` was carried over as `[ -1 ]`, which does not parse. Only
    through the fallback reader, which is where nobody looks.
  * a package name containing a dot lost its `pkgs.` prefix on the way out.

Every case runs through **both readers**. They fail differently and neither
failure is visible from the other: the Nix-backed one works on a normalised,
fully-parenthesised expression, the fallback one on the raw source. Two of the
three bugs above showed up in exactly one reader each.

The fixed cases are the body of this. The random half renders real options and
reads them back, which is good for breadth but cannot produce the shapes a
person writes by hand — `with pkgs; [ python313Packages.requests ]` never comes
out of our own renderer, so no amount of sampling would have found the first
bug. New shapes belong in CASES.

Usage:
    python3 tools/import_check.py
    python3 tools/import_check.py --seeds 1 2 3 --n 400
    python3 tools/import_check.py --db ~/.local/share/nixgen/nixgen.sqlite

Needs `nix-instantiate` on PATH — for the parse checks, and because one of the
two readers is Nix itself — and an index to match option paths against.
"""

import argparse
import os
import random
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "build"))
sys.path.insert(0, HERE)

import nix_import  # noqa: E402
import server  # noqa: E402
from nixgen_core import split_path  # noqa: E402
from fuzz import value_for  # noqa: E402

# Same placeholder shapes app.js resolves; kept here rather than imported
# because app.js is the other copy and neither can import the other.
SLOT = re.compile(r"<[^>]*>|\*")


# --------------------------------------------------------------- the readers

def with_reader(use_nix, fn):
    """Run fn with one of the two readers forced.

    There is no seam for this in nix_import — it decides by looking for
    nix-instantiate on PATH — so the lookup is replaced for the duration.
    Worth the ugliness: a bug in the reader that is not selected here is a bug
    nothing else in the project would catch.
    """
    real = nix_import.shutil.which
    if not use_nix:
        nix_import.shutil.which = lambda *a, **k: None
    try:
        return fn()
    finally:
        nix_import.shutil.which = real


# ------------------------------------------------------------------ plumbing

def resolve_segments(entry):
    """Put the concrete names back into a catalogue path.

    `users.users.<name>.isNormalUser` plus slot `takeshi` is what the file
    said in the first place. app.js does the same thing in segmentsFor().
    """
    slots = list(entry.get("slots") or [])
    out = []
    for seg in split_path(entry["path"]):
        if SLOT.fullmatch(seg):
            out.append((slots.pop(0) if slots else "").strip() or "CHANGE_ME")
        else:
            out.append(seg)
    return out


def placed(result):
    """Where each path in the file ended up: path -> group name."""
    out = {}
    for m in result["matched"]:
        out[".".join(resolve_segments(m))] = "matched"
    for group in ("expression", "unknown", "structure"):
        for v in result[group]:
            out[v["path"]] = group
    return out


def render_result(result):
    """Rebuild the file from all four groups, the way the UI does."""
    entries = []
    for m in result["matched"]:
        entries.append({"path": m["path"], "segments": resolve_segments(m),
                        "type": m["type"], "value": m["value"]})
    for group in ("structure", "expression", "unknown"):
        for v in result[group]:
            entries.append({"path": v["path"], "segments": v["segments"],
                            "type": {"kind": "raw"}, "value": v["source"],
                            "note": v.get("note")})
    return server.render({"entries": entries, "channel": "nixos"})


def parses(text):
    """(ok, first line of the error)."""
    with tempfile.NamedTemporaryFile("w", suffix=".nix", delete=False,
                                     encoding="utf-8") as fh:
        fh.write(text)
        path = fh.name
    proc = subprocess.run(["nix-instantiate", "--parse", path],
                          capture_output=True, text=True)
    os.unlink(path)
    err = (proc.stderr or "").strip().splitlines()
    return proc.returncode == 0, (err[0] if err else "")


def offending(text, err):
    """The line the parser complained about, for a message worth reading."""
    m = re.search(r":(\d+):\d+", err)
    if not m:
        return ""
    lines = text.splitlines()
    n = int(m.group(1)) - 1
    return lines[n].strip() if 0 <= n < len(lines) else ""


def body_of(text):
    """The generated file without its header comment.

    The header names `./generated.nix` on purpose — it is telling you how to
    import the thing — so searching the whole file for it would find that and
    conclude the self-import had not been stripped.
    """
    return "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("#"))


# ---------------------------------------------------------------- the cases

MODULE = "{ config, lib, pkgs, ... }:\n\n{\n%s}\n"

CASES = [
    {
        "name": "packages with dots and quoted segments",
        # What a person writes. Our own renderer never produces this shape,
        # which is why sampling could not have found the bug it covers.
        "body": '''  environment.systemPackages = with pkgs; [
    python313Packages.requests
    CuboCore.coreaction
    rubyPackages."http_parser.rb"
    firefox
  ];
''',
        "expect": {
            "environment.systemPackages": ("matched", [
                "CuboCore.coreaction", "firefox",
                "python313Packages.requests", 'rubyPackages."http_parser.rb"']),
        },
    },
    {
        "name": "packages written out in full",
        "body": '''  environment.systemPackages = [
    pkgs.python313Packages.requests
    pkgs.firefox
  ];
''',
        "expect": {
            "environment.systemPackages": ("matched",
                                           ["firefox", "python313Packages.requests"]),
        },
    },
    {
        "name": "a negative number inside a list",
        # `[ -1 ]` is a syntax error. The Nix reader never sees the literal
        # form — it arrives as (__sub 0 1) — so this only bites the fallback.
        "body": "  services.notInThisRelease.offsets = [ (-1) 2 ];\n",
        "expect": {"services.notInThisRelease.offsets": ("unknown", None)},
    },
    {
        "name": "a negative number is carried back as a negative number",
        # Nix has no negative literal, so `-5` comes back out of its parser as
        # `(__sub 0 5)`. That is correct and unrecognisable, and verbatim is
        # supposed to mean you recognise your own line.
        "body": "  services.notInThisRelease.nice = -5;\n",
        "expect": {"services.notInThisRelease.nice": ("unknown", None)},
        "present": ["= -5;"],
    },
    {
        "name": "imports is carried and the file never imports itself",
        "body": '''  imports = [ ./hardware-configuration.nix ./generated.nix ];
  networking.hostName = "workstation";
''',
        "expect": {
            "imports": ("structure", None),
            "networking.hostName": ("matched", "workstation"),
        },
        "absent": ["./generated.nix"],
        "present": ["./hardware-configuration.nix"],
    },
    {
        "name": "an expression is carried, not guessed at",
        "body": '''  networking.firewall.allowedTCPPorts =
    if config.services.openssh.enable then [ 22 80 ] else [ 80 ];
''',
        "expect": {"networking.firewall.allowedTCPPorts": ("expression", None)},
    },
    {
        "name": "a name with a dot and a space in it",
        "body": '''  services.nginx.virtualHosts."my site.example.com".root = "/srv/www";
''',
        "expect": {"services.nginx.virtualHosts.my site.example.com.root": ("matched", None)},
    },
    {
        "name": "sub-keys of one free-form option",
        # Two lines into one attribute set. Emitting them separately gives
        # `duplicate attribute` at rebuild time.
        #
        # The shape of the value is not incidental. sessionVariables is
        # `attribute set of (null or (… a union …))`: the nullable wrapper is
        # what the form's "unset" checkbox reads, and the union has no widget,
        # so each leaf keeps its Nix source text — quotes and all.
        "body": '''  environment.sessionVariables.EDITOR = "vim";
  environment.sessionVariables.PAGER = "less";
''',
        "expect": {"environment.sessionVariables":
                   ("matched", {"EDITOR": {"__null": False, "v": '"vim"'},
                                "PAGER": {"__null": False, "v": '"less"'}})},
    },
    {
        "name": "non-ASCII text survives being read",
        # `日本語` used to come back as mojibake: the unescaper was Python's,
        # which reads UTF-8 bytes as latin-1.
        "body": '''  time.timeZone = "Asia/Tokyo";
  services.notInThisRelease.motd = "日本語 Grüße";
''',
        "expect": {
            "time.timeZone": ("matched", {"__null": False, "v": "Asia/Tokyo"}),
            "services.notInThisRelease.motd": ("unknown", None),
        },
        "present": ["日本語 Grüße"],
    },
    {
        "name": "an empty list is still a list",
        # `[ ]` says nothing about what it would have held, so it has to fit
        # whatever the option's type is. Refusing it left an empty
        # environment.systemPackages as an expression, with no way to add to it.
        "body": "  environment.systemPackages = [ ];\n",
        "expect": {"environment.systemPackages": ("matched", [])},
    },
    {
        "name": "a list holding a multi-line string is carried, not filled in",
        # A list becomes a form value only when every element is a scalar, and
        # a string with a newline in it is not one. Carrying it is lossless,
        # so this pins the behaviour rather than calling it a bug.
        "body": '''  boot.kernelParams = [ "one\\ntwo" "quiet" ];
''',
        "expect": {"boot.kernelParams": ("expression", None)},
    },
    {
        "name": "a long package list is not truncated",
        # Truncation at 400 characters used to cut a list in half, giving
        # `syntax error, unexpected ';'` in the middle of it.
        "body": "  environment.systemPackages = with pkgs; [\n" +
                "".join(f"    package{i:03d}\n" for i in range(60)) + "  ];\n",
        "expect": {"environment.systemPackages":
                   ("matched", [f"package{i:03d}" for i in range(60)])},
    },
    {
        "name": "a value the form holds, alongside one it does not",
        "body": '''  time.timeZone = "Asia/Tokyo";
  systemd.services.thing.script = \'\'
    echo "hi ; there"
    exit 0
  \'\';
  boot.kernelParams = [ "quiet" "splash" ];
''',
        "expect": {
            "time.timeZone": ("matched", {"__null": False, "v": "Asia/Tokyo"}),
            "systemd.services.thing.script": ("matched", None),
            "boot.kernelParams": ("matched", ["quiet", "splash"]),
        },
    },
]


def run_case(case, use_nix):
    """Returns a list of failure messages, empty when the case passed."""
    text = MODULE % case["body"]
    result = with_reader(use_nix, lambda: server.import_config(text))
    where = placed(result)
    bad = []

    # Nothing invented, nothing dropped. The four groups are meant to account
    # for every line in the file.
    expected = case["expect"]
    for path in expected:
        if path not in where:
            bad.append(f"{path} went missing")
    for path in where:
        if path not in expected:
            bad.append(f"{path} appeared from nowhere")

    for path, (group, value) in expected.items():
        if path not in where:
            continue
        if where[path] != group:
            bad.append(f"{path} landed in {where[path]}, expected {group}")
        elif value is not None:
            got = next(m["value"] for m in result[group]
                       if ".".join(resolve_segments(m)) == path) \
                  if group == "matched" else None
            if got != value:
                bad.append(f"{path} came back as {got!r}, expected {value!r}")

    out = render_result(result)
    ok, err = parses(out)
    if not ok:
        bad.append(f"the rebuilt file does not parse: {err}")
        line = offending(out, err)
        if line:
            bad.append(f"  at: {line[:100]}")

    body = body_of(out)
    for needle in case.get("absent", []):
        if needle in body:
            bad.append(f"{needle} is still in the output")
    for needle in case.get("present", []):
        if needle not in body:
            bad.append(f"{needle} is not in the output")
    return bad


def cases():
    failed = 0
    for case in CASES:
        for use_nix in (True, False):
            label = "nix " if use_nix else "self"
            bad = run_case(case, use_nix)
            print(f"  {'OK  ' if not bad else 'FAIL'} [{label}] {case['name']}")
            for line in bad:
                print(f"         {line}")
            failed += 1 if bad else 0
    return failed


# ------------------------------------------------------------- the round trip

# Types whose value survives a render and a read back unchanged. The rest are
# not broken — a path comes back as an expression, a nullable as one of two
# shapes, `lines` picks up the indentation the `''` form needs — they simply
# do not compare equal, and asserting on them would produce noise instead of
# findings. Placeholders are left to fuzz.py: a concrete path can match more
# than one catalogue entry, and the ambiguity is not what is being tested here.
EXACT = {"bool", "int", "float", "str", "enum", "package"}


def exact(node):
    if node["kind"] in EXACT:
        return True
    return node["kind"] == "list" and node["inner"]["kind"] in EXACT


def carried(value, in_list=False):
    """True for values that come back verbatim rather than as a form value.

    Two shapes do, both on purpose and both losslessly, so generating them
    here would only produce noise: a string containing `${`, because there is
    no telling interpolation from a literal; and a list holding a multi-line
    string, because a list is read as a list only when every element is a
    scalar. Each is pinned as a fixed case above instead.
    """
    if isinstance(value, str):
        return "${" in value or (in_list and "\n" in value)
    if isinstance(value, list):
        return any(carried(v, True) for v in value)
    if isinstance(value, dict):
        return any(carried(v, in_list) for v in value.values())
    return False


# `a."or"` and `a.or` name the same attribute, and Nix's parser prints the
# second — a quote is only needed for a name that is not a valid identifier,
# and `or` is one everywhere except at the start of an expression. Round
# tripping through Nix therefore drops quotes it does not need, which is not a
# difference worth failing on.
_QUOTED_IDENT = re.compile(r'\."([A-Za-z_][A-Za-z0-9_\'-]*)"')


def unquote(value):
    if isinstance(value, str):
        return _QUOTED_IDENT.sub(r".\1", value)
    if isinstance(value, list):
        return [unquote(v) for v in value]
    return value


def normalise(node, value):
    """Package lists come back sorted, because that is what they are for."""
    if node["kind"] == "package":
        return unquote(value)
    if node["kind"] == "list" and node["inner"]["kind"] == "package":
        return sorted(unquote(value))
    return value


def roundtrip(db, seed, count, use_nix):
    """Render real options, read the file back, and require every one of them
    to return as the value it went in as."""
    random.seed(seed)
    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row
    rows = con.execute("SELECT path, type_json FROM options "
                       "WHERE supported = 1 AND has_slot = 0").fetchall()
    con.close()

    import json
    picked, wanted = [], {}
    for row in random.sample(list(rows), min(count * 3, len(rows))):
        node = json.loads(row["type_json"])
        if not exact(node):
            continue
        value = value_for(node)
        if carried(value):
            continue
        picked.append({"segments": split_path(row["path"]), "type": node,
                       "value": value})
        wanted[row["path"]] = (node, normalise(node, value))
        if len(wanted) >= count:
            break

    text = server.render({"entries": picked, "channel": "nixos"})
    result = with_reader(use_nix, lambda: server.import_config(text))
    got = {m["path"]: m["value"] for m in result["matched"]}

    bad = []
    for path, (node, value) in wanted.items():
        if path not in got:
            group = next((g for g in ("expression", "unknown", "structure")
                          if any(v["path"] == path for v in result[g])), "nowhere")
            bad.append(f"{path} came back as {group}, not a form value")
        elif normalise(node, got[path]) != value:
            bad.append(f"{path}: {got[path]!r} != {value!r}")

    ok, err = parses(render_result(result))
    if not ok:
        bad.append(f"the rebuilt file does not parse: {err}")

    label = "nix " if use_nix else "self"
    print(f"  {'OK  ' if not bad else 'FAIL'} [{label}] seed {seed:<4} "
          f"{len(wanted):>4} options")
    for line in bad[:6]:
        print(f"         {line}")
    if len(bad) > 6:
        print(f"         … and {len(bad) - 6} more")
    return 1 if bad else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=os.path.join(
        os.path.dirname(HERE), "data", "nixgen.sqlite"))
    ap.add_argument("--seeds", type=int, nargs="+", default=[5, 91])
    ap.add_argument("--n", type=int, default=300)
    args = ap.parse_args()

    if not shutil.which("nix-instantiate"):
        sys.exit("nix-instantiate is not on PATH — one of the two readers is "
                 "Nix itself, so there is nothing to check against")
    if not os.path.exists(args.db):
        sys.exit(f"no index at {args.db}; build one first, or pass --db")
    server.DB_PATH = args.db

    print("configurations:")
    failures = cases()
    print("round trip through the catalogue:")
    for seed in args.seeds:
        for use_nix in (True, False):
            failures += roundtrip(args.db, seed, args.n, use_nix)
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
