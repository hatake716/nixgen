#!/usr/bin/env python3
"""Every name the presets promise, checked against the channel that is indexed.

NixOS ships a numbered release every six months, and nixpkgs renames things
between them. This repository already carries the scars: `gdm` and `sddm` left
`services.xserver` and `lightdm` did not, `plasma5` is gone, `hardware.pulseaudio`
became `services.pulseaudio`, `superTuxKart` became `supertuxkart`, and the whole
`xfce.*` scope was flattened. The app survives all of that by design — a preset
names candidates and takes the first the catalogue has, and a package that does
not come back is simply absent — so nothing crashes. **That is exactly the
problem.** A name that has gone stale produces no error, no warning and no
crash. It produces a row that is quietly missing, or a preset that quietly
writes one setting fewer than it says.

So this is the tool to run when a new release lands: it asks the running app
for every catalogue-facing name its presets hold, asks the index which of them
still exist, and prints what no longer resolves.

It reads the preset tables out of the live page rather than parsing app.js.
They are top-level `const`s in a classic script, so `page.evaluate` can see
them by name, and reading them from the app that uses them means this tool
cannot drift from the thing it checks — the failure mode a second copy of the
list would have.

Three kinds of answer, and the difference between them is the whole point:

  BROKEN     a candidate group where nothing survives. The preset writes one
             setting fewer than it promises, silently. Fix before shipping.
  UNRESOLVED a package name with no live sibling spelling. The row is missing
             from its category and nobody is told. Fix before shipping.
  legacy     a spelling that does not resolve but whose group has a survivor.
             Expected and wanted: nixgen offers the current release and the two
             before it, so the old spelling is what keeps the older ones
             working. Printed under -v only, so this tool does not cry wolf.

The kernel list gets its own check, because it cannot be answered from the
index at all: which series are LTS is kernel.org's designation, and nothing in
the catalogue records it. So the tool prints the series this channel ships that
are newer than anything on `KERNELS.lts`, and asks a human to go and look. That
check found 6.18 — designated LTS, shipped by the channel, missing from the
list, so "LTS" was handing out a two-year-older kernel.

Usage — the same shell recipe as tools/browser_check.py:

    # in one terminal
    python3 build/server.py --db data/nixgen.sqlite --port 8824 --no-browser

    # in another
    nix shell --impure --expr \\
      '(import <nixpkgs> {}).python3.withPackages (ps: [ ps.playwright ])' \\
      --command env \\
      PLAYWRIGHT_BROWSERS_PATH=$(nix build nixpkgs#playwright-driver.browsers \\
                                  --no-link --print-out-paths) \\
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \\
      python3 tools/catalogue_check.py http://127.0.0.1:8824/ [-v]

Exit status is 0 when nothing is BROKEN or UNRESOLVED, so CI can run it as a
gate on whichever channel the index was built from.
"""

import json
import sys
import urllib.parse
import urllib.request

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8824/"
VERBOSE = "-v" in sys.argv[2:]

# The endpoints cap a request at 40 names, because nothing but the curated
# lists should be asking for many at once. Stay under it.
BATCH = 35

# Read every catalogue-facing name out of the preset tables. Kept as one
# expression so the shapes are described in one place: when a preset grows a
# new field that names an option or a package, it goes here, and until it does
# this tool will quietly not check it. That is the one way this tool can lie,
# so the shapes below are listed in the order the tables appear in app.js —
# read them side by side when adding a preset.
EXTRACT = r"""() => {
  const groups = [];   // option candidates: a group is fine if any survives
  const pkgs = [];     // package candidates: same rule, usually one deep
  const opt = (label, cands) => groups.push({ label, names: [].concat(cands) });
  const pkg = (label, cands) => pkgs.push({ label, names: [].concat(cands) });
  // A shell's package and a kernel's expression are Nix source, not bare
  // attributes: `pkgs.bashInteractive` is the name plus a prefix this side
  // put on. Ask about the attribute.
  const bare = e => String(e).replace(/^pkgs\./, '');

  for (const [k, d] of Object.entries(DESKTOPS)) {
    (d.roles || []).forEach((r, i) => opt(`DESKTOPS.${k}.roles[${i}]`, r));
    if (d.marker) opt(`DESKTOPS.${k}.marker`, d.marker);
    (d.packages || []).forEach(p => pkg(`DESKTOPS.${k}.packages`, p));
  }
  for (const [k, v] of Object.entries(GREETERS)) opt(`GREETERS.${k}`, v);
  for (const [k, s] of Object.entries(SHELLS)) {
    if (s.module) opt(`SHELLS.${k}.module`, s.module);
    if (s.pkg) pkg(`SHELLS.${k}.pkg`, bare(s.pkg));
  }
  for (const [k, f] of Object.entries(FRONTENDS)) {
    (f.roles || []).forEach(r => opt(`FRONTENDS.${k}.roles`, r));
    (f.packages || []).forEach(p => pkg(`FRONTENDS.${k}.packages`, p));
  }
  for (const [k, g] of Object.entries(GPUS)) {
    (g.extras || []).forEach(p => pkg(`GPUS.${k}.extras`, p));
  }
  for (const [k, a] of Object.entries(AUDIO)) {
    (a.steps || []).forEach((s, i) => opt(`AUDIO.${k}.steps[${i}]`, s.paths));
  }
  // The presets that build their steps per choice keep their paths in a table
  // of their own, so the contract is visible here rather than buried in the
  // function. A preset whose paths are not in one of these is a preset this
  // tool cannot check.
  for (const [table, name] of [[GPU_PATHS, 'GPU_PATHS'],
                               [LANG_PATHS, 'LANG_PATHS'],
                               [FLATPAK_PATHS, 'FLATPAK_PATHS'],
                               [SHELL_PATHS, 'SHELL_PATHS'],
                               [KERNEL_PATHS, 'KERNEL_PATHS'],
                               [REGION_PATHS, 'REGION_PATHS'],
                               [DESKTOP_PATHS, 'DESKTOP_PATHS']]) {
    for (const [field, cands] of Object.entries(table)) {
      opt(`${name}.${field}`, cands);
    }
  }
  pkg('FLATPAK portal backend', FLATPAK_PORTAL_GTK);
  // The input method: enabled and chosen as one unit, and its addons are
  // package names written straight into a value.
  for (const [k, L] of Object.entries(LANGUAGES)) {
    (L.addons || []).forEach(a => pkg(`LANGUAGES.${k}.addons`, a));
  }
  for (const [k, kern] of Object.entries(KERNELS)) {
    // One group: the whole point of the list is that the first hit wins.
    pkg(`KERNELS.${k}`, (kern.try || []).map(t => t.probe));
  }
  // A category entry is either a name or, where nixpkgs has renamed one, an
  // array of spellings — same rule as a role's candidates.
  for (const [cat, list] of Object.entries(APPS)) {
    (list || []).forEach(a => pkg(`APPS.${cat}`, a));
  }
  return {
    groups, pkgs,
    // Named one at a time rather than swept up, so a constant that stops
    // being used stops being checked instead of silently passing.
    fixed: [
      ['environment.systemPackages', TOP_OPTION],
      ['environment.etc', ETC_PATH],
      ['systemd.user.services', AUTOSTART_PATH],
      ['keyring role', KEYRING_ENABLE],
      ['keyring pam', KEYRING_PAM.join('.')],
    ],
    ltsSeries: (KERNELS.lts.try || []).map(t => t.probe),
  };
}"""


def ask(kind, key, names):
    """Which of these the index has, asked in batches the endpoints allow."""
    found = set()
    names = sorted(set(names))
    for i in range(0, len(names), BATCH):
        chunk = names[i:i + BATCH]
        url = "%sapi/%s?%s=%s" % (
            BASE.rstrip("/") + "/", kind, key,
            urllib.parse.quote(",".join(chunk)))
        with urllib.request.urlopen(url, timeout=60) as r:
            for row in json.load(r).get("results", []):
                found.add(row.get("path") or row.get("attr"))
    return found


def instantiations(path):
    """The placeholder forms a concrete path could be an instance of.

    21% of the catalogue holds a placeholder, and a preset that writes under
    one writes a concrete name: the app sets
    `security.pam.services.login.enableGnomeKeyring`, while the catalogue only
    ever knew `security.pam.services.<name>.enableGnomeKeyring`. Asking for the
    concrete path alone reported the keyring role as broken when it is not —
    the tool's own first false positive, and the reason this exists. Which
    segment is the instance cannot be known from the path, so every segment is
    offered as the candidate and one hit is enough.
    """
    parts = path.split(".")
    return ["%s.<name>.%s" % (".".join(parts[:i]), ".".join(parts[i + 1:]))
            for i in range(1, len(parts) - 1)]


def resolves(path, have):
    return path in have or any(p in have for p in instantiations(path))


def channel_series(have_any):
    """Kernel series this channel ships, newest first, as `6_18` style keys.

    Asked through the search endpoint rather than the database, so this tool
    needs nothing but the running app — the same reason everything else here
    goes through HTTP.
    """
    url = BASE.rstrip("/") + "/api/search?q=linuxKernel.kernels.linux&kind=packages&limit=200"
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            rows = json.load(r).get("results", [])
    except Exception:
        return []
    out = []
    for row in rows:
        attr = row.get("attr", "")
        tail = attr.replace("linuxKernel.kernels.linux_", "")
        if attr.startswith("linuxKernel.kernels.linux_") and tail.replace("_", "").isdigit():
            out.append((tail, row.get("version") or ""))
    def key(t):
        return [int(x) for x in t[0].split("_")]
    return sorted(out, key=key, reverse=True)


def mainline_series():
    """The series `linux_latest` points at, as `7_1`, or None.

    Mainline is the line above which nothing has been named longterm yet, so
    it is where the kernel question stops.
    """
    url = BASE.rstrip("/") + "/api/packages?attrs=linux_latest"
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            rows = json.load(r).get("results", [])
    except Exception:
        return None
    if not rows:
        return None
    parts = (rows[0].get("version") or "").split(".")
    return "_".join(parts[:2]) if len(parts) >= 2 else None


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(BASE)
        page.wait_for_timeout(1800)
        meta = page.evaluate("() => ({ channel: state.channel, build: BUILD })")
        data = page.evaluate(EXTRACT)
        browser.close()

    print("against %s   channel %s   build %s"
          % (BASE, meta["channel"], meta["build"]))

    opt_names = [n for g in data["groups"] for n in g["names"]]
    opt_names += [v for _, v in data["fixed"]]
    # Ask about the placeholder forms in the same breath, so a preset writing
    # under a submodule is not reported as broken.
    opt_names += [p for n in list(opt_names) for p in instantiations(n)]
    pkg_names = [n for g in data["pkgs"] for n in g["names"]]
    have_opt = ask("options", "paths", opt_names)
    have_pkg = ask("packages", "attrs", pkg_names)

    broken, unresolved, legacy = [], [], []
    for g in data["groups"]:
        live = [n for n in g["names"] if resolves(n, have_opt)]
        if not live:
            broken.append((g["label"], g["names"]))
        else:
            legacy += [(g["label"], n) for n in g["names"]
                       if not resolves(n, have_opt)]
    for label, path in data["fixed"]:
        if not resolves(path, have_opt):
            broken.append((label, [path]))
    for g in data["pkgs"]:
        live = [n for n in g["names"] if n in have_pkg]
        if not live:
            unresolved.append((g["label"], g["names"]))
        else:
            legacy += [(g["label"], n) for n in g["names"] if n not in have_pkg]

    print("  %d option groups, %d package entries, %d fixed paths"
          % (len(data["groups"]), len(data["pkgs"]), len(data["fixed"])))

    for label, names in broken:
        print("  BROKEN      %-34s no candidate exists: %s"
              % (label, ", ".join(names)))
    for label, names in unresolved:
        print("  UNRESOLVED  %-34s %s" % (label, ", ".join(names)))
    if VERBOSE:
        for label, name in sorted(legacy):
            print("  legacy      %-34s %s" % (label, name))
    elif legacy:
        print("  (%d spellings that do not resolve here but whose entry has a "
              "live one — run with -v to list them)" % len(legacy))

    # The kernel question the index cannot answer.
    lts = [s.replace("linuxKernel.kernels.linux_", "") for s in data["ltsSeries"]]
    newest_listed = lts[0] if lts else None
    shipped = channel_series(have_pkg)
    def as_nums(s):
        return [int(x) for x in s.split("_")]
    # Mainline is always newer than the newest longterm series, so flagging
    # everything above the head of the list would fire on every run of a
    # perfectly current tree — and a check that always fires is one nobody
    # reads. The series the channel calls `latest` is by definition not
    # longterm yet, so it and anything above it are excluded; what is left is
    # the band where a new LTS actually appears.
    latest = mainline_series()
    ahead = [(s, v) for s, v in shipped
             if newest_listed and as_nums(s) > as_nums(newest_listed)
             and not (latest and as_nums(s) >= as_nums(latest))]
    kernel_note = False
    if ahead:
        kernel_note = True
        print("  CHECK       KERNELS.lts leads with %s; this channel also ships %s."
              % (newest_listed,
                 ", ".join("%s (%s)" % (s.replace("_", "."), v) for s, v in ahead)))
        print("              Whether any of those is longterm is kernel.org's "
              "call, not the index's —")
        print("              see https://www.kernel.org/category/releases.html "
              "and put any that is")
        print("              on the front of KERNELS.lts.")

    print()
    if broken or unresolved:
        print("%d broken, %d unresolved — the presets promise names this channel "
              "does not have." % (len(broken), len(unresolved)))
        return 1
    if kernel_note:
        print("every name resolves; the kernel list has a question above it.")
        return 0
    print("every name the presets hold resolves on this channel.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
