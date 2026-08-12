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
  browser_check.py  the eleven-point sweep, against the real app in a browser.
  eval_check.py     evaluates a generated bundle as a NixOS system, reads it back.
  shots.py          retakes docs/screenshot*.png by driving the real app.
  mark.py           draws the logo; both pages and the favicon inline its output.
docs/               the GitHub Pages homepage
.github/workflows/  the checks below, on every push
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
- **A configuration.nix splits three ways, and the third way changed.** The
  Setup fields take what they own, `imports` is merged into the list the
  starter writes, and **everything else becomes cards in the module**. It used
  to be carried verbatim into the configuration.nix the Setup tab writes, on
  the reasoning that somebody's own file should not end up inside nixgen's.
  That reasoning did not survive use: the file those lines were copied into is
  generated by nixgen anyway, so nothing was being preserved — and copied text
  can only be looked at, while a card can be edited, matched against the
  catalogue and checked for collisions. `state.carried` is now always empty;
  `state.carriedImports` still carries the imports. An option this release
  lacks, or an expression the form cannot hold, still arrives as a verbatim
  card, which is the module's existing shape for both.
- **There are two imports, and which button was pressed decides where the file
  lands.** A `configuration.nix` is the machine's own file: the Setup fields
  take what they hold, its `imports` are merged into the list the starter
  writes, and everything else is carried into that same `configuration.nix`
  through `render_lines` — the module is untouched. A `generated.nix` is a
  module and becomes cards. Reading a configuration.nix into the module is what
  this used to do; it worked, and it put somebody's own file in the wrong one
  of the two. **Carried paths join `defines`**, so adding one of them under
  Options afterwards trips the same red marker as a starter line rather than
  defining it twice in silence.
- **The machine's own details go to the Setup tab, and go there instead.**
  `fillSetupFrom` in `app.js` takes the host name, the user and its groups, the
  architecture, the boot loader and its GRUB disk, NetworkManager, flakes and
  `system.stateVersion`, and those cards are then left out of the module: they
  are fields on that tab and the starter `configuration.nix` writes them, so
  keeping cards as well would define the same attribute in both files. It is a
  move, not a discard, and the summary lists what moved. Two shapes have to be
  read rather than assumed — `nixpkgs.hostPlatform` is a union so its value
  arrives as Nix source with the quotes on it, and flakes live inside
  `nix.settings`, an attrs option holding a line of source per key. **That one
  only moves when experimental-features is the only key**, or substituters and
  trusted-users would be carried off with it.
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
- **Every dropdown option is written `English — 日本語`, and every one of them
  has to fit the closed select.** A select shows what fits and silently drops
  the rest, and the rest is the Japanese, which is the half a translated page
  depends on. Three labels were over the 302px box and one list was over its
  221px one; the fix was shorter wording for the first three and giving
  `#appsline` the whole line for the last. Measure, do not eyeball — the tools
  clone the select with `width: max-content` and compare against its real box.
  Adding an option means checking the same thing.
- **"Already added" is read from the module, never remembered.**
  `alreadyListed` looks in `environment.systemPackages` — the list the form
  holds or the source of one that came in verbatim — and `syncAddedRows` runs
  at the end of every `doRender`, so a package removed from the card or typed
  into the box by hand greys and un-greys the list without anything having to
  tell it. A flag set when a row is clicked would go stale the first time
  somebody edited the card instead.
- **`runSearch` is what every repaint goes through, so it has to know which
  list it is painting.** On the Setup tab there is no list at all, and asking
  the server for `kind=setup` gets options back — which used to be handed to
  the package painter. It has to leave early there, and it has to keep the
  category (below); both were found by importing a file with the wrong tab open.
- **A row says whether it has an icon; the page never asks blind.** An `<img>`
  per package meant a 404 for every one without an icon — 128 in a single
  search. `with_icons` puts the answer in the row that was already being sent.
- **Ordinary use answers 404 nowhere.** Both places that used to — an icon that
  does not exist, and a preset trying candidate option paths one at a time —
  ask a question that has an answer instead: `/api/packages?attrs=` and
  `/api/options?paths=` return the ones that exist, in the order asked. A
  console with two red lines in it every time somebody picks a desktop is a
  console nobody reads when something is actually wrong.
- **Repainting the package list must keep the category.** `runSearch` is what
  every repaint goes through, and it knew only about the search box, so adding
  the first package from a category replaced that category with the default
  listing — pick Games, click Steam, and the games were gone.
- **Adding a package must not rebuild the card.** It would reset a text box the
  user had dragged taller. `addPackage` edits the textarea in place.
- **Adding a package must not replace the value.** When the list came in
  verbatim, the value is a string; overwriting it with `[]` used to wipe every
  package. `appendToNixList` edits the text.
- **The import summary is first in the column, and `environment.systemPackages`
  is first the rest of the time.** Both were wanted and only one can be first in
  the markup, so `#notice` sits after `#editor` in the DOM and is pulled up with
  `order: -1` when it has something to say. It was below the module for a while,
  which put "kept as written: not an option in this release" — the one thing
  `nixos-rebuild` refuses outright — a screen or two down, where it went unread.
- **Every message the app writes carries both languages, and a new one has to
  too.** `say(en, ja)` for the status bar, `title_ja` and `body_ja` for a
  notice. They stack rather than sharing a line — the dropdown options are
  labels and fit `English — 日本語`, these are sentences and do not. **What the
  Nix parser says is not translated**: `sayCheck` introduces it in both
  languages and then quotes it, because somebody searching for an error needs
  the words it actually printed.
- **The five steps are written twice, English then Japanese, and the two
  halves are kept in step by hand.** They name tabs and buttons, so a machine
  translation of them points at names that are not on the screen — which is the
  same argument the option paths and the dropdown labels are held to. Two
  things follow. A line break between two Japanese characters is whitespace and
  renders as a visible space, so the Japanese half runs off the right of
  `index.html` rather than being wrapped like the English. And a space before a
  Japanese character is only right when what precedes it is Latin: `</b> 何も`
  showed a gap mid-sentence, `</b> <b class="w">Setup</b>` does not.
  **`docs/index.html` is held to the same two rules.** Its Japanese had been
  wrapped like prose since it was written — 35 visible gaps' worth. The check is
  to render the page and look for a space between two Japanese characters;
  reading the source will not show it to you.
- **The five steps live where the module will be.** Nothing is stored between
  visits, so anything with a dismiss button would ask to be dismissed on every
  launch; putting the steps in the empty module pane means adding a setting is
  what clears them. They name the tabs and buttons rather than where things sit
  — the panes stack and swap on a narrow screen, and "on the left" would be
  wrong exactly where a first-timer cannot afford it.
- **The five steps are five things to do in order, not five subjects.** Setup,
  Options, Packages, Check syntax, Download all three — the tabs and buttons in
  the order they are used. They were once grouped by subject, with importing an
  existing file as its own step in the middle; that reads fine and answers the
  wrong question, because the first thing anyone wants to know is which one to
  do first. Importing is a branch of step one, and checking earned a step of
  its own rather than a footnote under the list. A new step goes in the place
  it is performed, or it is not a step.
- **The chrome wears the five steps.** The catalog tabs carry numbered chips
  (1 Setup, 2 Options, 3 Packages) and the header's Check syntax and Download
  all three carry 4 and 5 — one `.stepnum` shape everywhere, so the numbered
  list in the empty pane and the controls agree. Renumbering the steps means
  renumbering the chrome. The tab names stay exactly Setup/Options/Packages
  (the docs refer to them); the Japanese lines beneath are a gloss, and the
  preset-row labels got the same stacked treatment (`.plabel`).
- **`[hidden]` needs an explicit reset once classes set `display`.** Giving
  `.btn` inline-flex made every hidden button an empty pill: an author display
  rule beats the UA's `[hidden]` one. `[hidden] { display: none !important }`
  sits next to the box-sizing reset; keep it when adding display to a class.
- **A control that renames itself is four controls.** The header used to hold
  `Download generated.nix`, which became `Download configuration.nix`,
  `Download flake.nix`, or the archive depending on the file tab — and hid
  `Download all three` whenever the last one was chosen. Two download buttons
  playing musical chairs, next to each other. The header now holds one
  download, the one the five steps end on, and it is the primary button.
  **Anything that acts on the file being shown belongs in the file tab row**,
  where the tabs that choose it are: Copy and `Download this file` live there
  and both stand down on `all three`. Neither needs a changing label.
- **The archive is a `.tar.gz` inside a directory, and both halves matter.**
  `tar` and `gzip` are in the NixOS default system path and `unzip` is not, so
  a zip would send someone looking for a package before they could read what
  they downloaded. The directory is because people extract into whatever
  directory they are in, and a flat archive would drop a `configuration.nix`
  on top of one already there. `bundle_name` in `server.py` and `bundleName`
  in `app.js` are the same rule twice — the client prints the command, the
  server names the file, and a mismatch means the printed command is wrong.
- **Every grid track and flex item that can hold wide content needs
  `minmax(0, …)` or `min-width: 0`.** Both refuse to go narrower than their
  contents by default, so one long line widens the page instead of scrolling
  inside its own box. The desktop middle column always had it; the
  single-column rule did not, and a four-line directory listing was enough to
  push the whole page off a phone screen sideways.
- **The directory listing in the steps is ASCII, not box drawing.** `--mono`
  falls back to a proportional face for `├─└` on some machines, and a tree
  whose columns do not line up is worse than no tree.
- **The desktops' own apps are in `APPS` so they can be taken apart from the
  desktop**, not so they get installed twice — enabling one of the five
  already brings them. Which ones they are came from diffing five evaluated
  systems against a bare one and dropping the session and theme plumbing;
  that is the only way to get the list right, and it is how `kwrite` turned
  out to have no attribute of its own (nixpkgs ships it inside `kate`).
  **The same diff decides what stays out**: `cosmic-settings` and the mint
  themes only mean anything with their desktop running, so they are not in the
  list, while `cosmic-term` and `cosmic-files` run anywhere and are. Two more
  fail a duller test — the catalogue holds no description or version for
  `nemo-with-extensions` or `evolutionWithPlugins`, so both would arrive as
  blank rows. Check that a candidate comes back with a description, not just
  that it comes back.
- **What `APPS` will not carry: anything tied to one machine.** It grew from a
  real configuration, which is the right source — but half of any real
  configuration is GPU tooling, microcode, panel plugins and hand-written
  `callPackage` expressions. Those belong to whoever wrote them. The test for
  a new entry is whether somebody else's machine would want it.
- **The category names carry their own Japanese and are not translated.** Names
  of kinds of software are what machine translation is worst at — "Audio and
  video" came back as 音楽と動画 for a category holding audacity and
  pavucontrol. `#s-apps` is `translate="no"` and its options get `data-keep`
  like every option path, since not every browser honours the attribute.
  Descriptions elsewhere are still meant to be translated; this is the
  exception, not a change of policy.
- **Package icons come from the machine, and nothing was added to get them.**
  `icon_index` in `server.py` reads the icon themes already installed and maps
  a name to a file once; `/api/icon?attr=` answers from that map and **never
  joins a request to a path**, which is the whole security story for serving
  files out of an endpoint. Depending on an icon theme instead would be 252 MB
  of closure for a tool whose index is 37 MB, and bundling a subset would put
  GPL artwork in an MIT repository — so coverage is what the machine happens
  to have (77% of `APPS` on the author's, single figures on a bare install)
  and the fallback is the package's first letter on a colour derived from its
  name. Themes disagree about directory order — `<theme>/64x64/apps` and
  `<theme>/apps/scalable` are both real — and reading only the first shape
  found 555 icons where there were 8,134.
- **`APPS` is the one opinionated list in the tool, and stays small.** Picking a
  category fills the results with a handful of packages, which are then added
  by the same click as any search hit — nothing is installed on anyone's
  behalf, and the search box remains the way to reach the other 144,000.
  Every name is looked up rather than rendered, so one the channel does not
  have is absent instead of broken: `kdenlive` is `kdePackages.kdenlive`, `0ad`
  is `zeroad`, and `superTuxKart` became `supertuxkart` between 25.11 and
  26.05 — both spellings are listed and only the real one comes back.
- **There is no `linuxPackages_lts` in nixpkgs, and the kernel preset's LTS is
  a list of series.** That was checked against the tree, not assumed: the
  top-level attributes are `linuxPackages`, `_latest`, `_zen` and one per
  series. Which series are LTS is kernel.org's designation and nothing in the
  index records it, so `KERNELS.lts` lists them newest first and takes the
  first the channel still ships, the way `DESKTOPS` does with paths. **When
  kernel.org names a new LTS it goes on the front of that list**; until then
  the status line naming the version it picked is what makes a stale list
  visible. `boot.kernelPackages` is a `raw value`, so what is written is Nix
  source and it arrives in a text box rather than a widget.
- **Steam is in the list, with a note rather than a silence.** It runs from the
  package, but `programs.steam.enable` is what puts the 32-bit graphics drivers
  in place and can open the remote-play ports. It was left out at first, which
  only sent people looking for it; a line in the status bar when `steam` is in
  the package list says the better way without taking the choice away.
- **The Flatpak row adds the portal, and says the part that is not a setting.**
  `services.flatpak.enable` alone produces applications with no file dialog and
  no screen sharing, because a Flatpak reaches the system through an xdg
  portal — so `xdg.portal.enable` and `xdg-desktop-portal-gtk` go in with it,
  a spare on GNOME and Plasma and the only backend anywhere else. The thing no
  option covers is the remote: a fresh install has none, so the status bar
  prints the `flatpak remote-add … flathub` line. A row with no dropdown is
  right here — there is nothing to choose — and it is a row rather than a
  search result because it is three settings, not one.
- **The generated file names the nixgen that wrote it.** `render_module` puts
  the build id in the header, guarded by `_BUILD_ID` because it arrives from
  the client and is written into a file the user keeps. It is there because a
  file that fails at `nixos-rebuild` is reported without one, and the first
  question is always which version produced it: Nix caches `github:` for an
  hour and `nix profile install` pins outright, so **"the fix is in" and "the
  fix is what you ran" are different facts**. The second report of the
  input-method crash was a fixed bug running from a cached copy, and telling
  that apart took evaluating both shapes against the reporter's own revision —
  the header is what makes it one glance instead.
- **A nullable option that is present and null has said nothing, and a check
  that asks only whether it exists will read it as an answer.**
  `i18n.inputMethod.type` is `null or one of …`, so the form holds it as
  `{ __null: true }` and it renders as `type = null;` — which looks like a
  decision on the page and is not one. The `enable`-without-a-type guard
  checked `findEntry`, so a carried-in null walked straight past it and the
  build failed exactly as before. Guards on nullable options go on the value.
- **An enabled input method with nothing chosen is repaired, not reported.**
  `ensureImType` runs at the top of `doRender`, so every route into that state
  — the search box, either import, a card edited back to null — comes out with
  fcitx5 rather than a warning about a file that will not build. It fills a
  blank only: ibus, kime or anything else is somebody's choice. It is a no-op
  once a type is set, which is why calling it from the render path does not
  loop. The note that remains is for the one case it cannot fix — a release
  with no `type` option at all.
- **The input method is enabled and chosen as one unit, never `enable` alone.**
  `i18n.inputMethod` has two interfaces — new (`enable = true` + `type =
  "fcitx5"`) and old (`enabled = "fcitx5"`). The module reads `type` to pick
  the package it puts in `environment.systemPackages`; `enable` on with `type`
  unset pushes a null and the build dies with `not of type 'package'`, far from
  the cause (reproduced to confirm). `addLanguage` writes the selection first
  and only adds `enable` when the *new* interface answered; a `doRender` note
  is the catch-all for the option reached from the search box or carried in by
  an import.
- **The fcitx5 front end follows the session, and `marker` is how a desktop is
  recognised.** `waylandFrontend = true` drops GTK_IM_MODULE/QT_IM_MODULE so
  Wayland apps use text-input — both directions were evaluated. The sync runs
  from both ends (addLanguage reads the module, addDesktop re-syncs an existing
  IM card) and writes nothing when no desktop is picked. The shared roles —
  xserver, sddm, defaultSession — cannot tell desktops apart, which is why
  every `DESKTOPS` entry carries `marker`: the option that is that desktop's
  own. A new desktop needs all three of `wayland`, `session` and `marker`.
- **The language preset stops where it stops, on purpose.** Locale, console
  keymap, X layout, and an input method for Japanese, Korean and Chinese.
  **Not fonts:** `fonts.packages` is a `list of absolute path`, so the form
  emits `[ "noto-fonts-cjk-sans" ]` — a string where a package belongs, which
  fails at evaluation. It does not matter, because all three desktops already
  ship the CJK and emoji fonts; that was read out of an evaluated system, not
  assumed. **Not the time zone** either: a language is not a place.
- **The graphics preset sets `videoDrivers` for NVIDIA and nothing else.** The
  default is `modesetting`, which is correct for AMD and Intel on any current
  kernel; naming the amdgpu X driver instead is a change with no upside. Intel
  gets a VAAPI driver because decoding does not work without one, AMD needs
  nothing beyond mesa, and `hardware.nvidia.open = false` is set rather than
  left computed — `true` is wrong on anything before Turing.
- **NVIDIA brings `allowUnfree` with it.** The driver is unfree, so the
  preset writes `nixpkgs.config.allowUnfree = true` as a flat card — the one
  output that could not build as generated, now can, which was evaluated.
  Switching GPU drops the previous card's pieces (`hardware.nvidia.*`,
  `videoDrivers = ["nvidia"]`, intel's VAAPI extra) but **only when the value
  is exactly what the preset wrote**, and the comparison must unwrap
  nullables first: `hardware.nvidia.open` is stored as `{__null:false,
  v:false}`, and comparing that to `false` left the card alive through every
  switch.
- **`allowUnfree` goes in by itself, and comes out by nobody but the user.**
  Every render scans the file for `pkgs.<attr>` names and NVIDIA settings,
  asks the index which attrs are unfree (the `unfree` column it has carried
  all along; answers cached in `state.unfreeKnown`), and writes the flat card
  when something unfree is named without the switch — one site in `doRender`
  covering the search box, both imports and verbatim cards alike, with the
  status bar naming the packages. It stands down only when the switch is
  already set: any spelling in the module text, or the starter/carried
  configuration.nix via `state.starterDefines`. **Nothing removes the card
  automatically.** It used to leave when "nothing still needs it", and that
  check only knew what the UI had added (`state.unfree`) — so picking AMD or
  Intel with an imported Steam in the list removed the one line letting it
  build, which reached a real machine. A card deleted while something unfree
  is still named comes back on the next render, because that file is one
  `nixos-rebuild` refuses outright.
- **A warning that must survive belongs in `doRender`, not in the preset that
  raised it.** The NVIDIA driver is unfree and the existing reminder cannot see
  it, since that one reads `environment.systemPackages` and this arrives
  through a module. Said once from the preset, it was wiped by the next render
  — `doRender` clears a `todo` status when it has no notes of its own. Notes
  regenerated on every render cannot be lost that way.
- **A shell is the module and the shell, and the module is the half that gets
  forgotten.** `users.defaultUserShell` alone leaves the shell out of
  `/etc/shells` and without completions — the login works and nothing else
  quite does — so `SHELLS` adds `programs.zsh.enable` / `programs.fish.enable`
  with it. That was checked by evaluating both ways: with the module,
  `environment.shells` holds zsh or fish; without it, only bash and sh while
  the account's shell has already changed. bash takes `pkgs.bashInteractive`,
  not `pkgs.bash` — the second is built without readline. The option is
  `absolute path or package`, so the value is Nix source, the way
  `boot.kernelPackages` is.
- **The desktop presets name candidates, not paths.** `DESKTOPS` lists a few
  possible names per role and takes the first the catalogue has, because these
  have already moved once and asymmetrically: `gdm` and `sddm` left
  `services.xserver`, `lightdm` did not; `gnome` and `plasma6` left it, `xfce`
  and `cinnamon` did not; `plasma5` is gone. A hard-coded path would have been
  right for two of the three and silently wrong later for all of them. They add
  ordinary option cards rather than writing into the starter file — the starter
  has no catalogue to check against, and a preset nobody can see or edit is the
  wrong shape for this tool.
- **A desktop preset may need a package, and it is looked up like any other.**
  The three Wayland compositors carry one: each is a compositor and nothing
  else, so `packages: ['noctalia-shell']` puts the panel, launcher and
  notifications on top. Nothing in the option catalogue mentions noctalia, which is why it is a
  package rather than a role — and it goes through `/api/packages?attrs=`
  first, so a channel without it gets nothing written rather than a line that
  fails at `nixos-rebuild`. The status bar names what went into
  `environment.systemPackages` alongside the settings; installing something
  without saying so is the one thing this preset must not do.
- **One service, two shapes, and Nix will not take both.** Written by the
  preset the unit is an attrs card holding `noctalia-shell = { … }`; read back
  out of a file it arrives **flattened**, one card per leaf
  (`systemd.user.services.noctalia-shell.after`, …), because that is what the
  importer does with an attribute set. Both in one file is `attribute … already
  defined` — and it is the *parser* that says so, not the evaluator, so
  `nix-instantiate --parse` refuses the whole file. So `autostartEntries`
  matches either shape by name, `addAutostart`
  clears the leaves before writing the card, and `dropAutostart` takes both
  out. **It matches on the name, never on the text of the unit**: a unit that
  has been through a file and back is not character-for-character the same, and
  that mismatch is what let the stale copy survive and then collide. The
  general case is caught in `doRender` — a path that is a prefix of another
  path is that same crash, whatever option it is on.
- **A duplicate attribute is a parse error, so refusing the file refuses the
  settings with it.** `normalise` gives up on anything Nix will not parse,
  which is right — except for `attribute … already defined`, where the file is
  otherwise sound and nixgen is the one tool that can resolve it. That case
  falls back to the direct reader, `read_config` collapses the repeated path to
  its last definition (Nix has no answer for which wins; it refuses the file),
  and the summary names the attribute. **Nothing else falls back**: guessing at
  a broken file is how a generated file goes quietly wrong.
- **A desktop's packages leave with the desktop.** noctalia-shell,
  xwayland-satellite and foot are put there by a preset, so switching to GNOME
  takes them out again; `PRESET_PACKAGES` is every name any `DESKTOPS` entry
  lists, and only the ones the incoming desktop does not also want are removed
  — foot belongs to Hyprland and niri both, so moving between those two leaves
  it alone. The status bar names what went, because a name the user typed is
  indistinguishable from one a preset wrote.
- **A shell nobody starts is a package in the store, so the compositors write
  a unit.** `AUTOSTART_UNIT` binds noctalia to `graphical-session.target`, and
  all three reach it — sway's default config starts `sway-session.target`
  (which `bindsTo` it), niri ships its own units, Hyprland only through UWSM,
  which is why that preset sets `withUWSM` and names the **`hyprland-uwsm`**
  session rather than `hyprland`. All three were evaluated with the unit in
  place. `systemd.user.services` is `attribute set of (submodule)` and
  unsupported, so it is held the way `nix.settings` is — a line of source per
  key — and the writes **merge rather than assign**, because the card may hold
  somebody else's service. It is dropped on a desktop switch like a greeter,
  and only the key nixgen wrote. The unit is written **only when the package
  came back**: an ExecStart into a package this channel lacks would fail at
  `nixos-rebuild`.
- **A user service that spawns things needs a PATH written out.** NixOS gives
  one `Environment="PATH=coreutils:findutils:…"` and nothing else, so noctalia
  started and could not launch anything from its own list — reported from a
  real machine after the unit shipped. nixpkgs' niri module sets
  `enableDefaultPath = false` for exactly this, but that only helps where the
  session put a usable PATH into the user manager, and the three disagree:
  niri-session imports one, sway imports only DISPLAY/WAYLAND_DISPLAY/SWAYSOCK,
  and Hyprland's `systemd.setPath` defaults off above 0.41.2. So
  `AUTOSTART_UNIT` drops the default *and* names the PATH, using the list
  Hyprland's own module uses against the same symptom. Evaluate the unit text
  and check no coreutils-only PATH survives.
- **A terminal is part of "it works", and two of the ten ship none.** The
  module defaults were read out of evaluated systems: sway brings foot and
  wmenu, i3 brings xterm and dmenu, **Hyprland and niri bring nothing** — so
  their default keybinding opens nothing and the desktop looks broken. They get
  **different** terminals, because a default config names the one it wants:
  Hyprland's asks for `kitty` by name (found by running it — the package ships
  no config file to grep), niri works with `foot`. Check both halves for a new
  compositor: whether its module furnishes a terminal, and which one its own
  default config calls for.
- **Nesting is only a collision when the key is in both cards, and the
  warning must check the key.** `nix.settings = { experimental-features = …; }`
  beside `nix.settings.cores` is ordinary Nix — the catalogue holds
  `nix.settings.cores` as its own option, so every imported file produces this
  shape, and the path-only version of the check warned about files that built
  fine (evaluated to confirm). The check reads the leaf's next segment and
  asks whether the ancestor's value actually holds it — as an object key, or
  by `key =` pattern when the value is verbatim source.
- **The keyring's PAM switch goes on `login`, and the sddm one is a no-op.**
  `security.pam.services.sddm.enableGnomeKeyring = true` changes nothing: the
  built pam.d/sddm is one `include login` line, which was read to find out why
  the first attempt did nothing. The pair the compositors get is
  `services.gnome.gnome-keyring.enable` (a role) plus a flat card on
  `security.pam.services.login.enableGnomeKeyring` — verify by building
  pam.d/login and counting three pam_gnome_keyring lines. Both leave when the
  desktop does; GNOME and Plasma wire their own.
- **A flat card must clear its key from ancestor attrs cards, not only from
  descendants.** Importing a file folds a flat
  `environment.sessionVariables.XKB_DEFAULT_LAYOUT = …` line into an attrs
  card on the parent option; re-picking the language then wrote the flat line
  beside that card, the leaf was defined twice, and `nixos-rebuild` refused
  the file — the third variation of the two-shapes collision, and it reached a
  real machine through the previous fix's own output. `dropFromAncestors`
  walks the prefixes of the card's segments and deletes just the one key,
  which both `setRawCard` and `dropRawCard` run. The fixed case is the
  machine's own flow: import a file carrying the flat line, switch desktops,
  re-pick the language.
- **The import must reconcile shapes, not only exact paths.** "Import replaces
  what it lands on" was compared by rendered path alone, and the importer
  changes shape on the way in — a flat line folds into an attrs card, an
  attribute set flattens into leaves — so importing nixgen's own
  `generated.nix` into the session that produced it left the preset's flat
  `XKB_DEFAULT_LAYOUT` card beside the file's folded block: the fourth
  variation of the two-shapes collision, found by running the eleven-point
  sweep on a form that already held the presets. `intoModule` now runs the
  same key-wise pass in both directions before placing arrivals — each
  arriving card's key is dropped from ancestor attrs cards
  (`dropFromAncestors`), and an arriving attrs card drops the flat cards for
  the keys it holds. Keys the arriving card does not hold are left alone,
  because nesting on different keys is ordinary Nix.
- **What a preset writes under an attrs option is a flat line, not a block.**
  An attrs card (`environment.etc = { … }`) sitting beside a flattened copy of
  itself — which is exactly what Import generated.nix produces — is `attribute
  … already defined`, and it reached a real machine through this tool's own
  recovery instructions. `setRawCard` writes
  `environment.etc."sway/config".source = …;` instead: sibling paths merge in
  the module system, and the line reads back in as the same card, so the shape
  survives the round trip. The autostart unit still uses the attrs form with
  leaf-clearing; anything new should use flat cards.
- **The Wayland keyboard layout is an environment variable, not an option.**
  wlroots compositors read none of `services.xserver.xkb`; their keymaps come
  from libxkbcommon, whose fallback is `XKB_DEFAULT_LAYOUT` (checked in the
  library's strings). The language preset sets it via
  `environment.sessionVariables`, which PAM applies to every login. Hyprland's
  generated config writes `kb_layout = us` outright and wins over the
  environment — that one is the user's file to change.
- **`pkgs.sway` is not the sway the module installs.** Same version, two
  builds: the module's has `isNixOS = true`, whose config keeps the wallpaper
  (from /run/current-system) and ends with `include /etc/sway/config.d/*` —
  the line that loads the systemd integration, which is what starts noctalia.
  Plain `pkgs.sway` is patched the other way: include removed, wallpaper
  commented out (`sway-config-no-nix-store-references.patch` vs
  `sway-config-nixos-paths.patch`). Deriving the no-bar config from the plain
  one shipped a file with neither line, and the machine came up black with no
  shell. Derive from `config.programs.sway.package`, and verify the built file
  has the include, the wallpaper, no bar block and all 75 bindsym lines.
- **Sway furnishes itself, bar included, and that bar has to go.**
  `/etc/sway/config` ends with `bar { position top … }` running swaybar, so
  noctalia makes two. The sway module has no `extraConfig` and `mode invisible`
  (sway-bar(5)) would have to go inside that same block, so the preset
  overrides `environment.etc."sway/config"` — NixOS sets it with
  `mkOptionDefault`, so this replaces rather than collides — with the package's
  own file minus the block. **Verify by building the derivation and diffing
  against the package's config**: it must remove those 13 lines and nothing
  else (75 bindsym lines survive). `ETC_KEYS` makes it leave on a desktop
  switch like the greeters and the unit.
- **A `const` used inside the `DESKTOPS` literal must be declared above it.**
  `SWAY_CONFIG_NO_BAR` sat with the other autostart constants, which are below
  it, and `const` is not hoisted — every later declaration died in the temporal
  dead zone and the page threw `Cannot access 'ALL' before initialization` from
  handlers that had nothing to do with it. The misleading name in the error is
  the thing to remember.
- **Nix's indented string is `''`, and writing `'''` produces a file that stops
  parsing at the last line.** The error names the end of the file, not the
  string, so it reads like something is missing at the bottom.
- **Hyprland greets a new user with a warning, and it is not nixgen's to
  remove.** On first login it writes its own config into `$HOME` and shows
  `You're using an autogenerated config!` across the top until that file is
  edited — which reads as a broken install and was reported as one. No NixOS
  option touches it, and writing a system config instead would replace the
  keybindings the user has just been told about, so the preset's `note` says
  what the banner is and which line removes it. The strings came out of
  `bin/.Hyprland-wrapped`, not the package's `share/hypr/hyprland.lua`: the
  shipped example carries no marker, the embedded one does. **The wrapper is
  why `strings bin/Hyprland` finds nothing** — read the `.`-prefixed real
  binary.
- **Hyprland is hidden from the dropdown, not deleted from `DESKTOPS`.** Its
  generated config owns the keyboard layout, the terminal and the banner, and
  overrides what nixgen writes — a working desktop cannot be promised from the
  form alone, so the `<option>` is gone (a comment in `index.html` says so).
  The entry stays because the cleanup paths read `DESKTOPS`: an imported file
  that carries Hyprland still gets its greeter, kitty, session name and unit
  removed on a switch, which is tested. Deleting the entry would orphan all of
  that.
- **A window manager is not a desktop, and a compositor is not either.**
  `DESKTOPS` holds ten, in three shapes: X plus a greeter plus the desktop
  (GNOME, Plasma, Xfce, Cinnamon, LXQt), the same three with a window manager
  in the third place (i3), and the three Wayland compositors (Hyprland, Sway,
  niri) plus COSMIC's pair. **XWayland is on for all three, by two different
  means**: Hyprland and Sway have an option (already their default — set anyway
  so the file says which way it is), and niri has none because it does not
  carry XWayland, so `xwayland-satellite` goes in as a package and the note
  says the niri config has to spawn it. **The three take sddm with
  `wayland.enable`, and
  that second option is the point**: the two sddm configs were built to compare
  them, and without it sddm writes `DisplayServer=x11` — an X11 login screen in
  front of a machine with no X server. They get no `services.xserver.enable`,
  and each carries `noctalia-shell` as a package. Where a preset stops short of
  a role, `note`/`note_ja` says so in the status bar rather than the gap being
  filled with a guess.
- **Only one greeter survives a desktop switch, and only nixgen's own paths are
  touched.** Two display managers is `conflicting definition values` at build
  time (gdm force-disables the rest — evaluated to prove it), so `addDesktop`
  drops the `GREETERS` paths that are not the new desktop's, sddm taking its
  wayland switch along. The desktop cards themselves stay: two desktops is two
  sessions on one login screen, which is legal and was evaluated
  (`sessionNames` lists both). A greeter someone enabled by hand under a path
  not in `GREETERS` is not nixgen's to remove.
- **The session names in `DESKTOPS` came out of evaluated systems, and NixOS
  checks them.** Every desktop preset sets
  `services.displayManager.defaultSession`; the names (`gnome`, `plasma`,
  `none+i3`, …) were read from `services.displayManager.sessionData.sessionNames`
  per desktop, and a wrong one fails the build outright — the assertion was
  triggered on purpose to confirm it is real. The option is `null or session
  name` with a raw inside, so the value is Nix source and goes in quoted, the
  way `console.keyMap` does. COSMIC sets none: the option only speaks to GDM,
  LightDM and SDDM.
- **A role a desktop does not have is left out, not filled in.** COSMIC is two
  settings where the others are three: it is Wayland, so there is no
  `services.xserver.enable` to set, and it ships its own greeter, so neither
  sddm nor lightdm belongs to it. Symmetry with the other four would mean
  building an X server nothing runs. The five were each evaluated as a NixOS
  system to see what actually comes out — that is also how the language
  preset's "the CJK fonts come with the desktop" was rechecked against the two
  new ones rather than assumed to still hold.
- **Anything that hands the file over waits for the render first.** `pushRender`
  is debounced by 120ms and the render happens on the server, so `generatedText`
  trails the form for a moment after every keystroke. `settled()` forces the
  pending render and waits for it, and returns false when the last one failed —
  the two downloads, Copy and Check syntax all go through it. Typing a host name
  and pressing Download all three immediately was enough to get an archive that
  did not match the screen, and nothing said so.
- **A failed request must not leave the app looking empty or looking fine.** The
  boot sequence unhides the Setup pane at its end, so one failed fetch used to
  leave a blank column and no message; a failed render used to leave the last
  file that worked on screen and downloadable. Both now say what happened.
- **The README logo is theme-aware, because GitHub's dark theme swallows the
  black one.** The artwork is black line art whose shape lives entirely in the
  alpha channel (the grey channel is 0 everywhere), so on `#0d1117` it is
  nearly invisible — checked by compositing it. `docs/logo-white.png` is the
  same alpha over a white canvas, and both READMEs pick between them with
  `<picture>` + `prefers-color-scheme`, which GitHub honours. **Do not simply
  swap in the white one**: it disappears on the light theme instead. Rebuild
  it from `docs/logo.png` if the artwork changes — `-negate` is the wrong tool
  (it inverts alpha too, and reads back mid-grey); extract the alpha and
  composite it over white, then check the two shapes are pixel-identical.
- **Two levels of detail, and which one goes where was measured.**
  `docs/logo.png` is the artwork — trimmed, transparent, 9.6 KB — and it is
  used where there is room: the homepage hero, the top of both READMEs, and
  above the five steps in the app (served at `/logo.png`). **At 48 pixels it
  renders as grey mush**, so the header at 22px and the favicon at 16 use the
  plain flake from `tools/mark.py` instead. Replacing one with the other in
  either direction breaks whichever end it is moved to.
- **The mark is generated, and inlined in both pages rather than fetched.**
  `tools/mark.py` draws it: six arms by rotation so they are actually
  identical, and two forms because one cannot do both jobs — the full drawing
  with its arcs for the homepage hero, and a cropped, thicker flake for the
  headers and the favicon, since the full one at 22px is a smudge. Change the
  drawing there and paste the forms back into `build/static/index.html` and
  `docs/index.html` — the two forms in both pages, plus the `--icon` tile in
  the homepage's application section; nothing loads any of them at runtime,
  so there is no file to keep in step and no request to fail. **The palette follows the mark**: it is black
  on white, so `--accent` is ink rather than blue, and anything that used blue
  to mean "matched" or "selected" uses a tinted ground instead.
- **The artwork exists as numbers now, and that is what `--logo` is.**
  `docs/logo.png` is a raster, so it could only ever be used where there was
  room; `LOGO_PATH` in `mark.py` is the same drawing traced out of it with
  potrace, so it can be rendered at any size. The command that produced it is
  in the comment above it and `docs/logo.png` is its only source — do not
  hand-edit the path data. **It is one `d` on purpose**: potrace fills
  outlines rather than stroking them, so which regions are holes is carried by
  the winding of the subpaths in order, and splitting them apart changes the
  drawing. Note what this does **not** fix: tracing changes the format, not
  the amount of detail, so the artwork is still mush when it is small.
- **The application icon is two renditions, and the split was measured.**
  `mark.py --icon` is the traced artwork on a rounded white tile and
  `--icon-small` is the plain flake on the same tile; `flake.nix` renders the
  first at 64, 128 and 256 and the second at 16 through 48, plus the artwork
  as the `scalable` SVG. **Rendering both at 32, 48 and 64 is what decided
  it** — at 48 the artwork is not identifiably a snowflake, and the flake is,
  which is the same finding that keeps `docs/logo.png` out of the 22px header.
  A theme is allowed to disagree per size; that is what the size directories
  are for. **GTK was checked rather than assumed**: it prefers an exact-size
  directory over `scalable`, which is what keeps the artwork out of a 24px
  panel slot — verify with `Gtk.IconTheme.lookup_icon` against the built
  output if the set of sizes changes. An icon cannot pick per theme the way
  the README's logo does with `<picture>`, because an application menu shows
  one file, and line art on a transparent ground is invisible on a dark panel,
  so both renditions carry the ground. The flake's stroke is 4.6 against the
  header's 3.4: below that the arms go thin at 32px, above it the core
  hexagon fills in and the middle turns to a blob.
- **Sized PNGs are not belt-and-braces, they are how the split is expressed.**
  One SVG cannot be two drawings, so shipping only `scalable` would mean one
  rendition at every size, and it would be the wrong one at the sizes a panel
  and a menu actually ask for.
- **Undo is a stack of JSON snapshots, and a step is a user action.** One
  press of the module header's Undo puts on screen what was there before the
  last add, preset, import, edit or removal. `remember()` runs where actions
  start — the search-result click, the seven preset buttons, `readInto`, the
  two removal ×s — and on focus for edits (Setup fields directly, everything
  in `#editor` through one focusin delegate), so typing is one step per
  edit, not one per keystroke; a snapshot identical to the top of the stack
  is not pushed. **The automatic repairs (`ensureImType`, `ensureUnfree`)
  never create steps** and simply re-apply after a restore, which is what
  keeps a restored state as valid as a built one — undoing "add steam"
  takes the auto-added `allowUnfree` with it because nothing needs it any
  more, and undoing to a state that still names something unfree gets the
  switch put straight back. A snapshot holds the module, the Setup fields,
  `unfree` and `carriedImports`; restoring re-dispatches `change` on the
  fields so the starter and dependent UI follow. `boot()` empties the stack
  — history recorded against one channel means nothing on another — **and
  that is why `undoStack` is declared beside `state` at the top of the
  file**: boot() runs during the initial script pass, and declared beside
  its own functions further down the const was still in its temporal dead
  zone, boot aborted, and two sweep points later Check syntax was parsing
  an empty configuration.nix. The TDZ bullet below already told this story;
  it happened anyway.
- **Dark mode is the same page with different variables, and the switch is
  an attribute.** `:root[data-theme="dark"]` overrides the palette; an
  inline script in `<head>` sets the attribute before the stylesheet paints
  (the saved choice first, then the system's), so a dark launch never
  flashes white, and a system-theme change is followed live while nothing
  is saved. The file pane's night colours (`--code-*`) are the one part
  that does not change — light mode's right column was already the
  destination, and the rest of the page moves into its family.
  **Hard-coded colours are what break this**: every white that predated
  dark mode now lives in a variable (`--card`, `--hover-bg`, `--hit`,
  `--accent-fg`, `--danger-bg`…), one-off tints (badges, the verbatim
  card) get explicit dark overrides, and one `background:#fff` hid in an
  inline style in `packagePicker` — grep both files, not just the CSS.
  `color-scheme` is what turns the native half (selects, checkboxes,
  scrollbars) dark with the rest. Three things CSS cannot reach are kept
  in step from `applyTheme` in `app.js`: the favicon (a data URI cannot
  read variables, so its ink is string-swapped), the toggle's label (it
  names the theme you would switch to), and the saved choice. `/logo.png`
  in the steps is pure black in the alpha channel, so `invert(1)` is
  exact, not approximate — the same fact the README's `<picture>` swap
  rests on. Dark `--ink-faint` was brightened until the eyebrows clear
  4.5:1 (measured, 3.6 before); check contrast when touching the dark
  palette, not just how it looks.
- No browser storage for anything that matters. State lives in `state` in
  `app.js`. **The saved theme is the single exception** — a toggle that
  resets on every launch reads as broken — and it is the whole list; the
  next cosmetic preference does not get to join it quietly.

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

# UI changes — the eleven-point sweep against a running server (needs playwright;
#   the launch recipe is in the tool's docstring). <outdir> saves the bundle.
python3 tools/browser_check.py http://127.0.0.1:8824/ <outdir>

# starter or preset changes — evaluate the bundle as an actual NixOS system
#   and read the claims back out of it. Takes the directory the sweep saved.
python3 tools/eval_check.py <outdir>
python3 tools/eval_check.py <outdir> --generated generated-roundtrip.nix
```

`tools/fuzz.py` renders thousands of real options with hostile values and runs
them through `nix-instantiate --parse`. The fixed regression cases at the top
matter as much as the random part: random sampling did **not** catch the
negative-number bug when it was deliberately reintroduced, because that seed
happened not to put a negative number in a list.

`tools/shots.py` retakes the three screenshots by driving the running app, so
they cannot drift the way they did — they had gone three features out of date,
because retaking them by hand was a chore nobody remembered. The build id and
the option counts are visible in every shot, which is how a stale one is spotted.

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

`tools/browser_check.py` is the eleven-point sweep every release pass used to
rebuild by hand in a scratchpad (DEBUGGING.md tells that story). It drives the
real app — real search, real file inputs, real Check syntax — and covers the
path that has broken more than once in ways nothing else caught: import a
`configuration.nix`, add a package from search, switch tabs, check. With an
outdir it saves the generated bundle and the round-tripped module, which is
what `eval_check.py` takes.

`tools/eval_check.py` is the final line of defence: Check syntax parses and
judges no types, so the tool evaluates the bundle as a real NixOS system and
then **reads the module's claims back out of it** — the session name the
display manager actually offers, the keyring lines in the built pam.d/login,
the sway config's include and missing bar, the Wayland layout variable.
Passing eval alone is not enough; a setting that evaluates and silently does
nothing is this project's oldest failure mode. `--revision` re-evaluates
against a reporter's nixpkgs, because "it evaluates on the development pin"
and "it evaluates on the reporter's machine" are different facts.

**All of the above runs on every push except `eval_check.py`**, from
`.github/workflows/checks.yml`, through `nix develop` so that CI and this
checklist are the same commands in the same shell. The browser sweep runs as
its own CI job against the cached index. `eval_check.py` stays out of CI
because it fetches a pinned nixpkgs and takes minutes — run it before a
release and whenever a preset changes what it writes. The index is built once
a week and cached; there is no restore-key on purpose, because a fallback
would mean it never refreshed, and a stale catalogue is the one thing these
harnesses cannot notice.

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
| the whole page scrolls sideways on a phone | four header buttons in a flex row with no `flex-wrap` |
| half a dropdown label is missing | a closed select drops what does not fit, and what did not fit was the Japanese |
| a preset row appears on every tab | the tab switch hid rows by id, and a new row was not on the list |
| build dies with `not of type 'package'` | `i18n.inputMethod.enable` was written without `type`, pushing a null into systemPackages |
| `attribute 'systemd.user.services.noctalia-shell.after' already defined` | an imported unit arrives flattened, and the preset wrote the attrs form beside it |
| the previous desktop's packages stay after switching | only the settings were dropped, not what the preset put in systemPackages |
| the same crash again, from a file that has a `type` line | the line was `type = null;`, and the guard tested that the entry existed rather than what it held |
| importing while the Setup tab is open throws | the repaint painted `kind=setup` results — options — with the package painter |
| the console fills with 404s on a package list | an `<img>` per row asked for icons the server had already said nothing about |
| the downloaded file is one edit behind the screen | rendering is debounced, and nothing waited for it |
| `attribute … already defined` after reading a file in | import joined the form instead of replacing what it landed on |
| the same error from importing nixgen's own generated.nix back in | the replace step compared exact rendered paths, and the importer changes shape — a flat line folds into an attrs card, a set flattens into leaves — so one leaf lived in two cards |
| the first screen is blank and says nothing | one failed fetch ended the boot sequence before the Setup pane was shown |
| `allowUnfree` vanishes when AMD or Intel is picked | the takes-it-out check only knew UI-added packages, so anything unfree that arrived by import did not count |

---

## Decisions taken, with reasons

- **Generate only; never write to the user's file.** Reading is safe; replacing
  values while preserving layout and comments is far harder and failure damages
  a working system.
- **System update hands over a command; the server never runs the privileged
  half.** There is no authentication on 127.0.0.1:8823, so an endpoint that
  could overwrite `/etc/nixos` and run `nixos-rebuild switch` would be
  reachable from any page open in the same browser — a drive-by rebuild with
  attacker-supplied contents. The button confirms, downloads, and puts one
  `bash -c '…'` on the clipboard; `sudo` and the two remaining confirmations
  live in the user's terminal. **Do not "improve" this into a POST that
  executes.** Three details in that command are load-bearing: it is `bash -c`
  with no single quotes inside, because it has to paste into fish and zsh too;
  the download folder is searched for rather than named, since `xdg-user-dir`
  answers `$HOME` when it is not installed and the folder may be `ダウンロード`;
  and `cp --backup=numbered` leaves the replaced files as `.~1~` beside the new
  ones. `hardware-configuration.nix` is not in the archive and is never named.
- **The command upgrades itself to the exact file, and the upgrade is
  read-only.** The searching loop takes the
  first directory holding the name, so a stale same-named archive wins over
  the fresh download — and when the browser dodges the collision by saving
  `name (1).tar.gz`, the loop cannot see the fresh file at all and unpacks
  last week's. So after the download the client polls `/api/locate-bundle`,
  which recomputes the archive name from the host (a name and a time in the
  request, never a path — the icon endpoint's no-joining rule), scans a
  fixed list of download directories (the XDG config first, which is where a
  localised ダウンロード is actually recorded), and returns the newest match
  written since the click, duplicate-name spellings included. Found, the
  dialog swaps the command in place for one naming that file and says where
  it was saved; not found, the searching command stands — detection is an
  upgrade, never a dependency, so the dialog is usable from the first
  moment. The interpolated path is used only when it cannot break out of its
  double quotes (no `'` `"` `\` `$` backtick); anything stranger keeps the
  searching command. The pre sits under `data-keep`, so the swap updates the
  stored text together with the visible one — one without the other and the
  observer hands the old command back.
- **`Check syntax` is `nix-instantiate --parse` and nothing more.** It cannot
  judge types. Every piece of copy that mentions it says so, because a user who
  thinks it validates will skip `dry-build`.
- **`--app` is an application window, not a kiosk, and the desktop entry is
  the only thing that passes it.** From the menu this is an application, so
  `open_app_window` starts a Chromium-family browser with `--app=<url>`: no
  tab strip, no address bar, no back and forward, but **ordinary window
  controls** — F11 is the user's to press. **`--start-maximized` goes with
  it, and it is maximised rather than fullscreen**: the app is three columns
  beside one another and the default app window is narrow enough to stack
  them, but `--start-fullscreen` takes the frame away and leaves the same
  trap as `--kiosk`. Verify it by the window's own state rather than by its
  size — `xprop _NET_WM_STATE` must show `MAXIMIZED_HORZ` and
  `MAXIMIZED_VERT` and no `FULLSCREEN`. **Comparing width against the X
  screen proves nothing on a multi-head machine**: 1920×1019 looked like a
  failure beside a 2784×1536 screen and was a correctly maximised window on
  the 1920×1080 head. Three parts of that are
  deliberate. It falls through to `webbrowser.open` when no such browser is
  installed, so nothing is added to the closure and a machine without one
  behaves exactly as before. **Firefox is not on `_APP_BROWSERS`**: its
  nearest equivalent is `--kiosk`, true fullscreen with no way out, and
  trapping somebody is worse than a tab. And a terminal launch gets no
  `--app`, because there a tab is what was asked for. The child is started
  detached with its output discarded — a browser writing to this process's
  stdout would bury the line saying where nixgen is. `startupNotify` stays
  false either way: the window belongs to the browser, not to this process,
  so the desktop cannot match a notification to it.
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
- **The desktop entry removes every command except the first and the last, and
  those two stay for different reasons.** `nix profile install` cannot go:
  **NixOS has no graphical package installer at all** — GNOME Software and
  Discover are Flatpak front ends here and do not manage system packages, so
  no amount of packaging reaches a GUI-only install. `System update` cannot go
  either, and that one is a choice rather than a limit — the server has no
  authentication, so it hands over a command instead of rebuilding. Everything
  between them is now a click. Do not "finish the job" by adding a privileged
  endpoint; that is the same door, from the other side.
- **A second launch opens the nixgen already running rather than refusing.**
  A busy port means a page is open somewhere (or a `--no-browser` server is
  being driven): the second window simply joins the same server, both pages
  count toward its lifetime, and the server leaves when the last of them
  closes. A refusal printed to a terminal
  nobody opened is indistinguishable from a broken icon. It **asks `/api/meta`
  first** — a busy port can hold anything, and pointing somebody's browser at
  an unrelated local service is worse than the message it replaces — and that
  case, plus `--no-browser`, still refuse, each with its own reason. **The
  build id in the header is still what says which copy answered**, which is
  the fact this must not paper over; the message says so rather than implying
  the new one started.
- **The process follows the last page out, and a page is counted, not
  guessed.** Every page invents an id and reports it — hello on load, a ping
  every twenty seconds, a bye beacon on pagehide — so a reload (bye, then
  hello within the grace) and a second window (a second id) fall out of the
  arithmetic instead of being special-cased. The exit waits five seconds
  after the last bye; the 300-second silence backstop exists only for a
  browser that died without saying bye, and it is that long **because Chrome
  freezes hidden tabs on battery** — a frozen page cannot ping, and exiting
  under a page that still exists reads as data loss. `time.monotonic()`
  throughout, so a suspend counts against nobody. Nothing arms until the
  first page connects (the first run builds its index for five minutes with
  no page open), and **`--no-browser` disables the whole mechanism**: tests
  and CI open and close pages at machine speed, and a harness must not have
  its server exit between suites.
- **The first-run notification is best effort and stays that way.** Five
  minutes of index building with no terminal to print to looks like a dead
  icon, so the wrapper calls `notify-send` when stdout is not a tty. It needs
  a session bus to reach anyone, so it is `|| true` — a launch must not fail
  because a notice could not be delivered.

---

## Documentation

- `CHANGELOG.md` is the only place entries live. English half on top, Japanese
  half below. `README.md`, `README.ja.md` and `docs/index.html` link to it.
- **Two branches, and the READMEs differ on purpose.** `main` is the stable one
  and is what a bare `github:hatake716/nixgen` resolves to; `development` is
  where work lands first. On `development` both READMEs carry a note saying so
  and every flake reference names the branch
  (`github:hatake716/nixgen/development`), because a page whose commands
  install something other than what the page describes is worse than no page.
  **None of that may travel to `main` in a merge** — the check is
  `git grep -n 'nixgen/development' README.md README.ja.md` after merging,
  which must return nothing; the grep is the authority, not a count of sites,
  because the sites have already multiplied once. Two of them are prose, not
  commands — the branch note and the upgrade/remove paragraph — and were
  *reworded* on `main` rather than stripped, so on `main` they read as
  main-native text (the CHANGELOG intro and the `v1.0.0-dev.1` heading intro
  got the same treatment). The first merge did this by hand; later merges
  keep `main`'s wording automatically as long as `development` does not edit
  those same lines, which is exactly when the grep will catch it.
  `docs/index.html` is deliberately left
  alone: GitHub Pages serves the homepage from `main`, so a branch-specific
  command there would be published to everybody.
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
- **The pitch is three reasons in a fixed order**, and both READMEs and the
  homepage's `section.pitch` carry the same three: a desktop that works on the
  first login, Japanese set up all the way through, nothing changes until you
  say so. The order is what moves a reader — what you get, who it is for, then
  why it is safe to try. **Safety goes third on purpose**: it removes an
  objection rather than creating a reason, and the closing line ties it back
  ("a desktop you can switch away from cleanly is one you can afford to try").
  Each reason is carried by specifics that were paid for in real failures —
  the PATH, the Wayland layout variable, the missing privileged endpoint — not
  by adjectives. **The counts are evidence, not the pitch**: 24,557 is
  nixpkgs' number, so it stays in the hero and never becomes the headline. Do
  not write "perfect" or its like about the Japanese support; it is the one
  claim a single bug disproves, and the Wayland layout was wrong until
  2026-08-11z.

> ドキュメントの数値は必ず再計算してください。コピーすると必ずずれます。

---

## Open items

None outstanding. The list this file carried for a while — unstable support,
index age, the port message, leftover databases, stale screenshots, the buried
import summary — is done. When something new goes on it, write down what makes
it hard, not just what is missing: every one of those was solved by the note
explaining the obstacle rather than by rediscovering it.
