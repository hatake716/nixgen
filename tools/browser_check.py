#!/usr/bin/env python3
"""The eleven-point browser sweep, as a command against a running nixgen.

This suite lived in session scratchpads and was rebuilt by hand for every
verification pass until it was lost one time too many (DEBUGGING.md carries
the story). Same fix as the screenshots: make it a command.

It drives the real app — real search, real file inputs, real Check syntax —
and asserts the eleven points the release passes have always checked:

   1. every preset at once, plus a searched package, parses cleanly
   2. the archive holds three files and the module holds every marker
   3. importing nixgen's own generated.nix parses at once, and re-picking
      the desktop keeps etc and the unit at exactly one definition each
   4. a desktop walk ends with exactly one display manager, allowUnfree
      intact, no compositor leftovers
   5. the System update dialog opens bilingual and closes
   6. a duplicate-attribute file is read, named, and collapsed to one card
   7. i18n.inputMethod.type = null is repaired to fcitx5
   8. an aarch64 configuration.nix unhides the Architecture field
   9. no space between two Japanese characters anywhere rendered
  10. no sideways scroll at 320 / 390 / 768 / 1800 px
  11. the mobile bottom bar switches panes

Usage — the same shell recipe as tools/shots.py:

    # in one terminal
    python3 build/server.py --db data/nixgen.sqlite --port 8824 --no-browser

    # in another
    nix shell --impure --expr \\
      '(import <nixpkgs> {}).python3.withPackages (ps: [ ps.playwright ])' \\
      --command env \\
      PLAYWRIGHT_BROWSERS_PATH=$(nix build nixpkgs#playwright-driver.browsers \\
                                  --no-link --print-out-paths) \\
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \\
      python3 tools/browser_check.py http://127.0.0.1:8824/ [outdir]

With an outdir, the three files of point 2 and the round-tripped module of
point 3 are saved there — tools/eval_check.py takes that directory and
evaluates it as a real NixOS system, which is the check this one cannot do:
Check syntax is nix-instantiate --parse and judges no types.

Test craft, learned the hard way (DEBUGGING.md §4): read code through
textContent and state, never inner_text; wait for settled() before reading
generatedText; and when a point fails, suspect the test first — most
"failures" so far were the test measuring a hidden element or asserting an
old expectation.
"""

import re
import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8824/"
OUT = sys.argv[2] if len(sys.argv) > 2 else None

failures = []


def report(ok, name, detail=""):
    print(f"  {'OK  ' if ok else 'FAIL'} {name}" + (f" — {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def set_select(page, sel, value):
    page.evaluate(
        "([sel, v]) => { const s = document.querySelector(sel);"
        " s.value = v; s.dispatchEvent(new Event('change')); }",
        [sel, value])


def settled_text(page):
    """Force the debounced render and return the module text.

    `settled()` answers false when the last render failed, and throwing that
    away meant every assertion below could be measured against the file as it
    was before the change — a pass that proves the previous point. The marker
    goes into the text so the caller fails rather than compares happily.
    """
    ok, text = page.evaluate(
        "async () => { const ok = await settled(); return [ok, generatedText]; }")
    if not ok:
        return "RENDER-FAILED\n" + (text or "")
    return text


def check_syntax(page, timeout_ms=10000):
    """Press Check syntax and read the verdict it puts in the status bar.

    The bar is cleared first, and that is load-bearing: the handler begins
    `if (!await settled()) return;` and so can answer nothing at all, while
    this function is called seven times against one cumulative session. Without
    the clear, a verdict left over from the previous point is sitting there to
    be read as this point's pass — the sweep could go green on an app that had
    stopped answering. Every terminal verdict the app can print is listed, so a
    string this does not know fails on the timeout instead of being mistaken
    for one it does.
    """
    page.evaluate("document.querySelector('#status').textContent = ''")
    page.click("#btn-check")
    for _ in range(timeout_ms // 250):
        page.wait_for_timeout(250)
        s = page.text_content("#status") or ""
        if ("Parses cleanly" in s or "All three parse cleanly" in s
                or "could not parse" in s or "解析でき" in s
                or "nix-instantiate not found" in s):
            return s
    return "NO VERDICT: " + (page.text_content("#status") or "")


def import_file(page, selector, name, text, wait_ms=2500):
    page.set_input_files(selector, files=[{
        "name": name, "mimeType": "text/plain", "buffer": text.encode()}])
    page.wait_for_timeout(wait_ms)


def add_package(page, name):
    page.click('#pane-catalog .tab[data-kind="packages"]')
    page.wait_for_timeout(400)
    page.fill("#q", name)
    page.wait_for_timeout(1200)
    page.locator("#results .row").first.click()
    page.wait_for_timeout(700)


def pick_preset(page, sel, value, btn, wait):
    """The preset rows live on the Options tab and are hidden elsewhere, so a
    real click has to go there first — which is also where a user would be."""
    page.click('#pane-catalog .tab[data-kind="options"]')
    page.wait_for_timeout(300)
    set_select(page, sel, value)
    page.click(btn)
    page.wait_for_timeout(wait)


DM_LINES = [
    "services.displayManager.gdm.enable = true",
    "services.displayManager.sddm.enable = true",
    "services.xserver.displayManager.lightdm.enable = true",
    "services.displayManager.cosmic-greeter.enable = true",
]

# Hiragana, katakana, and the unified ideographs. A space between two of
# these is never right; a space after Latin is (see CLAUDE.md).
JP_GAP = re.compile(
    "[ぁ-ゟ゠-ヿ㐀-䶿一-鿿]"
    "[  ]+"
    "[ぁ-ゟ゠-ヿ㐀-䶿一-鿿]")


def gap_hits(page):
    return JP_GAP.findall(page.evaluate("document.body.innerText"))


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--hide-scrollbars"])
    page = browser.new_page(viewport={"width": 1400, "height": 1000})
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_timeout(1800)
    build = page.evaluate("BUILD")
    print(f"against {BASE} build {build}")

    # Pin the flake to the indexed commit: the saved bundle is what
    # tools/eval_check.py evaluates, and only the pinned form promises that
    # the option list and the built system are the same tree.
    page.select_option("#s-pin", "commit")
    page.wait_for_timeout(800)

    # ---- 1. every preset at once, plus a searched package ------------------
    for sel, value, btn, wait in [
        ("#s-kernel", "lts", "#btn-kernel", 700),
        ("#s-shell", "fish", "#btn-shell", 700),
        ("#s-desktop", "sway", "#btn-desktop", 1500),
        ("#s-gpu", "nvidia", "#btn-gpu", 900),
        ("#s-lang", "ja", "#btn-lang", 1500),
        ("#s-region", "Asia/Tokyo", "#btn-region", 700),
    ]:
        pick_preset(page, sel, value, btn, wait)
    page.click('#pane-catalog .tab[data-kind="options"]')
    page.wait_for_timeout(300)
    page.click("#btn-flatpak")
    page.wait_for_timeout(1200)
    add_package(page, "htop")
    text = settled_text(page)
    status = check_syntax(page)
    report("Parses cleanly" in status, "all presets at once parse cleanly", status[:120])

    # ---- 2. the archive and the markers ------------------------------------
    markers = {
        "allowUnfree": "nixpkgs.config.allowUnfree = true",
        "sway etc": 'environment.etc."sway/config"',
        "keyring role": "services.gnome.gnome-keyring.enable",
        "keyring pam": "security.pam.services.login.enableGnomeKeyring",
        "wayland layout": "XKB_DEFAULT_LAYOUT",
        "time zone": 'time.timeZone = "Asia/Tokyo"',
        "autostart unit": "systemd.user.services",
        "shell module": "programs.fish.enable",
        "kernel": "boot.kernelPackages",
        "input method": '"fcitx5"',
        "searched package": "htop",
        "build header": build,
    }
    missing = [k for k, v in markers.items() if v not in text]
    report(not missing, "generated.nix holds every marker", f"missing: {missing}")

    bundle = page.evaluate("""async () => {
      const res = await fetch('/api/bundle', {method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({host: document.querySelector('#s-host').value,
          files: {'configuration.nix': state.starter['configuration.nix'] || '',
                  'flake.nix': state.starter['flake.nix'] || '',
                  'generated.nix': generatedText}})});
      const buf = await new Response(
        res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      const u8 = new Uint8Array(buf), names = [], dec = new TextDecoder();
      for (let off = 0; off + 512 <= u8.length; ) {
        const name = dec.decode(u8.slice(off, off + 100)).replace(/\\0.*$/, '');
        if (!name) break;
        const size = parseInt(dec.decode(u8.slice(off + 124, off + 136))
                              .replace(/\\0.*$/, '').trim(), 8) || 0;
        names.push(name);
        off += 512 + Math.ceil(size / 512) * 512;
      }
      return {names, host: document.querySelector('#s-host').value,
              conf: state.starter['configuration.nix'],
              flake: state.starter['flake.nix']};
    }""")
    want = {f"{bundle['host']}/{n}"
            for n in ("configuration.nix", "flake.nix", "generated.nix")}
    report(set(bundle["names"]) == want, "archive holds three files in a directory",
           str(bundle["names"]))
    if OUT:
        import os
        os.makedirs(OUT, exist_ok=True)
        for fname, content in [("configuration.nix", bundle["conf"]),
                               ("flake.nix", bundle["flake"]),
                               ("generated.nix", text)]:
            with open(os.path.join(OUT, fname), "w") as fh:
                fh.write(content)

    # ---- 3. the round trip --------------------------------------------------
    import_file(page, "#file-gen", "generated.nix", text)
    mid = settled_text(page)
    two_shapes = "Defined inside" in page.evaluate(
        "document.querySelector('#status').textContent")
    status = check_syntax(page)
    report("Parses cleanly" in status and not two_shapes,
           "importing our own module parses at once", status[:120])

    pick_preset(page, "#s-desktop", "sway", "#btn-desktop", 1500)
    after = settled_text(page)
    counts = {
        "etc": len(re.findall(r'environment\.etc\."sway/config"', after)),
        "unit": len(re.findall(r"systemd\.user\.services", after)),
        "layout": len(re.findall(r"XKB_DEFAULT_LAYOUT", after)),
    }
    status = check_syntax(page)
    report(counts["etc"] == 1 and counts["unit"] == 1 and counts["layout"] == 1
           and "Parses cleanly" in status,
           "re-picking the desktop keeps single definitions", str(counts))
    lost = [k for k, v in markers.items() if v not in after]
    report(not lost, "nothing was lost in the round trip", f"missing: {lost}")
    if OUT:
        with open(f"{OUT}/generated-roundtrip.nix", "w") as fh:
            fh.write(after)

    # ---- 4. the desktop walk ------------------------------------------------
    walk_ok, walk_detail = True, []
    for desk in ["gnome", "niri", "xfce", "cosmic"]:
        pick_preset(page, "#s-desktop", desk, "#btn-desktop", 1500)
        t = settled_text(page)
        dm = sum(1 for line in DM_LINES if line in t)
        noctalia = t.count("noctalia")
        good = (dm == 1 and "nixpkgs.config.allowUnfree = true" in t
                and (noctalia > 0 if desk == "niri" else noctalia == 0)
                and (("xwayland-satellite" in t) == (desk == "niri")))
        walk_ok &= good
        walk_detail.append(f"{desk}: dm={dm} noctalia={noctalia}")
    status = check_syntax(page)
    report(walk_ok and "Parses cleanly" in status,
           "desktop walk: one DM, unfree kept, no leftovers", "; ".join(walk_detail))

    # ---- 5. the System update dialog ---------------------------------------
    page.click("#btn-update")
    page.wait_for_timeout(600)
    dlg = page.evaluate("""() => {
      const d = document.querySelector('#dlg');
      return {open: d.open, text: d.querySelector('.dlg-body').textContent};
    }""")
    bilingual = (re.search("[ぁ-ゟ゠-ヿ一-鿿]", dlg["text"])
                 and re.search("[A-Za-z]{4}", dlg["text"]))
    page.click("#dlg-no")
    page.wait_for_timeout(400)
    closed = not page.evaluate("document.querySelector('#dlg').open")
    report(dlg["open"] and bool(bilingual) and closed,
           "System update dialog opens bilingual and closes")

    # ---- 6. a duplicate-attribute file --------------------------------------
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_timeout(1500)
    import_file(page, "#file", "configuration.nix",
                "{ config, pkgs, ... }:\n{\n"
                "  nix.settings = { cores = 4; };\n"
                "  nix.settings.cores = 8;\n"
                "  services.openssh.enable = true;\n}\n")
    notice = page.text_content("#notice") or ""
    t = settled_text(page)
    named = "nix.settings.cores" in notice and (
        "defined twice" in notice or "2回定義" in notice)
    collapsed = len(re.findall(r"\bcores\b", t)) == 1 and "cores = 8" in t
    status = check_syntax(page)
    report(named and collapsed and "Parses cleanly" in status,
           "duplicate attribute is read, named, one card wins",
           f"named={named} collapsed={collapsed}")

    # ---- 7. type = null is repaired ----------------------------------------
    import_file(page, "#file", "configuration.nix",
                "{ config, pkgs, ... }:\n{\n"
                "  i18n.inputMethod.enable = true;\n"
                "  i18n.inputMethod.type = null;\n}\n")
    t = settled_text(page)
    status = check_syntax(page)
    report('i18n.inputMethod.type = "fcitx5"' in t and "Parses cleanly" in status,
           "a null input method is repaired to fcitx5")

    # ---- 8. aarch64 unhides the architecture --------------------------------
    import_file(page, "#file", "configuration.nix",
                "{ config, pkgs, ... }:\n{\n"
                "  imports = [ ./hardware-configuration.nix ];\n"
                '  networking.hostName = "pi";\n'
                '  nixpkgs.hostPlatform = "aarch64-linux";\n'
                '  system.stateVersion = "26.05";\n}\n')
    arch = page.evaluate("""() => ({
      visible: !document.querySelector('#s-system-wrap').hidden,
      value: document.querySelector('#s-system').value,
      flake: (state.starter['flake.nix'] || '').includes('aarch64-linux')})""")
    report(arch["visible"] and arch["value"] == "aarch64-linux" and arch["flake"],
           "aarch64 brings the Architecture field back", str(arch))

    # ---- 9. no gaps between Japanese characters -----------------------------
    hits = list(gap_hits(page))          # a page full of import notices
    # ---- 10. no sideways scroll at any width --------------------------------
    widths_ok, widths_detail = True, []
    for w, h in [(320, 700), (390, 844), (768, 1024), (1800, 1000)]:
        page.set_viewport_size({"width": w, "height": h})
        page.wait_for_timeout(400)
        over = page.evaluate("document.scrollingElement.scrollWidth"
                             " > document.scrollingElement.clientWidth")
        widths_ok &= not over
        widths_detail.append(f"{w}px{'!' if over else ''}")
    report(widths_ok, "no sideways scroll at 320/390/768/1800",
           " ".join(widths_detail))

    page.set_viewport_size({"width": 1400, "height": 1000})
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_timeout(1500)
    hits += gap_hits(page)               # the five steps and the Setup tab
    for kind in ["options", "packages"]:
        page.click(f'#pane-catalog .tab[data-kind="{kind}"]')
        page.wait_for_timeout(500)
        hits += gap_hits(page)
    page.click("#btn-update")
    page.wait_for_timeout(500)
    hits += gap_hits(page)
    page.click("#dlg-no")
    report(not hits, "no space between two Japanese characters", str(hits[:5]))

    # ---- 11. the mobile bottom bar ------------------------------------------
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(500)
    nav = page.evaluate("""async () => {
      const visible = el => el && getComputedStyle(el).display !== 'none'
                             && el.offsetParent !== null;
      const bar = getComputedStyle(document.querySelector('.mobilebar'))
                    .display !== 'none';
      const steps = [];
      for (const pane of ['pane-editor', 'pane-out', 'pane-catalog']) {
        document.querySelector('.mobilebar .tab[data-pane="' + pane + '"]').click();
        await new Promise(r => setTimeout(r, 350));
        steps.push([pane, ['pane-catalog', 'pane-editor', 'pane-out']
          .filter(x => visible(document.getElementById(x)))]);
      }
      return {bar, steps};
    }""")
    nav_ok = nav["bar"] and all(vis == [want] for want, vis in nav["steps"])
    report(nav_ok, "mobile bottom bar switches panes", str(nav["steps"]))

    browser.close()

if failures:
    print(f"\n{len(failures)} point(s) failed: {', '.join(failures)}")
    sys.exit(1)
print("\nall eleven points pass")
