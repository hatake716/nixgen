#!/usr/bin/env python3
"""Evaluate a generated bundle as a real NixOS system, then read it back.

Check syntax is nix-instantiate --parse and nothing more: it judges no types
and evaluates nothing. Every bug that mattered — the null input method, the
package-typed option holding a string, the duplicate attribute the module
system refuses — surfaced at evaluation or later. This is the final line of
defence, and it existed only as four hand-made files in DEBUGGING.md §5
until now.

Point it at a directory holding the three files nixgen writes —
configuration.nix, flake.nix, generated.nix — which is what
`tools/browser_check.py <url> <outdir>` saves, and also what the downloaded
archive unpacks to. A stub hardware-configuration.nix is supplied here, so
the directory needs nothing else.

    python3 tools/eval_check.py <dir>
    python3 tools/eval_check.py <dir> --generated generated-roundtrip.nix
    python3 tools/eval_check.py <dir> --revision <40-hex or branch>

--generated substitutes another module for generated.nix (the round-tripped
file browser_check saves is the interesting second case). --revision
rewrites the flake's nixpkgs to a reporter's revision, because "it evaluates
on the development pin" and "it evaluates on the reporter's machine" are
different facts — the input-method crash proved it.

Evaluating is not enough on its own; passing eval while a setting silently
does nothing is this project's oldest failure mode. So whatever the module
claims is read back out of the evaluated system: the session name must be
one the display manager actually offers, the keyring must reach pam.d/login,
the sway config must keep its include line and lose its bar, the Wayland
layout variable must hold the layout. Each read-back runs only when the
module sets the thing it checks, so this works for any bundle, not just the
full-preset one.

Needs network access the first time (it fetches the pinned nixpkgs) and a
few minutes of evaluation. That is why it is not in CI — run it before a
release, and whenever a preset changes what it writes.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

STUB = """{ ... }:
{
  fileSystems."/" = { device = "/dev/disk/by-label/nixos"; fsType = "ext4"; };
  boot.loader.grub.device = "/dev/sda";
}
"""

failures = []


def report(ok, name, detail=""):
    print(f"  {'OK  ' if ok else 'FAIL'} {name}"
          + (f" — {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def run(args, **kw):
    return subprocess.run(args, capture_output=True, text=True, **kw)


def nix(flakedir, *args):
    return run(["nix", "--extra-experimental-features", "nix-command flakes",
                *args], cwd=flakedir)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir", help="directory with configuration.nix, flake.nix, generated.nix")
    ap.add_argument("--generated", default="generated.nix",
                    help="module file inside DIR to evaluate (default generated.nix)")
    ap.add_argument("--revision", default=None,
                    help="rewrite the flake's nixpkgs to this commit or branch")
    ap.add_argument("--host", default=None,
                    help="nixosConfigurations attribute (default: read from flake.nix)")
    args = ap.parse_args()

    src = os.path.abspath(args.dir)
    flake = open(os.path.join(src, "flake.nix")).read()
    module = open(os.path.join(src, args.generated)).read()

    host = args.host
    if not host:
        m = re.search(r"nixosConfigurations\.([A-Za-z0-9_-]+)", flake)
        host = m.group(1) if m else "nixos"

    if args.revision:
        # A branch is always safe to name; anything else must be a full
        # commit, the same guard releases.is_revision applies before a
        # revision is written into a flake.
        if not re.fullmatch(r"[0-9a-f]{40}|[A-Za-z0-9._-]+", args.revision):
            sys.exit(f"not a revision or branch name: {args.revision}")
        flake, n = re.subn(r'(github:NixOS/nixpkgs/)[^"]+',
                           r"\g<1>" + args.revision, flake)
        if n != 1:
            sys.exit("could not find the nixpkgs URL in flake.nix to rewrite")

    tmp = tempfile.mkdtemp(prefix="nixgen-eval-")
    try:
        with open(os.path.join(tmp, "flake.nix"), "w") as fh:
            fh.write(flake)
        shutil.copy(os.path.join(src, "configuration.nix"), tmp)
        shutil.copy(os.path.join(src, args.generated),
                    os.path.join(tmp, "generated.nix"))
        with open(os.path.join(tmp, "hardware-configuration.nix"), "w") as fh:
            fh.write(STUB)

        # `path:` skips the git dance: the directory is the flake, untracked
        # files and all, which is exactly right for a scratch harness.
        ref = f"path:{tmp}#nixosConfigurations.{host}.config"

        print(f"evaluating {args.generated} as {host} "
              f"({args.revision or 'flake as generated'})")
        r = nix(tmp, "eval", "--raw", f"{ref}.system.build.toplevel.drvPath")
        report(r.returncode == 0, "the system evaluates",
               (r.stderr or "").strip().splitlines()[-1] if r.returncode else "")
        if r.returncode != 0:
            return

        # ---- read-backs, each only when the module sets the thing ----------
        m = re.search(r'defaultSession\s*=\s*"([^"]+)"', module)
        if m:
            r = nix(tmp, "eval", "--json",
                    f"{ref}.services.displayManager.sessionData.sessionNames")
            names = json.loads(r.stdout) if r.returncode == 0 else []
            report(m.group(1) in names,
                   f'the login screen offers "{m.group(1)}"', str(names))

        # One desktop, not two. A switch that leaves the previous desktop
        # enabled still evaluates and still parses — the module system merges
        # two desktops happily and the login screen simply grows an entry —
        # so nothing above this line can see it. What it costs is the session:
        # a leftover Xfce puts 54 packages in the system path, and xfce4-notifyd
        # claims org.freedesktop.Notifications, which is the name the shell the
        # compositor presets install has to own. Reported from a real machine.
        # A pattern rather than a list of names, so a renamed desktop still
        # matches; the table-driven version of this check is in browser_check.
        DESK = re.compile(
            r"^\s*(services\.(?:xserver\.)?desktopManager\.[A-Za-z0-9_]+\.enable"
            r"|services\.xserver\.windowManager\.[A-Za-z0-9_]+\.enable"
            r"|programs\.(?:niri|sway|hyprland)\.enable)\s*=\s*true", re.M)
        on = sorted({g.group(1) for g in DESK.finditer(module)})
        if on:
            report(len(on) == 1, "the module enables one desktop, not two",
                   str(on))

        if "enableGnomeKeyring" in module:
            r = nix(tmp, "build", "--no-link", "--print-out-paths",
                    f'{ref}.environment.etc."pam.d/login".source')
            n = 0
            if r.returncode == 0:
                with open(r.stdout.strip()) as fh:
                    n = fh.read().count("pam_gnome_keyring")
            report(n == 3, "three pam_gnome_keyring lines reach pam.d/login",
                   f"count={n} {(r.stderr or '').strip()[:120]}")

        if 'environment.etc."sway/config"' in module:
            r = nix(tmp, "build", "--no-link", "--print-out-paths",
                    f'{ref}.environment.etc."sway/config".source')
            ok, detail = False, (r.stderr or "").strip()[:120]
            if r.returncode == 0:
                cfg = open(r.stdout.strip()).read()
                inc = cfg.count("include /etc/sway/config.d")
                bar = cfg.count("bar {")
                binds = cfg.count("bindsym")
                ok = inc == 1 and bar == 0 and binds >= 50
                detail = f"include={inc} bar={bar} bindsym={binds}"
            report(ok, "the sway config keeps its include and loses its bar",
                   detail)

        m = re.search(r'XKB_DEFAULT_LAYOUT\s*=\s*"([^"]+)"', module)
        if m:
            r = nix(tmp, "eval", "--json", f"{ref}.environment.sessionVariables")
            got = (json.loads(r.stdout) if r.returncode == 0 else {}) \
                .get("XKB_DEFAULT_LAYOUT")
            report(got == m.group(1),
                   f'every login exports XKB_DEFAULT_LAYOUT="{m.group(1)}"',
                   f"got {got!r}")

        if '"nvidia"' in module:
            r = nix(tmp, "eval", "--json",
                    f"{ref}.services.xserver.videoDrivers")
            drivers = json.loads(r.stdout) if r.returncode == 0 else []
            report("nvidia" in drivers, "the X server names the nvidia driver",
                   str(drivers))

        m = re.search(r'time\.timeZone\s*=\s*"([^"]+)"', module)
        if m:
            r = nix(tmp, "eval", "--raw", f"{ref}.time.timeZone")
            report(r.stdout == m.group(1), f"the time zone is {m.group(1)}",
                   r.stdout[:60])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


main()
if failures:
    print(f"\n{len(failures)} check(s) failed: {', '.join(failures)}")
    sys.exit(1)
print("\nthe system evaluates and reads back correctly")
