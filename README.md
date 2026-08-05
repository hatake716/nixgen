# nixgen

A form-driven generator for NixOS configuration modules. Search all 24,517
options and 144,200 packages in the stable channel, fill in values with real
widgets, and get a `.nix` file you can import.

![nixgen](docs/screenshot.png)

It generates in one direction only. It can read your existing configuration,
but never writes to it, so it cannot break anything you already have.

日本語版: [README.ja.md](./README.ja.md)

---

## Installing

### What you need

Nix with flakes enabled. That is all — there is no pip step and no npm step.

If `nix run` complains that flakes are experimental, add this to your
`configuration.nix` and rebuild:

```nix
nix.settings.experimental-features = [ "nix-command" "flakes" ];
```

### 1. Get the files

```bash
git clone https://github.com/hatake716/nixgen.git
cd nixgen
```

**Do not put this inside `/etc/nixos`.** It is an application, not system
configuration, and `/etc/nixos` is usually a git repository — which brings us
to the one real gotcha.

Flakes read files from git, not from disk. If the directory sits inside a git
repository, anything untracked is invisible to Nix, and you get errors like:

```
error: Path 'build' does not exist in Git repository "/etc/nixos".
path "/etc/nixos/nixgen" does not contain a 'flake.nix', searching up
```

Two ways out. Either keep it outside any repository, where flakes just read
the directory and no git step is needed:

```bash
mv nixgen ~/src/nixgen
```

Or track it:

```bash
git add -A nixgen        # -A matters: flake.nix alone is not enough
```

### 2. Try it

```bash
nix run .
```

The first run takes a few minutes:

1. downloads about 10 MB of channel metadata
2. builds a 37 MB search index into `~/.local/share/nixgen`
3. deletes the raw JSON it no longer needs
4. opens <http://127.0.0.1:8823/> in your browser

Later runs skip all of that and start immediately.

Fish users: plain `nix run .` is fine, but any flake reference containing `#`
needs quoting, because fish reads `#` as the start of a comment.

```fish
nix run '.#default'
```

### 3. Install it for real

```bash
nix profile install .
nixgen
```

`nixgen` is now on your PATH. To update after changing the code, re-run
`nix profile install .` — the code is read from the nix store, so nothing is
copied into your home directory except the index.

---

## Running it

```bash
nixgen                       # or: nix run .
nixgen --port 9000           # different port
nixgen --no-browser          # do not open a browser
nixgen --db /path/to/db      # use a specific index
```

Two environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `NIXGEN_DATA` | `~/.local/share/nixgen` | where the index lives |
| `NIXGEN_CHANNEL` | `nixos-26.05` | which release to index |

### Switching releases

```bash
rm -rf ~/.local/share/nixgen
NIXGEN_CHANNEL=nixos-25.11 nixgen
```

Release channels only. Unstable is deliberately unsupported — see
*What it does not do*.

### Reaching it from another machine

The server binds to `127.0.0.1` and has no authentication, so do not move it
to `0.0.0.0` on a network you do not control. Forward a port over SSH instead:

```bash
ssh -L 8823:127.0.0.1:8823 your-desktop
```

Then open <http://127.0.0.1:8823/> on the local machine.


### Reading it in another language

The page is plain HTML, so your browser's built-in translation works on it.
In Chrome, right-click anywhere and choose *Translate to…*.

Only the descriptions get translated. Option paths, package attributes, type
notation, default values and the generated Nix stay in English, because a
translated `services.openssh.enable` is no longer valid Nix.

Those elements carry `translate="no"`, but not every browser honours it, so
each one also remembers its own text and puts it back if anything rewrites
it. The code pane is re-rendered rather than reset, so syntax colouring
survives too.


## Publishing

`docs/index.html` is a self-contained landing page. To put it online, open the
repository's **Settings -> Pages**, set the source to *Deploy from a branch*,
and pick `main` / `/docs`. Replace `YOUR-GITHUB-NAME` in that file first — it
appears in the clone command and the header link.

---

## Working on the code

```bash
nix develop                                  # python3, brotli, curl, sqlite
./build/fetch-data.sh nixos-26.05
python3 build/build_index.py --channel nixos-26.05
python3 build/server.py
```

This keeps the index in `./data/` instead of your home directory, and runs the
files in the working tree rather than the copy in the store.

Without flakes at all:

```bash
nix-shell -p python3 brotli curl sqlite
```

---

## Using the output

Save the generated file next to your `configuration.nix` and import it:

```nix
{
  imports = [
    ./hardware-configuration.nix
    ./generated.nix
  ];
}
```

Keeping it in a separate file matters. Options you set in `generated.nix`
override nothing else in your config, and you can delete the import to back
the whole thing out.

Then, as always:

```bash
sudo nixos-rebuild dry-build
```

**Check syntax** in the app only runs `nix-instantiate --parse`, which catches
malformed Nix. It does not check that a value has the right type or that the
option combination makes sense. Only `nixos-rebuild` does that.


## Importing an existing configuration.nix

Press **Import configuration.nix** and pick your file. Everything it sets is
matched against the catalogue and loaded into the form, values and all. Your
file is opened read-only and never written to.

The file is handed to `nix-instantiate --parse` first, so the real Nix parser
does the work — no regexes over your source. What comes back is a normalised,
fully-parenthesised form with `a.b.c = x` expanded into nested attribute sets,
which is then walked and flattened.

Every setting ends up in the output. Three things can happen to it:

- **Filled into the form.** A literal that fits the option's widget: `true`,
  `"Asia/Tokyo"`, `[ 22 80 443 ]`, `with pkgs; [ vim git ]`. `lib.mkForce` and
  `lib.mkDefault` are unwrapped. Names in paths are picked up too, so
  `services.nginx.virtualHosts."example.com".root` fills the `<name>` slot.
- **Copied verbatim — module structure.** `imports`, `options` and
  `disabledModules` are not settings and have no catalogue entry, but dropping
  `imports` means `hardware-configuration.nix` never loads and the build fails
  on a missing `fileSystems."/".fsType`. They are carried through, with
  relative paths restored to `./…`, so keep the output in the same directory
  as the file you imported.
- **Copied verbatim — the value is an expression.** `lib.mkIf config.foo.enable
  true`, or anything referring to a `let` binding. A form cannot hold a
  conditional, so the expression is written into the output exactly as it was.
- **Copied verbatim — not an option in this release.** Either it was renamed or
  removed (`hardware.opengl.enable` is gone in 26.05), or it lives inside a
  free-form submodule such as `nix.settings`, whose keys are not in the
  catalogue. The summary says which of the two it is.

Verbatim lines are highlighted in the file pane and carry a trailing
`# verbatim` comment, so they stay obvious after you download it. They sort
into their normal alphabetical position rather than being dumped at the end.

Two things to watch. An expression that referred to a `let` binding in your
original file will not resolve on its own — **Check syntax** points at the exact
line. And an option that no longer exists will be rejected by
`nixos-rebuild`; that is the point of flagging it rather than dropping it.

---

## How it works

NixOS publishes machine-readable metadata for every option in every release:

```
https://channels.nixos.org/nixos-26.05/options.json.br
https://channels.nixos.org/nixos-26.05/packages.json.br
```

`options.json` gives each option's path, type, default, example, description,
and declaring file. Nothing in this project is hand-written per option — the
whole catalogue comes from that file, so full coverage is a matter of parsing
rather than of authoring.

The awkward part is the `type` field. It is a sentence, not a schema:

```
"boolean"
"null or (list of string)"
"16 bit unsigned integer; between 0 and 65535 (both inclusive)"
"attribute set of (submodule)"
```

There are 1,247 distinct type strings across the channel. `nixgen_core.py`
parses them into a small tree (`nullable`, `list`, `attrs`, `enum`, `int`,
`str`, `lines`, `path`, `package`, `bool`) and the UI picks a widget per node.

**88.3% of options (21,652 of 24,518) map onto real widgets.** The rest fall
back to a Nix text box showing the type string and the upstream example. Most
of those fallbacks are container parents like `attribute set of (submodule)`
whose children are separate, fully-supported options anyway — so the share of
things you actually cannot fill in with a form is well below 12%.

### Search

Search is the real interface: a tree of 24,517 options is unusable. Results
are bucketed by how the query matched, then ordered by depth, then by whether
the leaf is `.enable`, then by how prominent the top-level namespace is.

Whole-segment matching does most of the work. Typing `firewall` puts
`networking.firewall.enable` first because `firewall` is a complete path
segment there, while `services.firewalld.enable` only contains it as a
substring. The namespace weights in `build_index.py` (`NS_RANK`) are a plain
heuristic and only ever break ties — they never change what is found.

### Correctness

The renderer was fuzzed against the real Nix parser: 8,000 randomly chosen
options per run, six runs, seeded with hostile values (embedded quotes,
backslashes, `${`, newlines, `''`, empty strings, Japanese text) and hostile
`<name>` substitutions (spaces, dots, empty, Nix keywords). All runs parse.

Three real bugs came out of that and are fixed:

| Bug | Why it matters |
|---|---|
| Placeholders are not only `<name>` — also `<n>`, `*`, and upstream artifacts like `<imports = [ pkgs.ghostunnel... ]>` | 5,031 options (20%) contain one |
| `[ -1 ]` is a syntax error; negative numbers need parentheses | any `signed integer` inside a list |
| `if`, `rec`, `or`, `let`… are reserved and must be quoted as attribute names | a systemd service literally named `if` |

Attribute paths are rendered segment-by-segment, and any segment that is not a
plain identifier gets quoted. So a vhost named `my site.example.com` comes out
as `services.nginx.virtualHosts."my site.example.com"`, not as broken Nix.

---

## What it does not do

**Unstable.** Options and modules cannot be mixed across channels — an
unstable `services.foo.*` needs unstable's module set, so there is no way to
emit it for a stable system. Packages *could* be mixed via an overlay, but
that changes the output format, and the option half would still be a lie. One
channel, one truth.

**Write back to your existing config.** Reading one is supported (see above);
writing values back while preserving structure and comments is a much harder
problem, and getting it wrong means damaging a working system. Import is safe
because it only ever reads.

**Type checking.** `nixos-rebuild dry-build` is the authority.

**Submodule containers as a whole.** You set `services.nginx.virtualHosts.<name>.root`,
not `services.nginx.virtualHosts` as one blob.

---

## Layout

```
build/
  nixgen_core.py    type-string parser + Nix renderer  (no deps)
  nix_import.py     reads an existing configuration.nix
  build_index.py    channel JSON -> SQLite + FTS5
  server.py         stdlib HTTP server, search/render/validate API
  fetch-data.sh     channel download
  static/           the UI (vanilla JS, no build step)
data/
  nixgen.sqlite     generated index
docs/
  index.html        landing page for GitHub Pages
  screenshot*.png
flake.nix
```

No pip, no npm. Python standard library and a browser.

---

## License

MIT — see [LICENSE](LICENSE). The files it generates are yours; the licence
covers this tool, not its output.

