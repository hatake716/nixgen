"""Retake docs/screenshot*.png against a running nixgen.

The three images are the homepage and both READMEs' first impression, and they
went three features out of date because retaking them was a manual chore.
This makes it a command.

Drives the real app rather than mocking anything, so what lands on the homepage
is what the tool actually does — including the build id and the option counts,
which is how you can tell at a glance whether a shot is stale.

**Each shot is taken twice, light and dark**, because the homepage carries both
and swaps them with its own toggle. The dark ones get a `-dark` suffix. The
theme is set in localStorage before the page loads, which is where the app
looks first — the same switch a reader would flip, rather than a class poked
in afterwards.

    # in one terminal
    python3 build/server.py --db data/nixgen.sqlite --port 8824 --no-browser

    # in another
    nix shell --impure --expr \\
      '(import <nixpkgs> {}).python3.withPackages (ps: [ ps.playwright ])' \\
      --command env \\
      PLAYWRIGHT_BROWSERS_PATH=$(nix build nixpkgs#playwright-driver.browsers \\
                                  --no-link --print-out-paths) \\
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \\
      python3 tools/shots.py http://127.0.0.1:8824/ docs

Playwright is not in the flake's devShell on purpose: it pulls a browser, and
this runs about as often as the UI changes shape.

Check the result before committing it. The index the server is serving decides
the counts and the "published today" line, so build it fresh first — a shot
that says the list is eleven days old is a worse advertisement than an old
screenshot.
"""

import sys

from playwright.sync_api import sync_playwright

BASE, OUT = sys.argv[1], sys.argv[2]
W, H = 1800, 1256

PACKAGES = ["fastfetch", "fish", "neovim", "ripgrep"]

# A configuration from a machine a release or two behind, which is the case
# the import is for. `hardware.opengl.enable` and `sound.enable` are both gone
# from current NixOS, so the shot shows the group that matters most: the lines
# carried over as written, which nixos-rebuild will reject if left alone.
SAMPLE = '''{ config, pkgs, lib, ... }:

{
  imports = [
    ./hardware-configuration.nix
  ];

  boot.loader.systemd-boot.enable = true;
  boot.kernelParams = [ "quiet" "splash" ];

  networking.hostName = "desktop";
  networking.networkmanager.enable = true;
  networking.firewall.allowedTCPPorts = [ 22 80 443 ];
  time.timeZone = "Asia/Tokyo";

  hardware.opengl.enable = true;
  sound.enable = true;

  services.openssh = {
    enable = true;
    settings.PermitRootLogin = "no";
  };

  environment.systemPackages = with pkgs; [
    firefox
    git
    ripgrep
  ];

  environment.sessionVariables.EDITOR = "vim";

  system.stateVersion = "26.05";
}
'''


def card(page, path):
    return page.locator(f'.card[data-path="{path}"]')


def add_option(page, query, path):
    """Type a query, click the first result, wait for the card to appear."""
    page.fill("#q", query)
    page.wait_for_timeout(900)
    page.locator("#results > *").first.click()
    card(page, path).wait_for(timeout=5000)
    page.wait_for_timeout(400)


def shoot(browser, theme):
    """Every shot, in one theme. `suffix` is what tells the files apart."""
    suffix = "-dark" if theme == "dark" else ""
    context = browser.new_context(viewport={"width": W, "height": H},
                                  device_scale_factor=1,
                                  color_scheme=theme)
    # Set before any page script runs: the app reads the saved choice first
    # and only then asks the system, so this is the reader's own switch
    # rather than something forced on top afterwards.
    context.add_init_script(
        "try { localStorage.setItem('theme', %r); } catch (e) {}" % theme)
    page = context.new_page()

    # ----------------------------------------------------------- setup tab
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_timeout(1800)
    page.fill("#s-host", "desktop")
    page.fill("#s-user", "takeshi")
    page.fill("#s-groups", "wheel networkmanager video docker")
    page.select_option("#s-pin", "commit")
    page.wait_for_timeout(1200)
    page.click('.filetabs .tab[data-file="configuration.nix"]')
    page.wait_for_timeout(600)
    page.screenshot(path=f"{OUT}/screenshot-setup{suffix}.png")
    print(f"wrote screenshot-setup{suffix}.png")

    # ---------------------------------------------- the catalogue in use
    page.click('#pane-catalog .tab[data-kind="options"]')
    page.wait_for_timeout(500)

    add_option(page, "time.timeZone", "time.timeZone")
    card(page, "time.timeZone").locator('.control input[type="text"]').fill("Asia/Tokyo")

    add_option(page, "services.openssh.enable", "services.openssh.enable")
    card(page, "services.openssh.enable").locator(".toggle input").check()

    add_option(page, "networking.firewall.allowedTCPPorts",
               "networking.firewall.allowedTCPPorts")
    ports = card(page, "networking.firewall.allowedTCPPorts")
    ports.locator("button.mini").click()
    ports.locator(".items input").first.fill("22")

    add_option(page, "services.xserver.xkb.layout", "services.xserver.xkb.layout")
    card(page, "services.xserver.xkb.layout").locator('.control input[type="text"]').fill("jp")

    # Packages, added the way anyone would: search, click.
    page.click('#pane-catalog .tab[data-kind="packages"]')
    page.wait_for_timeout(500)
    for name in PACKAGES:
        page.fill("#q", name)
        page.wait_for_timeout(900)
        page.locator("#results > *").first.click()
        page.wait_for_timeout(500)

    # Leave a search in the box, so the pane is showing what it is for.
    page.fill("#q", "tailscale")
    page.wait_for_timeout(1000)
    page.click('.filetabs .tab[data-file="generated.nix"]')
    page.wait_for_timeout(1000)
    page.screenshot(path=f"{OUT}/screenshot{suffix}.png")
    print(f"wrote screenshot{suffix}.png")

    # -------------------------------------------------- reading a file in
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_timeout(1800)
    page.set_input_files("#file", files=[{
        "name": "desktop.nix",
        "mimeType": "text/plain",
        "buffer": SAMPLE.encode(),
    }])
    page.wait_for_timeout(2500)
    # The catalogue, not the starter form: what the shot is about is the
    # summary of where every line went, and that sits above the module.
    page.click('#pane-catalog .tab[data-kind="options"]')
    page.wait_for_timeout(700)
    page.evaluate("const b = document.querySelector('#editor').parentElement;"
                  "if (b) b.scrollTop = 0;")
    page.wait_for_timeout(400)
    page.screenshot(path=f"{OUT}/screenshot-import{suffix}.png")
    print(f"wrote screenshot-import{suffix}.png")
    context.close()


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--hide-scrollbars"])
    for theme in ("light", "dark"):
        shoot(browser, theme)
    browser.close()
