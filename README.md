# nixgen

A form for every NixOS option. Search all 24,517 options and 144,200 packages
in the stable channel, fill in values with real widgets, and get a `.nix`
module you can import.

![nixgen](docs/screenshot.png)

- **Search** the whole catalogue — every option and every package, not a
  curated subset.
- **Import** your existing `configuration.nix`. It is read, never written to.
- **Scaffold** a new machine: the Setup tab writes the `configuration.nix` and
  `flake.nix` that go around the generated module.

Python's standard library and a browser. No pip, no npm, no build step.

日本語版: [README.ja.md](./README.ja.md) ·
Homepage: <https://hatake716.github.io/nixgen/>

---

## Installing

You need NixOS, or Nix on another Linux. You do not need to clone anything.

### Step 1 — Turn on flakes

A fresh NixOS install does not have flakes enabled. Check with:

```bash
nix flake --help
```

If that prints help text, skip to step 2. If it says the feature is disabled,
add this line to your configuration:

```nix
nix.settings.experimental-features = [ "nix-command" "flakes" ];
```

Apply it, then run `nix flake --help` again to confirm:

```bash
sudo nixos-rebuild switch
```

### Step 2 — Run it

```bash
nix run github:hatake716/nixgen
```

That is the whole installation.

**The first run takes about five minutes.** In order, it:

1. builds a small wrapper around Python
2. downloads about 10 MB of option and package metadata for `nixos-26.05`
3. builds a search index into `~/.local/share/nixgen` (about 37 MB)
4. deletes the raw metadata, which is no longer needed
5. opens <http://127.0.0.1:8823/> in your browser

You should see three panes: search on the left, an empty middle, and a dark
panel on the right showing the file being generated. Type `openssh` into the
search box and click the first result to check that it works.

Press **Ctrl-C** in the terminal to stop. Every run after the first starts in
about a second, because the index is already built.

### Step 3 — Keep it around (optional)

```bash
nix profile install github:hatake716/nixgen
nixgen
```

`nixgen` is now on your PATH. Remove it later with `nix profile remove nixgen`.

### Step 4 — Use what it generates

Press **Download generated.nix** and save the file next to your
`configuration.nix`, usually in `/etc/nixos/`. Add it to your imports:

```nix
{
  imports = [
    ./hardware-configuration.nix
    ./generated.nix
  ];
}
```

Check before applying:

```bash
sudo nixos-rebuild dry-build
```

If that succeeds, apply with `sudo nixos-rebuild switch`. To undo everything,
delete the `./generated.nix` line and rebuild — nothing else in your
configuration was touched.

### If something goes wrong

**`experimental Nix feature 'nix-command' is disabled`**
Step 1 was skipped, or the rebuild has not run yet.

**`does not contain a 'flake.nix', searching up`**
or **`Path 'build' does not exist in Git repository`**
You are running from a directory inside a git repository — `/etc/nixos` is the
usual culprit. Flakes read files from git, not from disk, so anything
untracked is invisible to Nix. Use the `github:` form above, or run
`git add -A` in that repository first.

**`Address already in use`**
Something else has port 8823. Use another: `nixgen --port 9000`.

**The browser did not open**
Open <http://127.0.0.1:8823/> yourself; the terminal prints the address.

**You want to start over**
`rm -rf ~/.local/share/nixgen`, then run again to rebuild the index.

---

## Using it

### Finding things

Search is the real interface — a tree of 24,517 options is unusable. Type a
service name and the option you want is normally first. The **Options** and
**Packages** tabs search the same catalogue the NixOS manual is built from.

The checkbox *Hide options that need hand-written Nix* narrows the list to the
88.3% that have a proper widget.

### Importing an existing configuration.nix

Press **Import configuration.nix** and pick your file. Everything it sets is
matched against the catalogue and loaded into the form, values and all. Your
file is opened read-only and never written to.

The file goes to `nix-instantiate --parse` first, so the real Nix parser does
the work — no regexes over your source. What comes back is a normalised,
fully-parenthesised form with `a.b.c = x` expanded into nested attribute sets,
which is then walked and flattened.

Every setting ends up in the output. Four things can happen to it:

| | What it means |
|---|---|
| **Filled into the form** | A literal that fits the widget. `lib.mkForce` and `lib.mkDefault` are unwrapped, and names in paths fill the `<name>` slot, so `services.nginx.virtualHosts."example.com".root` works. |
| **Verbatim — module structure** | `imports`, `options`, `disabledModules`. Not settings, but dropping `imports` means `hardware-configuration.nix` never loads. Relative paths are restored to `./…`. |
| **Verbatim — an expression** | `lib.mkIf`, `let` references. A form cannot hold a conditional, so the expression is copied through unchanged. |
| **Verbatim — not in this release** | Renamed, removed (`hardware.opengl.enable` is gone in 26.05), or inside a free-form submodule such as `nix.settings`. |

`imports` gets one adjustment: a reference to `./generated.nix` is removed,
because the generated file cannot import itself. If it did, `nixos-rebuild`
would fail with `stack overflow; max-call-depth exceeded` and no hint as to
where. The import summary says when this happened.

Verbatim lines are highlighted in the file pane and carry a trailing
`# verbatim` comment, so they stay obvious after you download it. They sort
into their normal alphabetical position rather than being dumped at the end.

Two things to watch. An expression that referred to a `let` binding in your
original file will not resolve on its own — **Check syntax** points at the
exact line. And an option that no longer exists will be rejected by
`nixos-rebuild`; that is the point of flagging it rather than dropping it.

### Starter files for a new machine

The **Setup** tab writes the two files that sit around the generated module: a
`configuration.nix` that imports it, and a `flake.nix` that builds the system.
The files appear under the tabs on the right, beside `generated.nix`, and
update as you type.

Everything in them is editable:

| Field | Notes |
|---|---|
| Host name | Becomes `networking.hostName` and the flake's `nixosConfigurations.<host>` |
| Main user | The account created with `isNormalUser`. Uncheck *Create the user account* to leave users out entirely. |
| Architecture | `x86_64-linux` or `aarch64-linux` |
| Boot loader | systemd-boot (UEFI), GRUB (BIOS — asks for the disk), or none if another module sets one |
| NetworkManager | Off drops `networking.networkmanager.enable` |
| Flakes | Off drops `nix.settings.experimental-features` |
| Groups | `wheel` is what lets the account use `sudo`. Add `docker`, `libvirtd`, `video`… as needed. |
| `system.stateVersion` | Defaults to the indexed release. Do not raise it to match a newer NixOS. |

Switching a block off removes its lines entirely rather than commenting them
out, so the file stays as short as what you actually asked for.

Everything in the starter `configuration.nix` is wrapped in `lib.mkDefault`.
Without that, setting the same option in both files gives you

```
error: The option `networking.hostName' has conflicting definition values
```

With it, whatever you set in nixgen simply wins.

### When both files set the same option

The starter `configuration.nix` and `generated.nix` can end up defining the
same option. Those lines are shown **in red** in the file pane, and the card
carries an *also in configuration.nix* badge.

Usually this is harmless: the starter uses `lib.mkDefault`, so a plain value in
`generated.nix` wins. It breaks when *both* sides are `lib.mkDefault`, which
happens when an imported value was an expression and kept its wrapper:

```
error: The option `networking.hostName' has conflicting definition values
```

Two definitions of equal priority, and NixOS will not guess. Delete the line
from whichever file you do not want it in.

### What "Check syntax" does and does not do

It runs `nix-instantiate --parse`, which catches malformed Nix — an unbalanced
brace, a missing semicolon. It does **not** check that a value has the right
type, or that a combination of options makes sense. `nixos-rebuild dry-build`
is the only thing that can say that, so always run it before switching.

### Reading it in another language

The page is plain HTML, so your browser's built-in translation works on it. In
Chrome, right-click anywhere and choose *Translate to…*.

Only the descriptions get translated. Option paths, package attributes, type
notation, default values and the generated Nix stay in English, because a
translated `services.openssh.enable` is no longer valid Nix. Those elements
carry `translate="no"`, but not every browser honours it, so each one also
remembers its own text and puts it back if anything rewrites it.

### Command-line options

```bash
nixgen                       # or: nix run github:hatake716/nixgen
nixgen --port 9000           # different port
nixgen --no-browser          # do not open a browser
nixgen --db /path/to/db      # use a specific index
```

| Variable | Default | Purpose |
|---|---|---|
| `NIXGEN_DATA` | `~/.local/share/nixgen` | where the index lives |
| `NIXGEN_CHANNEL` | `nixos-26.05` | which release to index |

To switch releases, delete the index and set the channel:

```bash
rm -rf ~/.local/share/nixgen
NIXGEN_CHANNEL=nixos-25.11 nixgen
```

Release channels only. Unstable is deliberately unsupported — see
*What it does not do*.

### Reaching it from another machine

The server binds to `127.0.0.1` and has no authentication, so do not move it
to `0.0.0.0` on a network you do not control. Forward a port over SSH:

```bash
ssh -L 8823:127.0.0.1:8823 your-desktop
```

Then open <http://127.0.0.1:8823/> locally.

---

## How it works

### Nothing here is written per option

NixOS publishes machine-readable metadata for every option in every release:

```
https://channels.nixos.org/nixos-26.05/options.json.br
https://channels.nixos.org/nixos-26.05/packages.json.br
```

`options.json` gives each option's path, type, default, example, description
and declaring file. The whole catalogue comes from that file, so full coverage
is a matter of parsing rather than of authoring.

The awkward part is the `type` field. It is a sentence, not a schema, and
there are 1,247 distinct ones:

```
"boolean"
"null or (list of string)"
"16 bit unsigned integer; between 0 and 65535 (both inclusive)"
"attribute set of (submodule)"
```

`nixgen_core.py` parses them into a small tree (`nullable`, `list`, `attrs`,
`enum`, `int`, `str`, `lines`, `path`, `package`, `bool`) and the UI picks a
widget per node. **21,652 of 24,517 options — 88.3% — map onto a real
widget.** The rest fall back to a Nix text box showing the type string and the
upstream example. Most of those are container parents like
`attribute set of (submodule)` whose children are separate, fully supported
options anyway, so the share you genuinely cannot fill in with a form is well
below 12%.

### Search ranking

Results are bucketed by how the query matched the path, then ordered by depth,
then by whether the leaf is `.enable`, then by how prominent the top-level
namespace is.

Whole-segment matching does most of the work. Typing `firewall` puts
`networking.firewall.enable` first because `firewall` is a complete path
segment there, while `services.firewalld.enable` only contains it as a
substring. The namespace weights in `build_index.py` (`NS_RANK`) are a plain
heuristic and only ever break ties — they never change what is found.

### Correctness

The renderer is fuzzed against the real Nix parser: 8,000 randomly chosen
options per run, seeded with hostile values (embedded quotes, backslashes,
`${`, newlines, `''`, empty strings, Japanese text) and hostile `<name>`
substitutions including Nix keywords. Every run parses.

Three real bugs came out of that:

| Bug | Why it matters |
|---|---|
| Placeholders are not only `<name>` — also `<n>`, `*`, and upstream artifacts like `<imports = [ pkgs.ghostunnel... ]>` | 5,080 options (21%) contain one |
| `[ -1 ]` is a syntax error; negative numbers need parentheses | any `signed integer` inside a list |
| `if`, `rec`, `or`, `let`… are reserved and must be quoted as attribute names | a systemd service literally named `if` |

Attribute paths are rendered segment by segment, and any segment that is not a
plain identifier gets quoted. A vhost named `my site.example.com` comes out as
`services.nginx.virtualHosts."my site.example.com"`, not as broken Nix.

The starter files are checked the same way: they are evaluated as an actual
NixOS system, down to `config.system.build.toplevel`, against a stub
`hardware-configuration.nix`.

---

## What it does not do

**Unstable.** Options and modules cannot be mixed across channels — an
unstable `services.foo.*` needs unstable's module set, so there is no way to
emit it for a stable system. Packages *could* be mixed via an overlay, but
that changes the output format, and the option half would still be a lie. One
channel, one truth.

**Write back to your existing config.** Reading one is supported; writing
values back while preserving structure and comments is a much harder problem,
and getting it wrong means damaging a working system. Import is safe precisely
because it only ever reads.

**Type checking.** `nixos-rebuild dry-build` is the authority.

**Submodule containers as a whole.** You set
`services.nginx.virtualHosts.<name>.root`, not `services.nginx.virtualHosts`
as one blob.

---

## Developing

```bash
git clone https://github.com/hatake716/nixgen.git
cd nixgen
nix develop                                  # python3, brotli, curl, sqlite
./build/fetch-data.sh nixos-26.05
python3 build/build_index.py --channel nixos-26.05
python3 build/server.py
```

This keeps the index in `./data/` instead of your home directory, and runs the
files in the working tree rather than the copy in the nix store. Keep the
clone outside any existing git repository, or see the gotcha under
*If something goes wrong*.

```
build/
  nixgen_core.py    type-string parser + Nix renderer  (no deps)
  nix_import.py     reads an existing configuration.nix
  starter.py        the Setup tab's configuration.nix and flake.nix
  build_index.py    channel JSON -> SQLite + FTS5
  server.py         stdlib HTTP server: search, render, import, validate
  fetch-data.sh     channel download
  static/           the UI (vanilla JS, no build step)
data/
  nixgen.sqlite     generated index, not in git
docs/
  index.html        the homepage, served by GitHub Pages from /docs
  screenshot*.png
flake.nix
flake.lock          pins nixpkgs, so everyone builds the same thing
```

`docs/index.html` is self-contained and already points at this repository. If
you fork it, change the `hatake716` links inside and point
**Settings → Pages** at `main` / `/docs`.

---

## License

MIT — see [LICENSE](LICENSE). The files it generates are yours; the licence
covers this tool, not its output.

Not affiliated with the NixOS project.
