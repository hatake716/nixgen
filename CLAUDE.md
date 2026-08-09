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
The port-in-use message now says this too, because the old copy answering on
8823 is indistinguishable from the new one having started.

> 開発時は `nix run .`(ドット)。新規ファイルは `git add -A` しないとflakesから見えません。`app.js` を変えたら `BUILD` を必ず上げてください。

---

## Layout

```
build/
  nixgen_core.py    type-string parser + Nix renderer. No dependencies.
  nix_import.py     reads an existing configuration.nix
  starter.py        the Setup tab's configuration.nix and flake.nix
  releases.py       which releases exist and at which commit; builds an index
  build_index.py    channel JSON -> SQLite + FTS5
  server.py         stdlib HTTP server: search, render, import, starter, reindex
  fetch-data.sh     downloads and decompresses channel data
  static/           the UI. Vanilla JS, no build step.
tools/
  fuzz.py           regression + fuzz harness. Run before shipping renderer changes.
  import_check.py   the same for the importer, through both of its readers.
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
- **A quoted segment is one name, dots and all.** 76 catalogue paths hold one,
  `boot.kernel.sysctl."net.core.rmem_max"` among them. `_SEGMENT` keeps it
  whole and `render_path` leaves its quotes alone; quoting it a second time
  named a different attribute, and the file still parsed, so the only symptom
  was a setting that never took effect. `_SEGMENT` and `segmentsFor()` in
  `app.js` are the same rule twice and must stay in step.
- **Placeholders in option paths are not all `<name>`.** Also `<n>`, `*`, and
  upstream artifacts like `<imports = [ pkgs.ghostunnel... ]>`. 5,082 options
  (21%) contain one. The pattern is `/<[^>]*>|\*/`.
- **Package lists are sorted and one element per line.** Sorting keys must stay
  in step between `nixgen_core.sort_key` and `sortKey()` in `app.js`.
- **A dot in a package name does not mean it is already qualified.** 83% of the
  catalogue has one — every `python3Packages.*`, `haskellPackages.*`,
  `aspellDicts.*`. `render_package` prefixes `pkgs.` unless the value starts at
  a name the module already has in scope, or is not an attribute path at all.
  Catalogue attributes arrive quoted where a segment needs it, sometimes with a
  dot inside the quotes (`rubyPackages."http_parser.rb"`), so they are used
  whole rather than split on dots and reassembled.

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
- **Nix's normalised output parenthesises the head of every selection.**
  `python313Packages.requests` comes back as `((python313Packages).requests)`,
  however long the chain — only the head is wrapped. `_undo_parens` collapses
  it, and both `tidy` and `classify` go through it. Recognising only
  `(pkgs).x` meant one dotted package turned its whole list into verbatim text.
- **`_PAREN_ATOM` must not strip the brackets off a negative number.** Undoing
  Nix's parentheses is otherwise safe, but `[ (-1) ]` parses and `[ -1 ]` does
  not. The nix path never shows a literal `(-1)` — it arrives as
  `(__sub 0 1)` — so this only ever bites through the fallback reader, which
  is exactly where it is hardest to notice.
- **Nix has no negative literal.** `-5` comes back out of its parser as
  `(__sub 0 5)`. `_undo_parens` turns it back, because a carried-over line is
  meant to be recognisable as the one you wrote, and because leaving it made
  every negative number an expression the form could not hold.
- **Escapes are Nix's, not Python's.** `unicode_escape` decodes UTF-8 bytes as
  latin-1, so `日本語` came back as mojibake, and it invents escapes Nix does
  not have — a backslash-u escape is literal text in a Nix string, where a
  backslash before anything but `n`, `r` or `t` just means that character.
- **An empty list fits any list.** `[ ]` says nothing about what it would have
  held; refusing it for a `list of package` left an empty
  `environment.systemPackages` sitting there as an expression.

### Starter files

- **Every line uses `lib.mkDefault`.** Two definitions of equal priority make
  NixOS refuse to choose:
  `error: The option 'networking.hostName' has conflicting definition values`.
- **`defines` must list exactly what was emitted.** The red "also in
  configuration.nix" markers read from it. Add a block, add its paths.
- Blocks that are switched off are removed, not commented out.
- **A revision is re-checked wherever it crosses a boundary.** It is written
  into the flake verbatim, so `releases.is_revision` (40 lowercase hex, nothing
  else) guards the file read, the network fetch and the render. Anything that
  fails it falls back to naming the branch, which is always safe.

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

# importer changes — fixed configurations plus a round trip, through both readers
python3 tools/import_check.py

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

`tools/import_check.py` reads configurations back in and checks that every line
is accounted for, comes back as the value it went in as, and rebuilds into a
file that parses. **Every case runs through both readers** — the Nix-backed one
and the fallback — because they fail differently and neither failure is visible
from the other. It found six defects on its first run, three of them in only
one of the two readers.

Its fixed cases matter more than its random half, and for a reason worth
keeping: the random half renders our own options and reads them back, so it can
only ever produce shapes our renderer emits. `with pkgs; [ python313Packages.requests ]`
is what a person writes and what broke, and no amount of sampling would have
reached it. New shapes belong in `CASES`.

In the browser, after any UI change: import a `configuration.nix`, add a package
from search, switch tabs, and press Check syntax. That path has broken more than
once in ways nothing else caught.

> リリース前に `python3 tools/fuzz.py` と `python3 tools/import_check.py` を通してください。ランダム部分だけでは既知バグを取りこぼします。固定ケースが本体です。

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
| `undefined variable 'python313Packages'` | a dot in a package name was read as "already qualified", so `pkgs.` was left off 83% of the catalogue |
| an imported package list arrives as uneditable text | `((python313Packages).requests)` — Nix's parenthesised head was not recognised |
| `syntax error, unexpected '-'` from an *imported* file | `_PAREN_ATOM` stripped the brackets off `(-1)` in the fallback reader |
| a setting parses, applies cleanly, and does nothing | `boot.kernel.sysctl."net.core.rmem_max"` was split on the dots inside the quotes, naming a different attribute |
| `日本語` and `Grüße` come back as mojibake | the unescaper was Python's `unicode_escape`, which reads UTF-8 bytes as latin-1 |
| `services.nice.level = __sub 0 5` in a carried-over line | Nix has no negative literal; its parser's form was passed straight through |
| an empty `environment.systemPackages = [ ]` cannot be added to | `[ ]` was read as "not a list of packages" rather than as any list |

---

## Decisions taken, with reasons

- **Generate only; never write to the user's file.** Reading is safe; replacing
  values while preserving layout and comments is far harder and failure damages
  a working system.
- **`Check syntax` is `nix-instantiate --parse` and nothing more.** It cannot
  judge types. Every piece of copy that mentions it says so, because a user who
  thinks it validates will skip `dry-build`.
- **Unstable is a channel like any other, and picking it makes everything
  unstable** — options, packages, `flake.nix`, `system.stateVersion`. What
  unblocked it was pinning the flake to the indexed snapshot and showing how old
  an index is; without those, the form offered settings the built tree lacked,
  Check syntax passed, and it failed at `nixos-rebuild`.
  **Mixing channels stays out of scope, permanently.** Packages could come from
  unstable via an overlay, options could not — an unstable `services.foo.*`
  needs unstable's module set — and a catalogue where half is selectable would
  be worse than no support. There is one seam where two channels can meet: the
  selector can name a channel the index was not built from. That is why it is
  flagged in red and offers to fix itself, rather than being allowed to pass.
- **The snapshot date is the channel's, not ours.** `fetch-data.sh` keeps the
  `Last-Modified` of the download, so the age shown is when nixpkgs published
  the data, not when someone happened to fetch it. `releases.stale_after` is one
  day for unstable and three weeks otherwise, which is the difference between a
  tree that is replaced overnight and one that drifts.
- **`system.stateVersion` comes out of the catalogue, not the channel name.**
  `nixos-unstable` has no number in it, so `build_index` records what
  `system.nixos.release` defaults to — 26.11 on unstable today. Guessing from
  the newest numbered release would put a wrong answer in the one field the
  copy tells you never to change afterwards.
- **The generated `flake.nix` can name a commit rather than a branch, and the
  Setup tab chooses which.** `fetch-data.sh` saves the channel's
  `git-revision`, `build_index.py` puts it in `meta`, and `starter.py` writes
  it into the flake. **The branch is the default.** Naming the commit is the
  only setting under which the option list and the built system are the same
  tree, so it is the more correct of the two and the copy says so — but a
  default that never moves is a system that never gets a security update
  without hand-editing a generated file, and that is the worse failure for
  someone who does not know to look. Do not quietly flip this back; it was set
  deliberately.
- **`_pin` has four outcomes and they stay four.** A commit from the index, a
  commit from the channel server, a branch that was chosen, a branch fallen back
  to because no commit was available. The middle two both produce a pinned build
  and the outer two both produce a branch, which is exactly why merging them is
  tempting and wrong: only the first says the options match what gets built, and
  only the last means a request went unmet. Both facts are ones a reader acts on.
- **One database per channel**, so switching back is instant, with a `CURRENT`
  marker so the choice survives a restart. Rebuilding one in place needs
  `refresh` on `/api/reindex`: without it the server sees a database and
  switches to it, which on a channel that moves is the one thing that does not
  help. A rebuild *replaces* that channel's file, so the count grows by one per
  channel ever picked, not by one per rebuild.
- **Removing an index is the only thing nixgen deletes**, so it is fenced in
  three ways at once: `releases.DB_NAME` matches only names nixgen wrote
  itself, the database in use is excluded, and so is any channel still on the
  list. The request names channels, never paths, and nothing it says can widen
  that set. Keep all three — each one alone looks sufficient.
- **Setup is the first tab and the one the app opens on.** On a fresh install
  those files are needed before anything else.

---

## Documentation

- `CHANGELOG.md` is the only place entries live. English half on top, Japanese
  half below. `README.md`, `README.ja.md` and `docs/index.html` link to it.
- Figures appear in several files and drift. Current: **24,557 options**,
  **144,245 packages**, **88.3% (21,681)** with a real widget, **1,252** distinct
  type strings, **5,082 (21%)** with a placeholder. All for `nixos-26.05` at
  `ee48b147` — the release alone does not pin them, which is the whole reason
  they drift: the branch moves within a release and the counts move with it.
  The revision is in `meta` now, so a stale figure can be told from a real one.
  Recompute rather than copy:
  ```bash
  python3 -c "
  import sqlite3; c=sqlite3.connect('data/nixgen.sqlite'); c.row_factory=sqlite3.Row
  r=c.execute('SELECT count(*) n, sum(supported) s, sum(has_slot) p FROM options').fetchone()
  t=c.execute('SELECT count(DISTINCT type_str) t FROM options').fetchone()['t']
  pk=c.execute('SELECT count(*) n FROM packages').fetchone()['n']
  m=dict(c.execute('SELECT key, value FROM meta'))
  print(f\"{r['n']:,} options, {pk:,} packages, {r['s']:,} widgets \"
        f\"({100*r['s']/r['n']:.1f}%), {t:,} types, {r['p']:,} placeholders \"
        f\"({100*r['p']/r['n']:.0f}%) — {m['channel']} at {m.get('revision','?')[:8]}\")"
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

- `docs/screenshot*.png` need retaking whenever the UI changes shape. They now
  predate the channel selector, the pin choice and the index-age line, so the
  Setup tab in them is three features out of date.
