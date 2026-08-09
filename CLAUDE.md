# CLAUDE.md — working on nixgen

Context for picking this project up. The code is readable; what follows is the
part that is not obvious from reading it — the reasons behind decisions, and the
mistakes already made so they are not made twice.

日本語の要点は各節の末尾にあります。

---

## What this is

A local web app that turns the NixOS option catalogue into a search box and a
form, and writes a `.nix` module. It also reads an existing `configuration.nix`,
and generates the `configuration.nix` / `flake.nix` that go around the module.

Beta. Public at <https://github.com/hatake716/nixgen>, homepage at
<https://hatake716.github.io/nixgen/>. MIT.

The author is not a programmer. Every line of this was written by an AI from
plain-language description, and every bug listed below was found by running it
on a real machine — not by reading the code. Keep that ratio in mind: **changes
that look correct are not evidence. Run the checks.**

---

## Running it while working

```bash
cd ~/src/nixgen-pub
git add -A          # flakes ignore untracked files; new files are invisible without this
nix run .           # a dot, not github: — that would fetch the published copy
```

`nix run github:hatake716/nixgen` is for users. Nix caches that reference for an
hour (`tarball-ttl = 3600`), and `nix profile install` pins it outright, so
neither reflects local edits.

**Bump `BUILD` in `build/static/app.js` on every change to that file.** It shows
in the header. Three separate times, hours were lost to "the fix does not work"
that turned out to be a stale copy — browser cache, Nix's hour, an old server
process still holding port 8823. The build id is how those get told apart in one
glance. If a change seems not to take effect, check it before touching code.

> 開発時は `nix run .`(ドット)。新規ファイルは `git add -A` しないとflakesから見えません。`app.js` を変えたら `BUILD` を必ず上げてください。

---

## Layout

```
build/
  nixgen_core.py    type-string parser + Nix renderer. No dependencies.
  nix_import.py     reads an existing configuration.nix
  starter.py        the Setup tab's configuration.nix and flake.nix
  releases.py       which releases exist; builds an index for one
  build_index.py    channel JSON -> SQLite + FTS5
  server.py         stdlib HTTP server: search, render, import, starter, reindex
  fetch-data.sh     downloads and decompresses channel data
  static/           the UI. Vanilla JS, no build step.
tools/
  fuzz.py           regression + fuzz harness. Run before shipping renderer changes.
docs/               the GitHub Pages homepage
```

Data flow: `channels.nixos.org` → `fetch-data.sh` → `build_index.py` →
`nixgen.sqlite` → `server.py` → the UI → `nixgen_core.render_module` → the file.

---

## Invariants

Breaking any of these produces a file that looks fine and fails later, usually
at `nixos-rebuild`, which is the least helpful place for it to surface.

### Rendering Nix

- **Negative numbers inside a list need parentheses.** `[ -1 ]` is a syntax
  error; `[ (-1) ]` is not.
- **Nix keywords must be quoted as attribute names** — `if`, `rec`, `or`, `let`,
  `in`, `with`, `assert`, `then`, `else`, `inherit`.
- **Attribute paths are rendered segment by segment**, and any segment that is
  not a plain identifier is quoted. A vhost named `my site.example.com` has to
  survive. Never join a path with `.` and hope.
- **Placeholders in option paths are not all `<name>`.** Also `<n>`, `*`, and
  upstream artifacts like `<imports = [ pkgs.ghostunnel... ]>`. 5,080 options
  (21%) contain one. The pattern is `/<[^>]*>|\*/`.
- **Package lists are sorted and one element per line.** Sorting keys must stay
  in step between `nixgen_core.sort_key` and `sortKey()` in `app.js`.

### Reading a configuration.nix

- **The output must never import itself.** Carrying `imports` across used to
  leave `./generated.nix` inside the generated file; the module system then
  recursed until `stack overflow; max-call-depth exceeded`, with nothing in the
  message pointing at the cause. `strip_self_import` exists for this.
- **`imports` must be carried over.** Dropping it means
  `hardware-configuration.nix` never loads and the build fails on a missing
  `fileSystems."/".fsType`. Also silent, also confusing.
- **Everything is accounted for.** Four groups: filled into the form, verbatim
  (module structure), verbatim (an expression), verbatim (not in this release).
  Nothing is discarded. If a fifth case appears, add a group rather than dropping
  it.
- **Relative paths are restored.** `nix-instantiate --parse` resolves `./x.nix`
  against wherever the file sits, so the parse runs in a directory whose name
  can be recognised and turned back into `.`.
- **The fallback reader has to handle `with pkgs;`.** Without
  `nix-instantiate`, the semicolon at depth zero was read as the end of the
  value, dropping entire package lists. `_PENDING_CLAUSE` guards it.

### Starter files

- **Every line uses `lib.mkDefault`.** Two definitions of equal priority make
  NixOS refuse to choose:
  `error: The option 'networking.hostName' has conflicting definition values`.
- **`defines` must list exactly what was emitted.** The red "also in
  configuration.nix" markers read from it. Add a block, add its paths.
- Blocks that are switched off are removed, not commented out.

### The UI

- **Identifiers must survive machine translation.** Option paths, package
  names, type strings and generated Nix carry `translate="no"` *and* remember
  their own text in `data-keep`; a MutationObserver puts it back. Not every
  browser honours the attribute, and a translated `services.openssh.enable` is
  not valid Nix. Descriptions are the only prose meant to be translated.
- **Adding a package must not rebuild the card.** It would reset a text box the
  user had dragged taller. `addPackage` edits the textarea in place.
- **Adding a package must not replace the value.** When the list came in
  verbatim, the value is a string; overwriting it with `[]` used to wipe every
  package. `appendToNixList` edits the text.
- No browser storage. State lives in `state` in `app.js`.

> 上記はいずれも「見た目は正しいのに後で壊れる」類の落とし穴です。触る前に一読してください。

---

## Checks before shipping

```bash
# renderer changes — fixed regressions plus random sampling against the real parser
python3 tools/fuzz.py

# server / importer changes
python3 -c "import ast,glob; [ast.parse(open(f).read()) for f in glob.glob('build/*.py')]"
node --check build/static/app.js

# starter changes — evaluate as an actual NixOS system, not just parse
#   put configuration.nix, flake.nix, a stub hardware-configuration.nix and a
#   stub generated.nix in a directory, then:
nix eval --raw '.#nixosConfigurations.nixos.config.system.build.toplevel.drvPath'
```

`tools/fuzz.py` renders thousands of real options with hostile values and runs
them through `nix-instantiate --parse`. The fixed regression cases at the top
matter as much as the random part: random sampling did **not** catch the
negative-number bug when it was deliberately reintroduced, because that seed
happened not to put a negative number in a list.

In the browser, after any UI change: import a `configuration.nix`, add a package
from search, switch tabs, and press Check syntax. That path has broken more than
once in ways nothing else caught.

> リリース前に `python3 tools/fuzz.py` を通してください。ランダム部分だけでは既知バグを取りこぼします。固定ケースが本体です。

---

## Bugs already fixed — do not reintroduce

| Symptom | Cause |
|---|---|
| `stack overflow; max-call-depth exceeded` | the generated file imported itself |
| `fileSystems."/".fsType` has no value | `imports` was dropped on import |
| `syntax error, unexpected ';'` mid-package-list | the source was truncated at 400 characters |
| duplicate attribute for `environment.sessionVariables` | sub-keys of one attrs option emitted as separate lines |
| `syntax error, unexpected '-'` | `[ -1 ]` |
| `unexpected 'if', expecting identifier` | a Nix keyword used as an attribute name |
| package list empties out when adding one from search | value replaced instead of appended |
| whole package list lost without `nix-instantiate` | `with pkgs;` semicolon read as the end of the value |
| box springs back to its old height | the card was rebuilt on add |

---

## Decisions taken, with reasons

- **Generate only; never write to the user's file.** Reading is safe; replacing
  values while preserving layout and comments is far harder and failure damages
  a working system.
- **`Check syntax` is `nix-instantiate --parse` and nothing more.** It cannot
  judge types. Every piece of copy that mentions it says so, because a user who
  thinks it validates will skip `dry-build`.
- **Numbered releases only, for now.** `nixos-unstable` publishes the same data,
  so this is unfinished rather than impossible. The obstacle is that the channel
  serves its newest snapshot while `flake.lock` pins one commit, and unstable
  moves daily — the form would offer settings the built commit lacks, Check
  syntax would pass, and it would fail at `nixos-rebuild`.
  **The way in:** every channel publishes `git-revision`, so the flake could be
  pinned to the exact snapshot that was indexed. That plus an index-age display
  is what it needs. Mixing channels stays out of scope: packages could come from
  unstable via an overlay, options could not, and a catalogue where half is
  selectable would be worse than no support.
- **The same `git-revision` trick would tighten stable too.** `flake.nix`
  currently pins the branch `nixos-26.05`, not a commit. Low priority — the
  option set is near-frozen within a release — but it is free correctness.
- **One database per release**, so switching back is instant, with a `CURRENT`
  marker so the choice survives a restart.
- **Setup is the first tab and the one the app opens on.** On a fresh install
  those files are needed before anything else.

---

## Documentation

- `CHANGELOG.md` is the only place entries live. English half on top, Japanese
  half below. `README.md`, `README.ja.md` and `docs/index.html` link to it.
- Figures appear in several files and drift. Current: **24,517 options**,
  **144,200 packages**, **88.3% (21,652)** with a real widget, **1,247** distinct
  type strings, **5,080 (21%)** with a placeholder — all for `nixos-26.05`.
  Recompute rather than copy:
  ```bash
  python3 -c "
  import sqlite3; c=sqlite3.connect('data/nixgen.sqlite'); c.row_factory=sqlite3.Row
  r=c.execute('SELECT count(*) n, sum(supported) s, sum(has_slot) p FROM options').fetchone()
  print(r['n'], r['s'], round(100*r['s']/r['n'],1), r['p'])"
  ```
- `docs/index.html` is self-contained and hard-codes `hatake716` links. It was
  once maintained both with and without a placeholder, and the two copies got
  swapped by accident — keep one version only.
- Tone: plain, specific, no marketing. Limitations are stated where a reader
  would hit them, not buried. The homepage says what the tool cannot do on the
  front page on purpose.

> ドキュメントの数値は必ず再計算してください。コピーすると必ずずれます。

---

## Open items

- Unstable support, as scoped above.
- Pin `flake.nix` to a revision rather than a branch.
- Show how old an index is, and offer to refresh it.
- A friendlier message when port 8823 is taken; right now it is a raw Python
  traceback.
- `docs/screenshot*.png` need retaking whenever the UI changes shape.
