# Changelog

[English](#english) · [日本語](#日本語)

Two identifiers, with different jobs. **The build id** (`2026-08-12o`) is in
the app header and in every file nixgen writes, and it changes whenever the app
does — it answers "which build wrote this". **The version tag** names a
snapshot and doubles as a flake ref.

**This is the `development` branch**, so its tags are `-dev`:
`nix run github:hatake716/nixgen/v1.0.0-dev.1`. The stable line is on `main`
(`v1.0.0-rc.3`), and anything above the newest `-rc` heading below has not
reached it yet.

---

## English

## v1.0.0-dev.10 — 2026-08-12

Landed on `development` first, merged into `main` since. A maintenance pass:
one new check, the presets made declarative, and ten defects — three of them
in code shipped days earlier, found by the new check and the audit that
preceded it.

### build 2026-08-12x

**Preparing for the six-month release cadence.** NixOS ships a numbered
release every half year, and nixpkgs renames things between them. nixgen
already survives that without crashing — a preset names candidates and takes
the first the catalogue has — and that is exactly the problem: a name that has
gone stale produces no error, just a setting quietly not written, or a row
quietly missing from a category.

- **`tools/catalogue_check.py`** asks the running app for every option path
  and package name its presets promise, asks the index which of them still
  exist, and names what does not. It reads the preset tables out of the live
  page rather than parsing the source, so it cannot drift from the thing it
  checks. It separates a spelling kept on purpose — nixgen offers three
  releases, so the old name is what keeps the older ones working — from one
  that has really gone, because a checker that cries wolf is one nobody runs.
  It runs in CI on every push.
- **CLAUDE.md gained a "when a new NixOS release lands" runbook**: build the
  new channel's index, run the one command, act on what it prints, then the
  harnesses in the order that makes each one trustworthy.
- **Every preset's option paths now live in a table** (`GPU_PATHS`,
  `LANG_PATHS`, `FLATPAK_PATHS`, `SHELL_PATHS`, `KERNEL_PATHS`,
  `REGION_PATHS`) instead of inside the function that writes them. Each
  preset's contract with the catalogue is readable in one place, and the
  checker can see it: coverage went from 56 groups to 71.
- **A renamed app is one entry with two spellings** — `['thunar',
  'xfce.thunar']` — the same candidate rule the desktop roles already follow.

**Defects fixed.**

- **LTS was handing out a two-year-old kernel.** 6.18 has been longterm since
  2025-11-30 and this channel ships it, but the list still led with 6.12. The
  new check is what caught it, which is the argument for the check.
- **Importing nixgen's own PulseAudio output produced a file that would not
  build.** The importer folded `lib.mkForce` away, and `lib.mkForce false` on
  PipeWire is the whole reason that preset writes what it writes — a plain
  `false` beside a desktop's plain `true` is the conflict it exists to avoid.
  `mkForce` and `mkOverride` are kept as written now; `mkDefault` still folds,
  because every line of the configuration.nix nixgen writes wears one and the
  Setup fields have to read their own file back. Both halves are pinned by a
  new fixed case, through both readers.
- **Every package icon was served at the worst size the theme had.** The sort
  that ranks icon directories ran in reverse, so 16×16 overwrote 256×256 — the
  code did the opposite of the comment above it. Firefox now comes from
  128×128, VLC from 256×256, GIMP from the SVG.
- **The module card's × could delete the wrong card.** It deleted by option
  path, and an imported file that sets one option twice — two users, two
  vhosts — files those under distinct keys that share a path.
- **Three preset dropdowns were missing from the machine-translation guard**,
  including Region's eighteen bilingual labels.
- A bad query parameter got no answer at all: `do_GET` now has the wrapper
  `do_POST` has had. `?limit=-1` returned the whole catalogue, because SQLite
  reads a negative limit as no limit. And offline, the "unused index" list
  offered a live channel's index for deletion — the fence that knows a channel
  is still on offer failed open when the probe answered nothing.
- **A mistyped host name was invisible in dark mode** (1.17:1, a colour that
  predated dark mode), and the reindex-failure message was the last
  hard-coded colour left in `app.js`.
- **The sweep could pass while the app was broken.** `check_syntax` polled a
  status bar it had not cleared, and the handler can return without writing
  one, so a verdict from an earlier point was sitting there to be read as this
  one's; and `settled()` returning false was discarded, so an assertion could
  be measured against the previous file.

Verified: fuzz, the importer through both readers, the eleven-point sweep, the
new catalogue check, and `eval_check` on both a fresh bundle and the
round-tripped module.

## v1.0.0-dev.9 — 2026-08-12

Landed on `development` first, merged into `main` since. Everything between
this heading and `v1.0.0-dev.8` is what it added.

### build 2026-08-12w

- **The Flatpak row has a dropdown now: pick the store app.** GNOME
  Software, KDE Discover, Bazaar or Warehouse — the graphical half that the
  three settings alone do not give you. **`settings only` is the old
  behaviour**, kept as the first choice: the three settings and no store
  app, and picking it again takes a front end back out. One store app at a
  time; switching drops the previous one and the status bar names what
  went.
- **The four are the four that exist, and each was opened rather than
  trusted.** Every candidate was built and searched for a Flatpak backend:
  `libgs_plugin_flatpak.so` in GNOME Software, `flatpak-backend.so` in
  Discover, and flatpak itself in Bazaar's and Warehouse's runtime
  closures. Flatseal is not on the list because nixpkgs has no such
  package — it is a Flathub app, which is to say you install it with the
  thing this row sets up.
- **GNOME Software goes in as a setting, not a package.**
  `services.gnome.gnome-software.enable` brings its systemd units along
  with the program, which a bare package would not — read back out of an
  evaluated system to be sure. It also works on desktops other than GNOME
  (Xfce was evaluated). GNOME switches that same option on by itself once
  Flatpak is enabled, and since both say `true` they merge instead of
  colliding — evaluated before shipping, because the Media playback row had
  just been caught by the opposite case.
- Verified against the running app, thirteen points: each choice writes
  what it claims, every switch leaves exactly one store app behind and a
  file that parses, `settings only` restores the pre-dropdown output, undo
  takes a pick back whole, an imported file selects the dropdown, and the
  labels fit the closed select. Then the real test: a GNOME + GNOME
  Software bundle and a Plasma + Discover bundle were generated by the app
  and **evaluated as actual NixOS systems**, with the store app read back
  out of `environment.systemPackages` — and the systemd units with it. The
  eleven-point sweep passes on top.

## v1.0.0-dev.8 — 2026-08-12

Landed on `development` first, merged into `main` since. Everything between
this heading and `v1.0.0-rc.3` is what it added.

### build 2026-08-12v

- **A Media playback dropdown, between Graphics and Language: PipeWire or
  PulseAudio.** PipeWire arrives with its compatibility layers — ALSA with
  32-bit support for Steam and wine, the PulseAudio socket most
  applications actually talk to — and rtkit, which grants it realtime
  scheduling. PulseAudio arrives with 32-bit support and one line that
  earns its spelling: `services.pipewire.enable = lib.mkForce false`. Some
  desktops switch PipeWire on themselves with a plain `true` — GNOME's
  remote desktop does, at this channel's revision — so an ordinary false
  is a same-priority conflict and the build refuses the file; the module
  system's own error message names mkForce as the answer. The status bar
  says what the choice costs (screen sharing and GNOME remote desktop need
  PipeWire) and that NixOS 26.11 drops PulseAudio with GDM entirely.
- **Evaluated, not assumed.** Each server with GNOME, with Plasma, and
  alone — six systems evaluated at the indexed revision, and the
  plain-false conflict reproduced before mkForce was chosen. In the
  browser, eleven points: the five PipeWire settings, the PulseAudio
  replacement, both switch directions leaving one clean definition and a
  file that parses, the row confined to the Options tab, the labels
  fitting the closed dropdown (measured on the open tab — a hidden select
  answers width 0), one-press undo, and an imported PipeWire module
  selecting the dropdown. The eleven-point sweep passes on top.

## v1.0.0-rc.3 — 2026-08-12

The third release candidate: `v1.0.0-rc.2.2` plus everything under the four
`v1.0.0-dev.4` through `v1.0.0-dev.7` headings below, which landed on
`development` first and have been merged. In one line: an Undo button, the
server exits when the last page closes, the status bar is twice the size,
and dark mode — system-following, hand-switched, marks included.

## v1.0.0-dev.7 — 2026-08-12

Landed on `development` first, merged into `main` since. Everything between
this heading and `v1.0.0-dev.6` is what it added.

### build 2026-08-12u

- **Dark mode.** The page follows your system's preference by itself, and a
  header button switches it by hand — the choice is remembered, and with
  nothing chosen the page keeps following the system live. Dark is the same
  room with the lights off: the file pane was already night-coloured, so it
  does not change, and the rest of the page moves into its family. The
  native parts — dropdowns, checkboxes, scrollbars — turn dark with it.
- **The marks switch too.** The header flake is drawn in the text colour
  and follows by itself; the artwork above the five steps is pure black in
  the alpha channel, so inverting it yields a clean white original, the
  same fact the README's dark-theme logo rests on; and the favicon's ink is
  swapped so the browser tab matches. The System update button keeps its
  amber warning colour in both themes — it is the one button that changes
  the machine.
- **Checked, not assumed:** a dark system gets a dark page unasked, the
  toggle flips and survives reloads in both directions, the inverted logo
  and swapped favicon were read back from the running page, every probed
  text/background pair in the dark clears 4.5:1 contrast (the faint labels
  failed at 3.6:1 on the first try and were brightened), no width scrolls
  sideways, and the eleven-point sweep passes. One `background:#fff` was
  hiding in an inline style and turned up in a screenshot, not in the CSS.
- The saved theme is the one thing nixgen now keeps in the browser. A
  toggle that resets on every launch reads as broken; everything that
  matters still lives in memory and nothing else is stored.

## v1.0.0-dev.6 — 2026-08-12

Landed on `development` first, merged into `main` since. Everything between
this heading and `v1.0.0-dev.5` is what it added.

### build 2026-08-12t

- **The status bar is twice as tall and its text is bigger.** Every
  bilingual answer the app gives lands in the bar under the file pane, and
  it was the smallest text on the page: 11px in a box that hugged two
  lines. Now 14px in a box held at twice its old measured height (45px →
  90px), with the scroll limit doubled alongside (160px → 320px) so a long
  message shows twice as much before it scrolls — and it still scrolls
  inside its own box rather than pushing the page. Measured, not
  eyeballed, before and after; no width from 320px up scrolls sideways.

## v1.0.0-dev.5 — 2026-08-12

Landed on `development` first, merged into `main` since. Everything between
this heading and `v1.0.0-dev.4` is what it added.

### build 2026-08-12s

- **Closing the last nixgen page now exits the server.** The page is the
  application: a few seconds after the last one closes, the process ends by
  itself, and nothing is left running in the background — clicking the icon
  again starts it fresh. Counted, not guessed: every page invents an id and
  reports it (hello on load, a ping every twenty seconds, a bye beacon as
  it closes), so a reload — whose bye is followed within the grace by the
  new page's hello — and a second window, which is simply a second id, fall
  out of the arithmetic instead of being special-cased.
- **The slow parts are deliberate.** The ordinary close is prompt because
  of the bye beacon; the five-minute silence backstop exists only for a
  browser that died without saying goodbye, and it is that long because
  Chrome freezes hidden tabs on battery — a frozen page cannot ping, and
  exiting under a page that still exists reads as data loss. Monotonic
  clocks throughout, so a suspended laptop counts against nobody. Nothing
  arms until the first page connects, so the five-minute first-run index
  build is safe.
- **`--no-browser` turns the whole mechanism off.** A driven server —
  tests, CI, the browser sweep — opens and closes pages at machine speed
  and must not have its server exit between suites; there, closing pages
  leaves the server exactly as it always was.
- Verified against real processes: reloads and a second window leave the
  server up, the last page closing ends it within seconds, and a
  `--no-browser` server ignores pages coming and going. The eleven-point
  sweep passes on top.

## v1.0.0-dev.4 — 2026-08-12

Landed on `development` first, merged into `main` since. Everything between
this heading and `v1.0.0-rc.2.2` is what it added.

### build 2026-08-12r

- **An Undo button, in the module pane's header.** One press puts on screen
  what was there before the last step, and a step is a user action: an
  option or a package added, a preset applied — one step, however many
  cards it writes — a file imported (including the Setup fields a
  `configuration.nix` fills), a card edited or removed. Editing is one step
  per edit, not one per keystroke: the snapshot is taken when the field is
  focused, before the typing. Up to fifty steps back; the button sleeps
  when there is nothing to return to, and pressing again keeps walking
  back.
- **The automatic repairs are not steps.** `ensureImType` and
  `ensureUnfree` re-apply on the render after a restore, so a restored
  state answers to the same rules as a built one: undoing "add steam"
  takes the automatically added `allowUnfree` with it, because with steam
  gone nothing needs it — and undoing to a state that still names
  something unfree gets the switch put straight back.
- Verified against the running app, nineteen points: the button wakes and
  sleeps with the stack, an added option leaves, steam leaves with its
  automatic switch, a whole desktop preset is one press, an edit reverts
  while its card stays, a `configuration.nix` import walks back Setup
  fields and module together, two steps come back in order, and an
  imported `generated.nix` leaves whole. The eleven-point sweep passes on
  top.
- Found by that sweep and fixed before shipping: the stack was first
  declared beside its own functions, far below `boot()` — which clears it
  during the initial script pass, where a `const` down there is still in
  its temporal dead zone. Boot aborted, the starter files never loaded,
  and the visible symptom was two import checks failing on an empty
  `configuration.nix` — the `SWAY_CONFIG_NO_BAR` lesson, relearned. The
  declaration now sits beside `state` at the top of the file.

## v1.0.0-rc.2.2 — 2026-08-12

`v1.0.0-rc.2.1` plus one improvement to System update: the command it hands
over now names the archive that was actually downloaded, rather than
searching the likely folders and taking the first hit — which could unpack a
same-named archive from an earlier day, or miss the fresh one entirely when
the browser saved it as `name (1).tar.gz`. The details are under
`v1.0.0-dev.3` below, which is exactly what this tag adds.

## v1.0.0-dev.3 — 2026-08-12

Landed on `development` first, merged into `main` since. Everything between
this heading and `v1.0.0-rc.2.1` is what it added.

### build 2026-08-12q

- **System update now finds where the archive actually landed, and the
  command names that exact file.** The handed-over command used to search
  the likely download folders and take the first hit, which has two holes:
  a same-named archive from an earlier day wins over the fresh download,
  and when the browser dodges the collision by saving `name (1).tar.gz`,
  the search cannot see the fresh file at all and unpacks the stale one.
  After the download the app asks the server — same machine, same user —
  where a file matching the bundle's own name landed since the click,
  duplicate-name spellings included, newest first. Found, the dialog
  upgrades the command in place to name that file and says where it was
  saved; not found (a browser saving somewhere unusual), the searching
  command stands unchanged. Detection adds precision and is never waited
  for.
- **The privileged half did not move.** The new endpoint is read-only and
  takes a host name and a time, never a path — the archive name is
  recomputed on the server and looked for only in a fixed list of download
  directories, the XDG configuration first, which is where a localised
  ダウンロード is actually recorded. The command still runs in your
  terminal with the same two confirmations, the backups, and no single
  quote inside; a found path is interpolated only when it cannot break out
  of its double quotes, and anything stranger keeps the searching command.
- Checked end to end against the running app: the dialog opens with the
  searching command immediately, upgrades to the exact path when the file
  is saved into the real download folder (`~/ダウンロード` on the machine
  this was written on), keeps the searching command when the file goes
  somewhere else, and the unprivileged half of the exact command was
  executed as written — Japanese path, fish paste and all. The eleven-point
  sweep passes on top.

## v1.0.0-rc.2.1 — 2026-08-12

`v1.0.0-rc.2` plus one important fix, tagged without waiting for the next
candidate: picking AMD or Intel no longer removes
`nixpkgs.config.allowUnfree`, and the switch now goes in by itself wherever
the file names anything unfree. The details are under `v1.0.0-dev.2` below,
which is exactly what this tag carries.

## v1.0.0-dev.2 — 2026-08-12

Landed on `development` first, merged into `main` since — a fix important
enough not to wait for the next candidate. Everything between this heading
and `v1.0.0-rc.2` is what it adds.

### build 2026-08-12p

- **Picking AMD or Intel no longer removes `nixpkgs.config.allowUnfree`.**
  Reported from a real machine: the graphics preset used to take the switch
  out "when nothing else needs it", and its needs-it check only knew the
  packages the UI itself had added — so with an imported Steam in the list,
  the AMD click removed the one line that let the file build. **Nothing
  removes the card automatically any more.** Deleting it is the user's
  decision alone.
- **The switch now goes in by itself, wherever it is needed.** Every render
  scans the file for package names and NVIDIA settings, and asks the index —
  which has known all along which packages are unfree — about any name it
  has not seen before. If something unfree is in the file and the switch is
  not, the card is added and the status bar says why, naming the packages.
  That covers every route in: a package clicked in the search results, a
  `generated.nix` or `configuration.nix` read back in, a name typed into a
  verbatim card, an imported NVIDIA module. It stands down when the switch
  is already set anywhere — in the module, or in the configuration.nix half
  of an import. And a card deleted while something unfree is still listed
  comes back on the next render, because a file that names an unfree package
  without the switch is one `nixos-rebuild` refuses outright.
- Verified against the running app, not by reading the code:
  NVIDIA→AMD→Intel keeps the card through every switch, steam from the
  search box and steam from an import each bring it in, a file that already
  sets it gets no second definition, an imported `hardware.nvidia.*` brings
  it in, and firefox alone does not — plus the eleven-point sweep on top.

## v1.0.0-rc.2 — 2026-08-12

The second release candidate: `v1.0.0-rc.1` plus everything under the
`v1.0.0-dev.1` heading below, which landed on `development` first and has been
merged. In one line: nixgen is an application now — installed once, it sits in
the application menu, and its icon opens a maximised window of its own. The
README's steps 2 and 2a now name the two ways of starting it — from a command,
from an icon — and the homepage says the icon way exists.

## v1.0.0-dev.1 — 2026-08-12

Landed on `development` first, merged into `main` since. Everything between
this heading and `v1.0.0-rc.1` is what it added; below that is the release
candidate it grew from.

### Packaging, 2026-08-12e

- **nixgen has a desktop entry now**, so `nix profile install
  github:hatake716/nixgen` is the last command it needs: after that it is in
  the application menu under System, and starting it from there opens the
  browser by itself. The icons are generated at build time by `tools/mark.py`,
  which keeps that file the only place the mark comes from — the same reason
  the two pages paste its output rather than fetching a copy. They carry a
  white ground, because an application menu shows one file and cannot pick per
  theme the way the README's logo does; line art with a transparent ground
  would be invisible on a dark panel.
- **The artwork is numbers now, so the icon can be the artwork.**
  `docs/logo.png` is a raster and could only be used where there was room —
  the app header and the favicon have always shown a simplified flake instead.
  It is traced into path data in `tools/mark.py`, so the original drawing can
  be rendered at any size, and the icon at 64px and up is that drawing rather
  than an approximation of it. **Tracing changes the format, not the amount of
  detail**: rendered at 32 and 48 the artwork is still not identifiably a
  snowflake, so those sizes keep the flake. Both were rendered at 32, 48 and
  64 to decide where the line falls. GTK was checked rather than assumed — it
  prefers an exact-size icon directory over `scalable`, which is what keeps
  the artwork out of a 24px panel slot.
- **The first command cannot be removed, and that is not nixgen's to fix.**
  NixOS has no graphical package installer at all — neither GNOME Software nor
  KDE Discover manages system packages here. Nor does this make the tool
  GUI-only end to end: `System update` still hands over one command rather than
  rebuilding for you, deliberately, because the server has no authentication.
  What it removes is every command *between* those two.
- **A second launch opens the nixgen already running instead of refusing.**
  Closing the browser tab leaves the server up, so with an icon to click that
  is the ordinary case rather than a development mishap, and a refusal printed
  to a terminal nobody opened reads as the icon being broken. It asks
  `/api/meta` before opening anything: a busy port can hold something else
  entirely, and sending a browser at an unrelated local service is worse than
  the message it replaces. That case, and `--no-browser`, still refuse — with
  the reason each of them actually has. **The build id in the header is still
  what says which copy answered**, which is the one thing this must not paper
  over.
- **The first run says something without a terminal to say it in.** Building
  the index takes about five minutes, and started from the menu the progress
  line goes nowhere, so it puts up a desktop notification instead. Best effort:
  it needs a session bus to reach anybody, and a failure there does not stop
  the launch.
- **Started from the icon, it gets a window of its own** — no tab strip, no
  address bar, no back and forward. It is an application in the menu, so
  arriving as one tab among twenty in a browser session already open reads as
  a website rather than as the thing that was just clicked, and the browser's
  own chrome offers nothing the page uses. The desktop entry passes `--app`;
  a terminal launch does not, and keeps the ordinary browser, where a tab is
  what you asked for. Nothing was added to the closure for this — the flag is
  Chromium's and its relatives all spell it the same way, so it is whatever is
  already on the machine or nothing, and nothing means the previous behaviour.
  **Firefox is left off that list on purpose**: its nearest equivalent is
  `--kiosk`, which is true fullscreen with no window controls, and a window
  somebody cannot find their way out of is a worse answer than a tab. What
  this gives is an ordinary window with ordinary controls; F11 makes it
  fullscreen if that is what you want.
- **That window opens maximised.** The app is three columns beside one
  another and the default size a browser gives an app window is narrow enough
  to stack them, which is the wrong first impression of a tool whose whole
  layout is "the form here, the file there". Maximised, not fullscreen: the
  title bar and its buttons stay, so it can be put back to a smaller size the
  ordinary way.
- **An icon pinned to a dock keeps launching the version it was pinned to**,
  and the README says so now. Not a nixgen bug and not fixable from here: a
  dock stores the launcher's absolute path, the menu entry is a symlink into
  the store, so a store path is what gets stored — and those never change, so
  an upgrade writes a new one and the pinned file goes on pointing at the old.
  Found on a real machine with Plank, where it looked exactly like `--app`
  having no effect. Remove the icon and add it again; the application menu
  itself is fine, since it reads the profile.

## v1.0.0-rc.1 — 2026-08-12

The first release candidate. Everything below this heading is what it contains;
the build entries under it are the history of how it got here.

**What it does.** From a fresh NixOS install to a machine you can use, without
knowing a single option name: search all 24,557 settings and 144,245 packages,
fill in values with widgets that know the type, pick a desktop that works on
the first login, and take away three files you can read before anything on your
machine changes.

**In this candidate.**

- Nine desktops, two of them Wayland compositors that arrive with a shell,
  a terminal, a keyring and an autostart unit already wired — Sway + noctalia
  and niri + noctalia, both confirmed on a real machine.
- Japanese set up all the way through: locale, console keymap, the keyboard
  layout for X *and* Wayland, fcitx5 with mozc and its front end matched to
  the session. The app itself speaks both languages everywhere.
- Kernel, shell, graphics, language, region and Flatpak in one click each,
  and 189 common apps in twelve categories with icons from your own machine.
- Reads your existing `configuration.nix`: the Setup fields take what they
  own, `imports` is merged, and everything else becomes cards you can edit.
  Reading a `generated.nix` back sets the dropdowns to what it chose.
- Generate only. nixgen never edits your files and has no privileged
  endpoint; System update hands you one command you can read.

**How it is checked.** `tools/fuzz.py` and `tools/import_check.py` on every
push, plus `tools/browser_check.py` — eleven points driving the real app in a
browser. Before this tag, `tools/eval_check.py` evaluated the generated bundle
as a NixOS system and read its claims back out: the session name the display
manager offers, the keyring lines in the built pam.d/login, the sway config's
include and missing bar, the Wayland layout variable. The round-tripped module
evaluates identically.

**Known limits.** NixOS only. Hyprland is hidden: its generated config
overrides what nixgen writes. `Check syntax` runs the Nix parser and cannot
judge types — `dry-build` before you switch.

---


### Tools, 2026-08-12d

- **The eleven-point browser sweep is a command now**: `tools/browser_check.py`
  drives the real app — real search, real file inputs, real Check syntax —
  through every point the release passes have always checked, and runs in CI
  on every push as its own job. It had lived in session scratchpads and been
  rebuilt by hand for every verification pass; this is the same fix the
  screenshots got.
- **The real-system evaluation is a command too**: `tools/eval_check.py` takes
  the directory the sweep saves, adds the stub hardware file, evaluates the
  bundle as an actual NixOS system, and reads the module's claims back out of
  it — the session name the login screen offers, the keyring lines in the
  built pam.d/login, the sway config's include and missing bar, the Wayland
  layout variable, the nvidia driver, the time zone. `--generated` evaluates
  the round-tripped module, `--revision` a reporter's nixpkgs. It stays out
  of CI on purpose: it fetches a pinned nixpkgs and takes minutes.
- Both ran to completion on this build: all eleven points pass, and both the
  fresh bundle and the round-tripped module evaluate and read back correctly
  against the indexed revision.

### build 2026-08-12o

- **Fixed: an import could leave one leaf defined in two shapes, and the file
  refused to parse.** The importer changes shape on the way in — a flat line
  in the file folds into an attrs card on its parent option, an attribute set
  flattens into one card per leaf — while the replace-on-import sweep compared
  exact rendered paths, so the file's card and the form's card could hold the
  same attribute under different paths and both survive. Importing nixgen's
  own `generated.nix` back into the session that produced it was enough: the
  language preset's flat `environment.sessionVariables.XKB_DEFAULT_LAYOUT`
  card stayed beside the file's folded block, Check syntax reported
  `attribute … already defined`, and re-picking the desktop healed only the
  unit and etc halves. The fourth variation of the two-shape collision.
- The reconciliation is now by key, in both directions, the way
  `dropFromAncestors` already did it for the presets: an arriving card clears
  its own key out of ancestor attrs cards, and an arriving attrs card clears
  the flat cards for the keys it holds. Nesting on *different* keys is
  ordinary Nix and is left alone — `nix.settings = { experimental-features =
  …; }` beside `nix.settings.cores` still parses and still survives an
  import, which was re-verified along with the full eleven-point browser
  sweep on this build.

### Documentation, 2026-08-12c

- **Added `DEBUGGING.md`**: a handover for whoever debugs next. How the
  verification has been done and how to repeat it — the browser sweep's
  eleven points, the real-system evaluation harness, the inspection recipes —
  plus the six families every bug so far has belonged to, the honest boundary
  between verified and unverified, and the test-side false positives to avoid
  repeating. CLAUDE.md stays the home of the invariants; this is the home of
  the method.

### build 2026-08-12n

- **Fixed: the import status glued the bilingual row labels together** —
  "Language言語, Region地域". The stacked label is one span, so reading its
  text joined both languages; the English name is the first text node, and
  that is what the list uses now.
- Hunted the two newest features for more and found nothing else: packages
  from an imported configuration.nix grey out and append correctly, a second
  import replaces rather than duplicates, a setup-only file leaves the module
  empty, a file carrying hidden Hyprland selects nothing, and aarch64 still
  unhides the architecture through the new routing.

### build 2026-08-12m

- **Importing a `configuration.nix` now puts everything the Setup tab does not
  own into the module, as cards.** It used to copy those lines verbatim into
  the `configuration.nix` the Setup tab writes.
- Why the change: the file they were copied into is generated by nixgen
  anyway, so nothing was being preserved — and copied text can only be looked
  at, while a card can be edited, matched against the catalogue and checked
  for collisions. The Setup fields and the `imports` list are unchanged, and
  the settings the Setup tab owns still stay out of the module so nothing is
  defined in both files.
- The Options dropdowns follow, so a `configuration.nix` with a locale and a
  time zone comes back with Language and Region already selected.

### Verification pass, 2026-08-12b

The second full sweep before calling this stable, covering everything since
the first — the allowUnfree wiring, the redesigned chrome, the bilingual
Setup tab, the fixed architecture. **Nothing needed fixing.**

- **The whole archive builds**: every preset at once (Sway + noctalia, NVIDIA,
  Japanese, region, kernel, shell, Flatpak, a searched package), downloaded,
  unpacked and evaluated as a NixOS system. Read back from the evaluated
  system: `videoDrivers = ["nvidia"]` under `allowUnfree`, the time zone, the
  Wayland layout variable, a sway config with the include and without the
  bar, and three pam_gnome_keyring lines on login.
- **Re-importing that archive and re-picking the desktop heals to single
  definitions** — one etc line, one unit.
- **A desktop walk ends with exactly one display manager**, allowUnfree
  intact, and no compositor leftovers.
- The System update dialog, the broken-file imports (duplicate attribute,
  null input-method type, aarch64 unhiding the architecture), the mobile
  nav, the visual rules (no ja gaps, no sideways scroll 320-1800px), the
  fixed harnesses through both readers, and the flake build — all clean.

### build 2026-08-12k

- **The Architecture field is fixed to `x86_64-linux` and hidden** — one less
  decision, and the answer is the same for practically every PC.
- Hidden, not removed: the select stays wired, and **importing a
  `configuration.nix` that carries another architecture brings the field back**
  with that value, so a machine's real architecture is never carried
  invisibly. Verified both ways: a fresh page hides the row and the flake says
  `x86_64-linux`; importing an `aarch64-linux` file shows the row and the
  flake follows.

### build 2026-08-12j

- **Everything the Setup tab says is bilingual now.** The intro, every field
  label (stacked, the way the preset rows are), the three checkboxes, the
  notes under Groups, GRUB, `system.stateVersion` and `lib.mkDefault`, the two
  rebuild-command headings — and the dynamic messages too: the channel and
  pin notes in all their variants, the leftover-index note, the host, user and
  stateVersion warnings, and the rebuild/switch/build button labels.
- One rendering rule came out of it: only the notes app.js writes render
  `\n` as a line break. The static ones are wrapped in the HTML source, and
  applying `pre-line` to them turned that wrapping into hard breaks
  mid-sentence.

### build 2026-08-12i

A design pass: the same monochrome identity, with the order of work worn by
the interface itself.

- **The five steps are on the controls now.** The three catalog tabs carry
  numbered chips — 1 Setup, 2 Options, 3 Packages, each with a small Japanese
  line — and Check syntax and Download all three carry 4 and 5. The empty
  module pane explains the order; the chrome shows it.
- **Everything a first-timer reads is bilingual**: the preset row labels
  (Kernel — カーネル and so on), the filter line, the module pane title.
- **Depth and motion, still monochrome**: segmented tabs, cards with soft
  shadows that lift on hover, buttons that respond, rounded corners on one
  radius, quiet scrollbars, visible focus rings. The homepage picked up the
  same tokens — shadows, radii, and step circles that match the app's chips —
  and the screenshots were retaken.
- Fixed in passing: giving buttons `inline-flex` made every hidden button an
  empty pill, because an author `display` beats the browser's `[hidden]` rule.
  A reset now pins `[hidden]` to `display: none`.

### build 2026-08-12h

- **The header no longer renames a button as you switch file tabs.** The
  primary control used to read `Download generated.nix`, then
  `Download configuration.nix`, then `Download flake.nix`, then the archive —
  four meanings in one button — and it hid `Download all three` whenever the
  last tab was chosen. Two download buttons trading places, side by side.
- **`Download all three` is the one download in the header, and it is
  primary.** It is what the five steps end on, so it is the button that looks
  like the way out.
- **Copy and `Download this file` moved to the file tab row**, beside the tabs
  that choose the file they act on. Both stand down on `all three`, where
  there is no single file. Nothing was lost: taking `generated.nix` alone, for
  a machine you configure by hand, is still one click.

### Documentation, 2026-08-12b

- **Dropped the "keep nixgen around" step from both READMEs.** Installing it
  into a profile is not part of getting a machine working, and it pinned a copy
  that then had to be upgraded by hand — the cause of a stale build more than
  once. `nix run github:hatake716/nixgen` stays the one way in.

### build 2026-08-12g

- **Picking NVIDIA sets `nixpkgs.config.allowUnfree = true` with it.** The
  driver is unfree, and the preset's output was the one file that refused to
  build as generated — it builds now, evaluated as a real system. The old
  warning stands down once the switch is actually in the file.
- **Switching GPU cleans up after the previous one.** NVIDIA -> AMD used to
  keep `hardware.nvidia.*` and `videoDrivers = ["nvidia"]` — an NVIDIA
  configuration wearing an AMD label. Only values the preset wrote are
  removed, and the comparison unwraps nullables first, because
  `hardware.nvidia.open = false` is stored wrapped, never matched plain
  `false`, and survived every switch.
- **`allowUnfree` leaves only when nothing else needs it.** vscode, Steam and
  their like are unfree too; a listed one keeps the card, and the status bar
  names which.

### Verification pass, 2026-08-12

A full sweep ahead of calling this stable. **Nothing needed fixing** — the
first pass to end that way. What was checked, so the next pass can repeat it:

- **The golden path, end to end**: every preset (kernel, shell, desktop,
  graphics, language, region, Flatpak) plus a searched package; Check syntax;
  the archive — right three files, build id in the header — and **the whole
  archive evaluated as a NixOS system**. NVIDIA needs the documented
  `allowUnfree` line, which is by design: the warning shows and survives every
  render.
- **The round trip**: the golden module read back in loses nothing — every
  difference is a Nix normalisation, and the result parses.
- **The desktop matrix**: all nine desktops picked in one session, in order.
  Exactly one display manager at every step, no leftovers accumulate, and the
  file parses at the end.
- **Broken input**: a duplicate-attribute file is read, named and collapsed; a
  null input-method type is repaired; malformed API requests answer 400; five
  rapid clicks write one line; removing every card brings the five steps back;
  a configuration.nix import lands on the Setup side and leaves the module
  empty.
- **The visual rules**: no space between Japanese characters (app and
  homepage), all seven dropdowns fit their closed boxes, no sideways scroll
  from 320 to 1800px.
- The fixed harnesses (`fuzz.py`, `import_check.py`, both readers) and the
  flake build.

### Documentation, 2026-08-12

- **The README logo follows the reader's theme.** The artwork is black line
  art, so GitHub's dark theme swallowed it. A white copy now ships beside it
  and `<picture>` picks between them — white on dark, black on light, rather
  than trading one invisible case for the other.
- **The first reason names the desktops**: GNOME, KDE Plasma, Xfce, Cinnamon,
  COSMIC, LXQt, i3, and the two Wayland compositors that arrive with a shell
  already on them — Sway + noctalia and niri + noctalia. Checked against the
  dropdown so the page cannot name one the app does not offer.
- **The homepage and both READMEs now lead with three reasons**, in the order
  that matches what a reader is actually deciding: a desktop that works on the
  first login, Japanese set up all the way through, and nothing changing on
  your machine until you say so.
- The homepage headline is **"From a fresh install to a machine you can use"**,
  and the three reasons sit directly under the hero on their own tinted band —
  the most prominent section on the page.
- Each reason is carried by the specifics behind it: the PATH a shell needs to
  launch anything, the Wayland keyboard layout that is an environment variable
  nothing documents, the privileged endpoint this tool deliberately does not
  have. The option counts stay in the hero as evidence rather than as the
  pitch — they are nixpkgs' numbers, not this tool's achievement.

### build 2026-08-12d

- **Fixed a false alarm on import.** Reading in a file with `nix.settings`
  lines warned "defined inside another card as well" and predicted a failed
  rebuild — for a file that builds fine. The catalogue holds
  `nix.settings.cores` and friends as their own options, so an import always
  produces leaf cards beside the folded `nix.settings` card; that nesting is
  legal Nix as long as no key is in both places, which the old check (paths
  only) never looked at.
- The check now reads the actual key: it warns when the leaf's key really is
  inside the ancestor card — as an object key, or spelled in verbatim source —
  and stays quiet otherwise. Both directions verified in the browser, and the
  once-flagged file evaluated as a real system with every setting landing.

### build 2026-08-12c

- **Sway and niri now set up gnome-keyring.** A compositor has no secret
  service, so anything that stores credentials — browsers first of all — had
  nowhere to put them. The daemon goes in, and PAM opens the keyring with your
  login password, so there is no second prompt.
- **The PAM switch is on the `login` service, not sddm's** — that one turned
  out to be a no-op: the built pam.d/sddm is a single `include login` line.
  Found by building both and reading the files; the generated module was then
  evaluated and pam.d/login carries the three pam_gnome_keyring lines.
- Switching between Sway and niri keeps the pair (exactly once); switching to
  GNOME or Plasma removes it — they wire their own keyring.

### build 2026-08-12b

- **Fixed: `nixos-rebuild` refused the file after re-picking a language on an
  imported module.** Reading a file back in folds a flat
  `environment.sessionVariables.XKB_DEFAULT_LAYOUT = …` line into an attribute
  set on the parent option; picking the language again wrote the flat line
  beside that block, and Nix rejects a leaf defined twice — `attribute …
  already defined`. The previous fix's own output was the file that came back
  in, which is how it reached a real machine.
- Writing a flat card now also takes its key out of any ancestor attribute-set
  card — just that key; the rest of the block, such as a carried
  `NIXOS_OZONE_WL`, stays. The machine's exact flow (import, switch to niri,
  re-pick Japanese) was replayed and the result evaluated at the machine's own
  nixpkgs revision: one definition, and the variable lands in the session
  environment.

### build 2026-08-12a

- **The Desktop dropdown says what you get: `Sway + noctalia` and
  `niri + noctalia`.** Both are confirmed working end to end on a real
  machine — session, shell, terminal, keyboard layout.
- **Hyprland is hidden.** Its generated config owns the keyboard layout, the
  terminal and the warning banner, and overrides what nixgen writes, so a
  working desktop could not be promised from the form alone. Importing a file
  that carries it still works, and switching desktops still cleans its pieces
  up — the preset is hidden, not removed.

### build 2026-08-11z

Two fixes from one sway machine.

- **Fixed: re-picking Sway after importing the old file defined
  `environment.etc."sway/config"` twice** — the imported copy arrives
  flattened, the preset wrote a block, and Nix refuses the pair. The preset
  writes a flat line now (`environment.etc."sway/config".source = …`), which
  merges with anything and reads back in as itself. The recovery path was
  re-tested end to end: import the broken file, pick Sway, and one definition
  comes out, derived from the right sway.
- **Fixed: a Japanese machine logged into sway with a US keyboard.**
  `services.xserver.xkb` never reaches a wlroots compositor; their keymaps
  fall back to the `XKB_DEFAULT_LAYOUT` environment variable (libxkbcommon —
  checked in the library). The language preset now sets it through
  `environment.sessionVariables`, which PAM applies to every login. Confirmed
  by evaluation: the variable lands in the session environment beside the
  user's own entries. Hyprland's own config says `kb_layout = us` and wins
  over the environment — the preset note says to change it there.

### build 2026-08-11y

- **Fixed: sway came up black, with no noctalia.** Yesterday's bar removal
  derived the replacement config from `pkgs.sway` — which is not the sway the
  module installs. Same version, two builds: the module's (`isNixOS = true`)
  keeps the wallpaper and ends with `include /etc/sway/config.d/*`, the line
  that loads the systemd integration noctalia starts from; the plain one is
  patched to have neither. So the replacement had no wallpaper (black screen)
  and no include (no session target, no shell). The nixpkgs patches say so in
  as many words, which is how this was found.
- The file now derives from `config.programs.sway.package`. Verified by
  building it on both the pinned revision and the reporting machine's: the
  include and the wallpaper are back, the bar block is gone, and all 75
  keybindings remain.

### build 2026-08-11x

- **Sway no longer shows two bars.** Its own config ends with a `bar { }` block
  running swaybar with a clock, which sat above noctalia's panel. No option
  turns it off, so the preset replaces `/etc/sway/config` with the package's
  own file minus that block — `environment.etc."sway/config"`, which NixOS sets
  with `mkOptionDefault`, so this overrides rather than collides.
- **Only those 13 lines go.** The result was built and diffed against the
  package's config: the bar block is gone and all 75 keybindings remain,
  `$mod+Return` among them. The card is removed again when you pick another
  desktop.

### build 2026-08-11v

- **The Hyprland preset now explains the warning across the top of the screen.**
  `You're using an autogenerated config! Edit the config file to get rid of
  this message.` is Hyprland's own, not a failure and not noctalia — it writes
  a config into your home on first login and says so until you edit it. No
  NixOS option removes it, so the note says which line to delete
  (`autogenerated = true`) and which keys open the terminal and the runner.
- Read out of the real binary rather than assumed, which also confirmed the
  previous build's change: the config Hyprland embeds sets
  `local terminal = "kitty"`.

### build 2026-08-11u

- **Hyprland takes `kitty` rather than `foot`.** Its default config asks for
  kitty by name, so the terminal keybinding did nothing on a machine that had
  foot instead — found by running it, since the package ships no config file to
  read it out of. niri keeps foot, which works there.
- Switching between the two swaps the terminal and keeps noctalia-shell, since
  the cleanup only removes what the incoming desktop does not also want.

### build 2026-08-11t

- **Fixed: the broken file could not be read back in.** A duplicate attribute
  is a *parse* error in Nix — `nix-instantiate --parse` refuses the file — so
  the importer, which asks Nix to read it, gave up and said only "could not
  read that file". The rest of the file was the user's settings, and refusing
  it left nowhere to recover them from.
- **That one error now falls back to reading the file directly**, and the
  import summary names the attribute that was doubled, in both languages.
  Nothing else falls back: a real syntax error still stops the import, because
  guessing at a broken file is how a generated file goes quietly wrong.
- **Reading it in also resolves it.** The form holds one card per attribute, so
  the two definitions collapse to one — the later of the two, the way a reader
  going down the page would take it — and the file that comes back out builds.
  Confirmed by evaluating it as a NixOS system.
- **Correction to build 2026-08-11r's note**: it said Check syntax could not
  catch the duplicate. It can. The failure is in the parser, not in the
  evaluation, so `Check syntax` would have reported it before the rebuild did.

### build 2026-08-11r

Two from a real machine, one crash and one leftover.

- **Fixed: `attribute 'systemd.user.services.noctalia-shell.after' already
  defined`.** The unit reaches the module in two shapes — an attribute set when
  a preset writes it, one card per leaf when a file is read back in — and
  picking a compositor after an import produced both at once. Nix reads that as
  the same attribute twice. Either shape is now recognised by name, and writing
  one clears the other.
- **Fixed: the previous desktop's packages stayed behind.** Switching from niri
  to GNOME left noctalia-shell, xwayland-satellite and foot installed. They go
  now, and the status bar says which — but only the ones the new desktop does
  not want too, so moving between Hyprland and niri keeps foot.
- **New: a card defined inside another card is reported.** A path that sits
  under another path is the same crash on any option, so `doRender` says so
  before the rebuild does.

### build 2026-08-11q

- **Fixed: the shell started, but nothing launched from it.** A NixOS user
  service is given `PATH=coreutils:findutils:…` and nothing else, so noctalia
  came up and then could not spawn a single application it had listed.
  Reported from a real machine running niri.
- The unit now drops that default and **names its own PATH** — wrappers, the
  per-user profile, the default profile and the current system. nixpkgs' own
  niri module drops the default for exactly this reason, but dropping it is
  only enough where the session left a usable PATH in the user manager, and
  the three do not agree: niri-session imports one, sway imports only
  DISPLAY/WAYLAND_DISPLAY/SWAYSOCK, and Hyprland's `systemd.setPath` is off by
  default above 0.41.2. So it is written out rather than inherited.
- Confirmed by evaluating all three: the coreutils-only PATH is gone and one
  usable PATH is in its place.

### build 2026-08-11p

Sway, niri and Hyprland are usable the moment you log in.

- **noctalia-shell starts with the session.** Each of the three now writes a
  user service bound to `graphical-session.target` — the panel, launcher and
  notifications come up on their own instead of the package sitting unused.
- **All three reach that target**, which is the part that decides whether the
  unit ever runs: sway's default config starts `sway-session.target`, which
  binds to it; niri ships its own units; Hyprland only gets there through UWSM,
  so its preset now sets `programs.hyprland.withUWSM` and names the
  `hyprland-uwsm` session. All three were evaluated with the unit in place.
- **Hyprland and niri also get `foot`.** Neither ships a terminal, so the
  default keybinding opened nothing — read out of evaluated systems, not
  assumed. Sway already brings foot and wmenu; i3 brings xterm and dmenu.
- The unit is written only when the package came back, merges into the card
  rather than replacing it, and comes out again when you switch desktops.

### build 2026-08-11o

- **An input method that is enabled with nothing chosen now gets fcitx5**,
  rather than a warning about a file that will not build. Japanese, Korean and
  Chinese cannot be typed without one, and fcitx5 is the engine those three
  presets already use.
- It runs on the way to writing the file, so every route into that state is
  covered: the search box, both imports, and a card edited back to null. A
  broken `generated.nix` read back in comes out repaired — confirmed by
  evaluating the result at the revision the crash was reported from.
- **It fills a blank only.** A `type` that says ibus is somebody's choice and
  is left alone, which is tested. The status bar says when it filled one.

### build 2026-08-11n

- **Fixed the same crash arriving a third way: `i18n.inputMethod.type = null;`.**
  The option is `null or one of …`, so a file can carry it as an explicit
  null — a line that looks like a decision on the page and is not one. The
  guard added two builds ago asked whether the entry existed, not what it held,
  so a carried-in null walked past it and `nixos-rebuild` failed exactly as
  before. Reported from a real machine, and reproduced by importing such a file.
- The check is on the value now, and the message names both cases (missing or
  null) since somebody looking at their file will see a `type` line and
  reasonably think it is set. Picking a language still fixes it in place.

### build 2026-08-11m

- **The generated file says which nixgen wrote it.** The header now carries the
  build id beside the channel and the date.
- Why it earned a line: the input-method crash was reported a second time, from
  a file a *fixed* nixgen could not have written. Nix caches `github:` for an
  hour and `nix profile install` pins outright, so a fix being in is not the
  same as a fix being what you ran — and nothing in the file said which. Both
  shapes had to be evaluated against the reporter's own nixpkgs revision to
  tell those apart. The header answers it in one glance.
- The value is checked against a fixed pattern before it goes in, since it
  arrives from the client and is written into a file you keep.
- Confirmed while investigating: the current output builds cleanly at the
  revision the report came from, and reading a broken file back in warns.

### build 2026-08-11l

- **Fixed a generated file that could fail to build with `not of type
  'package'`.** The language preset wrote `i18n.inputMethod.enable` and
  `i18n.inputMethod.type` as two independent steps; if the second did not land,
  `enable` stayed on alone, the module pushed a null package into
  `environment.systemPackages`, and `nixos-rebuild` died with an error that
  points at systemd, not at the cause. Reported from a real machine.
- The two are now written as one unit: the input method is chosen first, and
  `enable` is only added when the current interface uses it. A CJK language
  therefore always emits both or neither.
- A `doRender` note is the catch-all: enabling `i18n.inputMethod.enable` from
  the search box, or reading in a file that has it without a type, now says so
  in the status bar before you build.
- Reproduced the crash and confirmed the fix as real NixOS systems.

### build 2026-08-11k

- **Switching desktops swaps the display manager out.** NixOS refuses two at
  once — gdm's module force-disables the others, so a leftover lightdm from the
  previous desktop was a build error (`conflicting definition values`), proven
  by evaluating exactly that. Picking a new desktop now removes the greeters
  that are not its own; sddm takes its Wayland switch with it, and the status
  bar names what came out.
- **The desktops themselves both stay**: two sessions on one login screen is
  legal, and evaluating that state shows both in the session list. Only the
  paths nixgen's own presets write are ever removed — a greeter enabled by hand
  under another name is left alone.

### build 2026-08-11j

- **The input method follows the session now.** fcitx5 has two front ends, and
  the wrong one half-works: with the X11 one on a Wayland session, native apps
  misbehave. Picking a CJK language sets
  `i18n.inputMethod.fcitx5.waylandFrontend` to match the desktop in the module,
  and picking a different desktop later flips the same card — Wayland on for
  GNOME, Plasma, COSMIC, Hyprland, Sway and niri, off for Xfce, Cinnamon, LXQt
  and i3.
- With no desktop picked, nothing is written; choosing one later sets it.
  A language without an input method is untouched.
- **Both directions were evaluated as real systems**: with the Wayland front
  end, `GTK_IM_MODULE` and `QT_IM_MODULE` are gone and apps use the
  text-input protocol; without it, both say `fcitx`.

### build 2026-08-11i

- **Picking a desktop pre-selects it on the login screen.** Every desktop
  preset now sets `services.displayManager.defaultSession` — `gnome`, `xfce`,
  `none+i3` for i3, and so on. Picking a different desktop later updates the
  value in place rather than adding a second line.
- **The names were read out of evaluated systems, not guessed**, because NixOS
  asserts them against the real session list at build time — a wrong name
  fails the build, which was triggered on purpose to confirm. All nine were
  evaluated with the option set.
- **COSMIC sets none, on purpose**: `defaultSession` only speaks to GDM,
  LightDM and SDDM, and COSMIC's own greeter shows its one session anyway.

### build 2026-08-11h

- **The two import buttons swapped places**: Import generated.nix now comes
  first, then Import configuration.nix.

### build 2026-08-11g

A debugging pass over the whole app. Two fixes; everything else held.

- **Fixed: importing a configuration.nix with a `let` binding gave no warning.**
  nixgen carries a value that is an expression exactly as written, but the
  `let` it might lean on is not carried — so a line that referenced one now
  references an undefined variable, and Check syntax said so with no
  explanation. The import summary now warns in advance, listing which values
  are expressions.
- **Fixed: a Check syntax error always named `generated.nix`.** Checking
  `configuration.nix` reported the fault against the wrong file; it names the
  file you are actually looking at now. The name is checked against a fixed set
  before it goes into the message.
- Verified and found sound: the full round trip (build → archive → read both
  files back), a channel switch with settings in the form, importing a file
  full of quoted paths, negatives, `mkIf`, non-ASCII names and dotted packages,
  rapid preset clicks, removing every card, the index-deletion path (refuses
  the in-use DB, path-like names, and channels still offered), and the System
  update command across odd host names. No crash, no console error, no 4xx in
  ordinary use.

### build 2026-08-11e

Documentation, rewritten for somebody's first time.

- **The README's install section now runs all the way through**: turn on
  flakes, start nixgen, build the configuration in the browser — a concrete
  first run, field by field — put the files on the machine, rebuild. The old
  step 4 still described the one-file, edit-imports-by-hand path from before
  **Download all three** existed; that path is still there, but as the variant
  for machines you configure by hand, not the default.
- **The five steps in the app are one action each now.** The file tree moved
  from step 1 to step 5 — it shows where files end up, and step 5 is where
  files end up. Step 2 leads with the dropdowns, which is where a first-timer
  should start.
- **The homepage section is a complete path on its own**: what to run first,
  the five steps, and the three commands that apply the result. Both
  languages, with links into the README for the long version.

### build 2026-08-11d

- **The homepage masthead is the logo itself now**, not a drawing of it. It is
  50 pixels tall because that is where the detail holds together on a screen
  that is not HiDPI — at 26 the flake is a smudge and at 40 it is still noisy,
  which was rendered at 1× and 2× and looked at.
- The app's header still carries the plain flake: it is 22 pixels there, and
  nothing makes that artwork readable at 22.

### build 2026-08-11c

- **The logo itself is in the app, on the homepage and at the top of both
  READMEs** — trimmed, on a transparent ground, 9.6 KB. The app serves it at
  `/logo.png` and opens with it above the five steps; the homepage hero is the
  artwork rather than a drawing of it.
- **The header and the favicon keep the plain flake**, and that is measured
  rather than preferred: the artwork rendered at 48 pixels is grey mush, and
  the header shows a mark at 22. The two are the same motif at two levels of
  detail, which is what a logo used at both sizes needs.

### build 2026-08-11b

- **The mark is in the app and on the homepage**, and the palette follows it:
  the snowflake with its hexagon core sits beside the wordmark in both
  headers, and the same drawing is the favicon.
- **The blue is gone.** The logo is black on white, so the accent is ink now —
  the primary button, the selected tab, the chips. A search hit used to be
  blue text and is a tinted ground instead, which is what a monochrome scheme
  has to do to keep it visible.
- **Two forms of one drawing.** The homepage hero carries the full mark, arcs
  and scattered shapes and all; the headers and the favicon carry the plain
  flake with a heavier stroke. The full one at 22 pixels is a smudge — that
  was rendered and looked at rather than guessed.
- `tools/mark.py` draws both. Six arms drawn by hand are six slightly
  different arms, and a mark pasted into two pages and a favicon is one that
  drifts between them; this is the same argument as `tools/shots.py`.

### build 2026-08-11a

- **XWayland goes on with the three Wayland compositors**, so X11 applications
  still run. Hyprland and Sway have an option for it and nixgen sets it — it is
  their default as well, and having the card there means the file says which
  way it is set rather than leaving it to be assumed.
- **niri has no such option**, because it does not carry XWayland at all:
  `xwayland-satellite` goes in as a package instead. Installing it is as far as
  a configuration file reaches — **your niri config has to spawn it**, and the
  status bar says so.
- Evaluated at the indexed revision: `xwayland-24.1.13` in the Hyprland and
  Sway systems, `xwayland-satellite-0.8.1` in the niri one.

### build 2026-08-10z

- **There are two imports now, one per file.** **Import configuration.nix**
  reads your machine's own file into the `configuration.nix` nixgen writes —
  the Setup fields take what they hold, the `imports` list is merged, and
  everything else is copied into that same file under a comment saying where it
  came from. The module is left alone.
- **Import generated.nix** is the other direction: a module read back into the
  module, which is where it came from. That is the round trip for a form lost
  by closing the tab.
- Before this, reading a `configuration.nix` filled the *module* with it —
  which worked, and put your file in the wrong one of the two.
- Carried lines are on the list the red "also in configuration.nix" markers
  read, so adding one of them under **Options** afterwards says so rather than
  quietly defining it twice.

### build 2026-08-10x

- **A System update button**, last in the header and the only one that changes
  the machine. Three confirmations, one per step: a summary in the browser
  before the archive downloads, then the command asks before it overwrites
  `/etc/nixos` and again before `nixos-rebuild switch`.
- **It hands over a command rather than doing the work.** nixgen's server has
  no authentication, and an endpoint that could overwrite `/etc/nixos` and
  rebuild would be reachable from any page open in the same browser. The
  command is copied to the clipboard.
- **The download folder is found, not assumed** — `xdg-user-dir` first, then
  `Downloads` and `ダウンロード`, then the home directory. Tried from bash, zsh
  and fish, because a block of shell that pastes into one does not always paste
  into the others.
- **What it replaces is kept**: `configuration.nix.~1~` and so on stay beside
  the new files. `hardware-configuration.nix` is not in the archive and the
  command does not name it — checked by running the whole thing against a
  stand-in directory.
- The five steps now carry a box saying to finish everything and run **Check
  syntax** first, since this replaces the configuration the machine boots from.

### build 2026-08-10w

- **Hyprland, Sway and niri now come with a login screen.** sddm goes in with
  them, and so does `services.displayManager.sddm.wayland.enable` — pick one of
  the three and the machine boots to a greeter with that compositor in the
  session list, rather than to a text console.
- **That second option is the point, and the two configs were built to check
  it.** With it, sddm's own config says `DisplayServer=wayland` and the greeter
  runs under weston. Without it, `DisplayServer=x11` — an X11 login screen in
  front of a machine that has no X server for anything else.
- Still no `services.xserver.enable`: nothing else on those systems wants one.
  Evaluated as actual NixOS systems — the display manager is on, X is off, and
  the session list holds `hyprland-0.55.4`, `sway-1.12` or `niri-26.04`.
- Starting from a text console or using `greetd` instead is two cards to
  delete, and the status bar says which.

### build 2026-08-10v

- **Hyprland and Sway install `noctalia-shell` too**, the way niri does — all
  three are compositors and nothing else, and noctalia is what puts a panel, a
  launcher and notifications on top. The other six desktops bring their own and
  get nothing extra.
- Both evaluated as actual NixOS systems at the indexed revision:
  `noctalia-shell-4.7.6` alongside `hyprland-0.55.4` and `sway-1.12`.

### build 2026-08-10u

- **Picking niri installs `noctalia-shell` with it.** niri is a compositor and
  nothing else — no panel, no launcher, no notifications — and noctalia is what
  puts those on top. It is a package rather than a setting, since nothing in
  the option catalogue mentions it, so it lands in
  `environment.systemPackages` as a line you can see and delete.
- The name is looked up in the package index first, like everything in the app
  categories: on a channel without it, nothing is written rather than a line
  that fails at `nixos-rebuild`.
- Evaluated as an actual NixOS system: `niri-26.04` as the session,
  `noctalia-shell-4.7.6` in the system packages.

### build 2026-08-10t

- **A Shell dropdown**, between Kernel and Desktop: bash, zsh or fish.
- **It writes two settings, and the second is the one people forget.**
  `users.defaultUserShell` alone gives every account a shell that is not in
  `/etc/shells` and has no completions — `programs.zsh.enable` and
  `programs.fish.enable` are what register it. Both were evaluated as real
  systems: with the module, `zsh` and `fish` are in `environment.shells`;
  without it, that list still holds only bash and sh while the user's shell has
  already changed.
- bash gets `pkgs.bashInteractive`, not `pkgs.bash` — the second is the build
  without readline. `users.defaultUserShell` is `absolute path or package`, so
  what is written is Nix source in an editable box, the way the kernel is.
- The status bar says what the setting covers: **every normal account**, not
  one user.

### build 2026-08-10s

- **niri too** — a scrollable-tiling Wayland compositor. Ten desktops now, and
  like Hyprland and Sway it is one option and no greeter.
- Its module brings its own portals, so Flatpak and screen sharing work without
  the Flatpak row's GTK one. **X11 applications need `xwayland-satellite`**,
  which is a package rather than a setting — the status bar says so, since no
  option in the form covers it.
- Evaluated as an actual NixOS system at the indexed revision: the session comes
  out as `niri-26.04`.

### build 2026-08-10r

- **Four more in the Desktop dropdown**: LXQt, Hyprland, Sway and i3. Nine now.
- **LXQt** is the familiar three — X, sddm, the desktop — and like `xfce` and
  `cinnamon` it never left `services.xserver`. **i3** is the same three with a
  window manager in the third place, and nothing about what a tiling setup
  should look like: it comes up empty and offers to write you a config.
- **Hyprland and Sway are one option each, and get no greeter.** Neither ships
  one, and choosing sddm or greetd for somebody is a decision about how their
  machine starts rather than a setting the compositor needs — so the status bar
  says what to do instead of the form deciding.
- All four evaluated as actual NixOS systems at the indexed revision, and each
  registers the session it should: `lxqt-xsession`, `hyprland-0.55.4`,
  `sway-1.12`, `none+i3-xsession`.

### build 2026-08-10q

- **A Flatpak row under Options.** No dropdown — Flatpak is on or it is not —
  and pressing **Add** puts in `services.flatpak.enable`, `xdg.portal.enable`
  and `xdg-desktop-portal-gtk` under `xdg.portal.extraPortals`.
- **The portal is the part people miss.** A Flatpak application reaches the
  rest of the system through an xdg portal, so `services.flatpak.enable` on its
  own gives you applications with no file dialog and no screen sharing. GNOME
  and Plasma bring their own backend, so there the GTK one is a spare and the
  card can be deleted.
- **And one step no option covers**: a fresh install has no remote, so the
  status bar prints the `flatpak remote-add … flathub` line to run once after
  the rebuild.
- Evaluated as an actual NixOS system at the indexed revision: flatpak in the
  systemd packages, the portal enabled, `xdg-desktop-portal-gtk` in the list.

### build 2026-08-10p

- **Three more packages**, 189 across 12 categories: `localsend` under Chat and
  sync (the same job as `warpinator`, across more kinds of machine),
  `virtualbox` under System tools, and `tradingview` under Office, which is
  **unfree** and says so.
- **`virtualbox` as a package cannot start a virtual machine**, so adding it
  says where the rest is: `virtualisation.virtualbox.host.enable` under
  **Options** is what builds the kernel modules and puts you in the
  `vboxusers` group. Like the note about Steam, it is regenerated on every
  render rather than said once and wiped.
- That note, and Steam's, now read the package list the same way the greyed
  rows do — so they appear for a list that came in verbatim as well.

### build 2026-08-10o

- **Every message the app writes says it in both languages** — the notices
  above the module and the status bar under the file. English first, the
  Japanese on the line under it: these are sentences, so they go one above the
  other rather than sharing a line the way the dropdown options do.
- **What the Nix parser says stays in its own words.** A failed **Check
  syntax** is introduced in both languages and then quotes the parser — those
  are Nix's words, and somebody searching the web for the error needs the text
  it actually prints.

### build 2026-08-10n

- **The presets ask for every spelling at once and get back the ones that
  exist**, the way the app categories already ask about packages. Adding a
  desktop used to try each candidate in turn, so a name this release does not
  use — `services.displayManager.lightdm.enable` on 26.05 — came back 404 and
  put a failure in the browser console for something that is not one.
  **Nothing in the app answers 404 during ordinary use now**, which makes the
  console worth reading again.
- The winner is used as it arrives rather than asked for a second time.

### build 2026-08-10m

Another pass over the whole app, driving it rather than reading it.

- **Fixed: reading a file in while the Setup tab was open threw.** Everything
  that changes the module repaints the result list, and on that tab the search
  asked for `kind=setup`, which the server answers with options — which then
  went through the package painter. It used to paint nothing anybody could see;
  once the painter started reading `attr` for the icon it threw instead, and
  took the rest of the import with it.
- **Fixed: a list of packages asked for an icon it knew nothing about.** Every
  package without one produced a 404 — 128 of them for a single search, a
  console full of failures that are not failures. Each row now says whether an
  icon exists and the page only asks for the ones that do.
- **Fixed: several threads built the icon index at once.** The first list asks
  for a row of icons together and the server is threaded, so half a dozen of
  them walked the icon directories to build the same map.
- Everything else was re-run: the presets on both channels, importing on top of
  a filled form, the archive against what is on screen, a failed render, a
  failed boot, 16 malformed requests, and the layout from 320 to 1800 pixels.

### build 2026-08-10k

- **A package already in `environment.systemPackages` is greyed in the list**,
  in the categories and in search results alike — the same as an option you
  have already added. **Clicking it takes you to the card it is in** rather
  than doing nothing.
- It reads the module rather than remembering what was clicked, so a package
  removed from the card, or typed into the box by hand, changes the list the
  same way. A list that came in verbatim counts too: `with pkgs; [ ripgrep ]`
  and `pkgs.ripgrep` are the same package written two ways.
- **Fixed: adding the first package from a category threw the category away.**
  Adding it repaints the list, and repainting only knew about the search box —
  so picking Games and clicking Steam left you looking at an unrelated listing.

### build 2026-08-10j

- **`ollama` is in the Development category**, next to `lmstudio` — the same
  job from the command line, and this one is not unfree. 186 packages across 12
  categories.
- **`ollama`, not `ollama-cuda` or `ollama-rocm`.** Which accelerator a machine
  has is the kind of thing this list stays out of, and the plain build runs
  everywhere. There is also a `services.ollama.enable` under **Options** for
  running it as a system service.

### build 2026-08-10i

- **`lmstudio` is in the Development category** — a desktop app for running
  language models locally. 185 packages across 12 categories.
- It is **unfree**, so its row says so and the status bar repeats it: without
  `nixpkgs.config.allowUnfree = true;` the build refuses it. No icon theme here
  carries one for it, so it takes the letter tile — which is the fallback doing
  its job rather than something missing.

### build 2026-08-10h

- **`vscode` is in the Development category**, next to `vscodium`. 184 packages
  across 12 categories, 143 of them with an icon here.
- They are the same editor: `vscodium` is built from the same source without
  Microsoft's branding and telemetry, `vscode` is Microsoft's own build and is
  **unfree** — its row says so and the status bar says it again, because
  without `nixpkgs.config.allowUnfree = true;` the build refuses it.

### build 2026-08-10g

- **Packages have their icons in the list now**, in the categories and in
  search results alike.
- **They come from the icon themes your machine already has** — the system
  path, your profile, `XDG_DATA_DIRS`. Nothing is downloaded and nixgen depends
  on nothing new. The catch is stated rather than hidden: **how many appear
  depends on what is installed.** 142 of the 183 listed packages have one on
  the author's machine; a bare install will show far fewer.
- **Anything without an icon gets its first letter** on a colour derived from
  its name, so a row is never an empty square and a package keeps the same
  colour every time you look for it. `tmux` and `gcc` have no icon anywhere,
  and pretending otherwise would just mean a grey square repeated.

### build 2026-08-10f

- **Reading in a configuration.nix fills the Setup tab.** The host name, the
  user account and its groups, the architecture, the boot loader and its GRUB
  disk, NetworkManager, whether flakes are on, and `system.stateVersion` — all
  of them come from the file you just read, instead of the tab still describing
  a machine called `nixos`.
- **Those settings move rather than being copied.** They are fields on that tab
  and the starter `configuration.nix` is what writes them, so leaving cards
  behind as well would put the same attribute in both files. The import summary
  lists exactly which ones went, and everything else stays in the module.
- Two shapes had to be read rather than assumed: `nixpkgs.hostPlatform` is a
  union, so its value arrives as Nix source with the quotes still on it, and
  flakes live inside `nix.settings`, which is one attrs option holding a line of
  source per key. **That card only moves when experimental-features is all it
  holds** — nobody's substituters belong on a Setup tab, and taking the option
  to get at one key beside them would take them too.

### build 2026-08-10e

Five defects, found by driving the app rather than by reading it. The first two
handed over a file that was not what the screen said.

- **A download could be one edit behind.** Rendering is debounced and happens on
  the server, so for a moment after a keystroke the file on hand is the previous
  one. Typing a host name and pressing **Download all three** straight away was
  enough to get an archive that did not match the screen. Both downloads, Copy
  and Check syntax now wait for the render the keystroke asked for.
- **A failed render used to be invisible.** If `/api/render` failed, the pane
  kept showing the last file that worked and every button would still hand it
  over. Now it says so and hands over nothing until a render succeeds.
- **Reading a file into a form that already had settings produced a file NixOS
  refuses.** Two cards for one attribute is `error: attribute
  'services.openssh.enable' already defined`, and **reading the same file twice
  was enough to get there.** What the file says replaces what was there, and the
  summary lists what it replaced. A second guard reports any duplicate that
  turns up another way, on every render.
- **A failed request while the page was loading left an empty screen.** The
  Setup pane is unhidden at the end of the boot sequence, so one failed fetch —
  the server still starting, an index being swapped — meant a blank column and
  no explanation. It says what happened and to reload.
- **A malformed request dropped the connection.** A body that is not JSON, or a
  field of the wrong shape, reached the handler and raised; the terminal got a
  traceback and the browser got nothing. Those get a 400 and a message now. An
  archive can no longer be built from starter files that are not there either.

### Documentation, 2026-08-10

- **The README walks through the app in the order you use it.** The sections
  were grouped by subject, so the starter files came after the dropdowns and
  the app opens on the tab the README described eighth. They are named for the
  tab they belong to now — Setup, Options, Packages, Check syntax, Download all
  three — and they run in that order.
- **The homepage leads with the same five steps**, right after the first
  screenshot, in both languages.
- **35 visible gaps in the homepage's Japanese are gone.** A line break between
  two Japanese characters is whitespace and the browser draws it as a space, and
  the page had been wrapped like English prose since it was written. Only
  rendering the page shows this; the source looks fine.

### build 2026-08-10c

- **The five steps are the order to work in now**: Setup, then Options, then
  Packages, then **Check syntax**, then **Download all three**. They were
  grouped by subject before, with importing an existing file as a step of its
  own in the middle, and that left the first question anybody has unanswered —
  which of these do I do first.
- **Checking has a step of its own**, between adding things and taking them
  away. It was a footnote under the list, which is not where a step belongs.
- The lede says the same thing in one line, for anyone who reads no further,
  and the note underneath says you can still go back to any tab whenever you
  like.

### build 2026-08-10b

- **Cinnamon's and COSMIC's own apps are in the categories now** — 19 more,
  183 across 12. Read out of evaluated systems the same way the other three
  were: what each desktop adds over a bare one, minus the session, the themes
  and the services.
- Cinnamon brings `xreader`, `xviewer`, `pix`, `celluloid`, `warpinator`,
  `bulky`, `gucharmap`, `onboard`, `blueman`, `inxi`, `gnome-terminal` and
  `gnome-screenshot`; COSMIC brings `cosmic-files`, `cosmic-term`,
  `cosmic-edit`, `cosmic-player`, `cosmic-reader` and `cosmic-screenshot`.
  Those six run outside COSMIC, which is the whole point of the list.
- **`cosmic-settings` and `cosmic-launcher` are not there**, and neither are
  the mint themes: they are nothing without the desktop they belong to.
  `nemo-with-extensions` and `evolutionWithPlugins` were dropped for a duller
  reason — the catalogue has no description or version for either wrapper, so
  they would arrive as blank rows, and `nemo` and `evolution` are already here.

### build 2026-08-10a

- **Cinnamon and COSMIC in the Desktop dropdown**, alongside GNOME, Plasma and
  Xfce. Cinnamon is the X server, lightdm and the desktop — and like `xfce`,
  `cinnamon` has not moved out of `services.xserver`.
- **COSMIC is two settings rather than three.** It is Wayland, so there is no X
  server to turn on, and it brings its own greeter. Adding `services.xserver`
  for it would build an X server nothing runs.
- Both were evaluated as actual NixOS systems at the indexed revision:
  `cinnamon-6.6.8` and `cosmic-session-1.2.0` come out as the session, and
  both carry the CJK and emoji fonts the language preset counts on — checked
  rather than assumed, since that claim was made about the other three.
- The app categories still hold what GNOME, Plasma and Xfce ship. Working out
  what these two add means evaluating them the same way, and that has not been
  done yet.

### build 2026-08-09z

- **A Download all three button in the header**, beside the download that
  follows the file tabs. Same archive as the `all three` tab, without going to
  that tab first. It steps aside while that tab is open, where the button next
  to it already says the same thing.

### build 2026-08-09y

- **A fourth file tab, `all three`**, whose Download button hands you
  `configuration.nix`, `flake.nix` and `generated.nix` as one `.tar.gz`, in a
  directory named after the host so extracting it cannot land on top of a
  `configuration.nix` already sitting where you unpacked it.
- **`.tar.gz` and not `.zip`** because of who is on the other end: a NixOS
  install has `tar` and `gzip` and does not have `unzip`.
- **Check syntax on that tab parses all three** and names the one that failed.
- The archive is byte-for-byte the same for the same three files — fixed
  mtimes and modes — so two downloads differ only where the contents do.
- `hardware-configuration.nix` is not in it, and the tab says so. That file
  describes the machine's disks and nixgen has never written it.

### build 2026-08-09x

- **The Kernel dropdown is gone from the Packages tab**, where it had no
  business being and read as a second copy of the one under Options. The row
  was added last build but never added to the list of rows the tab switch
  hides, so it stayed on screen on every tab. That list is one rule over
  `.presetline` now, so the next row cannot be left off it.

### build 2026-08-09w

- **The four dropdowns under Options are in build order now**: kernel, desktop,
  graphics, language — the part everything else runs on first, and outwards
  from there. Both READMEs were resequenced to match, so the reading order and
  the screen order are the same again.

### build 2026-08-09v

- **A Kernel dropdown under Options**: standard, latest, LTS or Zen. It writes
  `boot.kernelPackages`, a raw option, so the expression lands in a box you can
  edit rather than being hidden in a preset.
- **The name is looked up before it is written**, and the status line says
  which version it found — `LTS` reports `linux 6.12.102` rather than leaving
  the series to guesswork. **nixpkgs has no `linuxPackages_lts`**; LTS is a
  list of series, newest first, and the first one the channel still ships is
  what comes out.
- All four were evaluated as actual NixOS systems at the indexed revision, not
  just parsed: four different kernels, four different system derivations.

### build 2026-08-09u

- **"How this works" is in both languages**: the English five steps, then the
  same five in Japanese below them. Written, not translated — the steps name
  the tabs and buttons, and a machine translation of them names things that are
  not on any tab or button.
- **The buttons in the header wrap on a narrow screen.** Four of them in a row
  are wider than a phone, and a flex row that cannot wrap will not go narrower
  than its contents, so the whole page scrolled sideways instead. Checked at
  320, 375, 768, 1280 and 1800 pixels; none of them scrolls sideways now.

### build 2026-08-09t

- **Every dropdown carries its Japanese now**, not just the app categories:
  the channel, what `flake.nix` points at, the boot loader, the languages and
  the two `choose…` placeholders. All of them are marked so a translator leaves
  them alone, and all of them remember their own text, because the guard that
  covers option paths has to cover the words a choice is made from too.
- **The labels are cut to fit the closed box.** A select shows what fits and
  drops the rest, and the rest was the Japanese half — the half a translated
  page is reading. "the commit it was indexed at" became "the commit", the
  unstable channel says "(daily)", and the category list, which had no room to
  spare, was given the whole line instead. Measured rather than eyeballed: all
  40 labels now fit the box they are shown in.

### build 2026-08-09r

- **The category names carry their own Japanese**: `Audio and video —
  マルチメディア`, and so on down the list. Names of kinds of software are what
  machine translation is worst at — that one was coming back as "music and
  video" for a category holding audacity and pavucontrol — so they are written
  out in both languages and marked so a translator leaves them alone.

### build 2026-08-09q

- **The apps GNOME, Plasma and Xfce ship are in the categories now** — 151
  packages across 12. Not so they get installed twice: enabling a desktop
  already brings its own. So that you can take one without the desktop it
  belongs to, which is the usual reason to want `gwenview` on Xfce or
  `gnome-calculator` on Plasma.
- Which apps those are was read out of three evaluated systems rather than
  recalled: what each desktop adds over a bare one, minus the session and
  theme plumbing. That is also how `kwrite` got left out — nixpkgs ships it
  inside `kate`, so there is no attribute to offer.

### build 2026-08-09p

- **A graphics dropdown next to the desktop and language ones**: AMD, Intel or
  NVIDIA. Each turns on `hardware.graphics` and its 32-bit half, which is what
  Steam and wine need, and then does only what that card actually requires.
- **Intel** also gets a VAAPI driver, because hardware video decoding does not
  work without one. **AMD** gets nothing further — mesa already carries what it
  needs. **NVIDIA** names its X driver, turns on modesetting, and sets
  `hardware.nvidia.open = false`, the proprietary kernel module, which works on
  every card the driver supports.
- **`services.xserver.videoDrivers` is set for NVIDIA only.** That is not an
  oversight: the default is `modesetting`, which is right for AMD and Intel on
  any current kernel, and forcing the amdgpu X driver instead has no upside.
- **Choosing NVIDIA now says the driver is unfree**, and keeps saying it. The
  existing reminder only watches `environment.systemPackages`, and this arrives
  through a module — without `allowUnfree` the build refuses outright.

### build 2026-08-09o

- **The app categories grew, from a real configuration rather than a guess.**
  121 packages across 12 categories now, including a **Chat and sync** one for
  the things that had nowhere to go.
- What went in: the Xfce suite (parole, ristretto, catfish, gigolo,
  xfce4-screenshooter, orage, xfburn), video work (davinci-resolve,
  gpu-screen-recorder-gtk, ffmpeg-full), gaming around Steam (protonup-qt,
  goverlay, steam-run, moonlight-qt), hardware tools (lm_sensors, lshw,
  pciutils, solaar, piper), remote access (remmina, virt-viewer), compilers
  and language servers, obsidian, freecad, gimp-with-plugins.
- What stayed out: anything tied to one machine. AMD GPU tooling, ROCm,
  microcode, panel plugins and hand-written `callPackage` expressions belong
  in somebody's configuration, not in a list offered to everyone.
- The `xfce.*` rename bites again — parole, ristretto, catfish, gigolo, orage,
  xfburn and xfce4-screenshooter are all under `xfce.` on 25.11 and at the top
  level on 26.05. Both spellings are listed.

### build 2026-08-09n

- **Pick a language and the language is set up.** English, Japanese, French,
  German, Spanish, Korean or Chinese, next to the desktop dropdown. Each adds
  the locale, the keymap the console uses and the layout X uses — and for
  Japanese, Korean and Chinese an input method as well, since none of the
  three can be typed without one.
- Fonts are not among them and do not need to be: GNOME, Plasma and Xfce all
  bring the CJK and emoji fonts already. Nor is the time zone — a language is
  not a place, and guessing one from the other would be wrong more often than
  right.
- **Three more app categories**: accessories, file managers and terminals.
- A note on the names again: the `xfce.*` packages moved to the top level
  between 25.11 and 26.05, `dolphin`, `konsole` and `kcalc` live under
  `kdePackages`. Both spellings are listed, and only the one your channel has
  is offered.

### build 2026-08-09m

- **Google Chrome joins the browsers, Steam joins the games.** Both are unfree,
  so both come with the reminder to set
  `nixpkgs.config.allowUnfree = true;` — without it the build refuses outright.
- **Picking Steam now says what the better way is** rather than leaving it out
  of the list. It runs from the package, but `programs.steam.enable` under
  **Options** is what puts the 32-bit graphics drivers in place and can open
  the remote-play ports. Leaving it out only sent people looking for it.

### build 2026-08-09l

- **A "common apps" dropdown on the Packages tab**, for when you know the kind
  of thing you want but not what it is called here: browsers, mail, office,
  audio and video, graphics, games, system tools, development. Picking a
  category fills the results list, so adding one is the same click as any
  search hit — **nothing is installed on your behalf.**
- It is a short pick and says so. This is the one place where somebody's taste
  decides what you are shown, so it stays small and the search box remains the
  way to find everything else.
- Every name was checked against the catalogue, which is not a formality:
  `kdenlive` is `kdePackages.kdenlive`, `0ad` is `zeroad`, and `superTuxKart`
  became `supertuxkart` between 25.11 and 26.05. A name the channel does not
  have simply does not appear.

### build 2026-08-09k

- **Pick a desktop from a dropdown.** GNOME, KDE Plasma or Xfce, on the
  **Options** tab. Each adds the three settings the NixOS manual lists for it,
  as ordinary options you can then read, change or remove — nothing goes into
  a file you cannot see.
- The names are worth the shortcut on their own: `gdm` and `sddm` have moved
  out of `services.xserver`, **`lightdm` has not**; `gnome` and `plasma6` have
  moved out, **`xfce` has not**; `plasma5` is gone. Nobody is going to guess
  that, so each part is looked up in the catalogue rather than hard-coded, and
  whichever name this channel actually has is the one that gets used.

### build 2026-08-09j

- **The panel now says what to do about losing your work.** Nothing is kept
  between visits, so `generated.nix` is the save file: download it and
  **Import configuration.nix** brings those settings back as they were. That
  was always true and was written down nowhere.
- **The checks run on every push now.** `tools/fuzz.py` and
  `tools/import_check.py` were two good harnesses that only ran when somebody
  remembered — the same way the screenshots went three features out of date.
  Everything goes through `nix develop`, so CI and the checklist are the same
  commands. `nodejs` joins the dev shell, since the checklist has always said
  `node --check` and the shell did not have it.

### build 2026-08-09i

- **The first step now draws where the files go.** "Starter files for a new
  machine" was one sentence; it is now the two files Setup fills in, what each
  one is for, and a listing of the four that end up side by side in
  `/etc/nixos`. Which reads them in what order is said too, since that is the
  part prose kept failing to convey.
- **Fixed: a wide line pushed the whole page sideways on a narrow screen.** The
  single-column layout let a track grow to fit its content rather than scroll
  inside it. Latent until something wide turned up, which the listing did.

### build 2026-08-09h

- **Five steps now sit in the middle of the screen when you open it**, which
  had been an empty panel saying "nothing set yet". They cover the whole
  shape of the thing: the starter files, reading in a configuration you
  already have, adding a setting, adding software, and what to do with the
  file afterwards. Adding anything replaces them with it, so there is nothing
  to dismiss and nothing to remember.

### build 2026-08-09g

- **The import summary is back above the settings.** After reading a file in,
  the part that says an option no longer exists in this release — the one thing
  `nixos-rebuild` refuses outright — had ended up under a screen or two of
  cards. `environment.systemPackages` still sits at the top of the column the
  rest of the time; both fit now.

### Documentation

- **The screenshots are current again.** They had gone three features out of
  date — no channel selector, no choice of what `flake.nix` points at, no line
  saying how old the option list is. Retaking them is a command now
  (`tools/shots.py`, which drives the real app), so they should stop drifting.

### build 2026-08-09f

- **A real message when port 8823 is taken**, instead of a Python traceback. It
  also says the thing that is usually true: the port is held by an older nixgen,
  and the build id in the header will tell you. It no longer prints "serving …"
  and opens a browser before finding out it could not listen — which sent you
  to the old copy and looked like the new one had started.
- **The Setup tab offers to remove indexes for channels that are no longer on
  the list.** They are about 37 MB each, nothing else would ever remove them,
  and until now nothing said they were there. Only indexes nixgen made itself,
  never the one in use, never a channel you could still pick.

### build 2026-08-09e

- **`nixos-unstable` can be picked, alongside the numbered releases.** Choosing
  it makes **everything** unstable: the options, the packages, the `flake.nix`
  and the `system.stateVersion`. There is no mixing — taking packages from one
  channel and options from another is not supported and is not planned.
- **The Setup tab says when the option list was published, and offers to
  rebuild it once that stops being true.** The next day on unstable, after some
  weeks on a numbered release. The date is the channel's own, not when the
  download happened. An option list nobody knows the age of is the reason
  unstable went unsupported for so long.
- **`system.stateVersion` follows the channel.** `nixos-unstable` has no number
  in its name, so it is read out of the catalogue instead — 26.11 today. Typing
  in the box stops it following.
- The field is now labelled **nixpkgs channel** rather than release, because
  one of the things in it is not a release.

### build 2026-08-09d

- **What `flake.nix` points at now defaults to the release branch.** It shipped
  defaulting to the commit, which is the more correct of the two — it is the
  only setting under which the options you were offered and the system you
  build are the same tree — but a default that never moves is a system that
  never picks up a security update unless you know to go and change it. The
  commit is still one click away, and the note beside the dropdown still says
  which is which.

### build 2026-08-09c

A harness for the importer, and the six things it found on its first run. It
reads configurations back in through **both readers** — Nix's parser and the
fallback used when Nix is not on PATH — because they fail differently, and
three of these six showed up in only one of the two.

- **Fixed: a setting that applied cleanly and did nothing.**
  `boot.kernel.sysctl."net.core.rmem_max"` was split on the dots inside the
  quotes, so it was written to a different attribute. The file parsed,
  `nixos-rebuild` accepted it, and the setting simply never took effect. 76
  options are named this way.
- **Fixed: non-ASCII text came back as mojibake.** `日本語` and `Grüße` were
  mangled on import — the unescaper read UTF-8 bytes as if they were latin-1.
- **Fixed: a package list that was empty could not be added to.** An empty
  `environment.systemPackages = [ ]` was read as an expression rather than an
  empty list, so there was nowhere to put anything.
- **Fixed: `services.foo.nice = -5` came back as `__sub 0 5`.** Nix has no
  negative literal and that is how its parser writes one. Correct, and
  unrecognisable as the line you wrote.
- **Fixed: a package name with a quoted part broke the list it was in.**
  `rubyPackages."http_parser.rb"` was cut in two when the list was sorted,
  leaving `rubyPackages.` behind.

### build 2026-08-09b

- **Fixed: a package whose name has a dot in it produced a broken file.**
  Picking `python313Packages.requests` or `CuboCore.coreaction` from search wrote
  it without the `pkgs.` in front, so `nixos-rebuild` stopped at
  `error: undefined variable 'python313Packages'`. **83% of the catalogue has a
  dot in its name** — every `python3Packages.*`, `haskellPackages.*`,
  `aspellDicts.*` and the rest. The common ones do not (`firefox`, `git`,
  `ripgrep`), which is why it went unnoticed.
- **Fixed: reading a config turned those same packages into text you could not
  edit.** Nix's parser hands `python313Packages.requests` back as
  `((python313Packages).requests)`, which the reader did not recognise, so the
  whole list was carried over verbatim instead of becoming a form field. One
  such package was enough to do it to the entire list.
- **Fixed: a negative number inside a list lost its brackets when carried
  over**, on a machine without `nix-instantiate`. `[ (-1) ]` parses and
  `[ -1 ]` does not, so the file failed with `syntax error, unexpected '-'`.
- **The generated `flake.nix` names a commit, not a branch.** It pins the exact
  nixpkgs revision the option index was built from, so the system you build has
  the options the form offered you rather than whatever the branch has moved to
  since. The Setup tab shows which commit.
- **Which of the two it names is a choice** — *What flake.nix points at*, next
  to the release. Pick the branch and it behaves as it did before: `flake.lock`
  pins your first build and `nix flake update` moves it on.
- If a release has no index on this machine yet, the commit is asked of the
  channel server instead. That still pins the build, but it says nothing about
  where the option list came from — the generated file spells out which of the
  four cases produced it rather than leaving them to look alike.
- `fetch-data.sh` now records the channel's `git-revision`, and `build_index.py`
  keeps it in the database. An index built before this release simply does not
  have one; asking for a commit then says so on screen rather than quietly
  handing back a branch.

### Documentation

- **Documented why `nix run github:…` can start an old build.** Nix caches a
  `github:` reference for an hour, and `nix profile install` pins one outright.
  Neither is a bug; both look exactly like a fix that did not work.
- **Corrected what is said about unstable.** It had been described as
  impossible, which is wrong: `nixos-unstable` publishes the same option data.
  The real obstacle is that the channel serves its newest snapshot while
  `flake.lock` pins one commit, and unstable moves daily. Mixing channels is a
  separate matter and does remain out of scope.

### build 2026-08-05h

- **Setup is the first tab and the one you land on**, before Options and
  Packages. On a machine that has just been installed, those files are what you
  need before anything else.

### build 2026-08-05g

- **Pick the nixpkgs release in the Setup tab.** The current numbered release
  and the two before it; `flake.nix` is pinned to whichever you choose. The
  list is discovered by asking the channel server, so it does not go stale.
- **The option index follows the release you picked.** If the two drift apart
  the tab says so and offers to build the index for that release — a few
  minutes the first time, instant afterwards, since each release keeps its own
  database. The choice survives a restart.
- `fetch-data.sh` now falls back to Python's brotli module when the `brotli`
  command is not around, so a rebuild works outside `nix develop` too.

### build 2026-08-05f

- **Package lists are alphabetical**, on import and as you add to them. Nix does
  not care about the order, but a sorted list reads better and diffs smaller.
- **Fixed: the fallback reader dropped whole package lists.** On a machine
  without `nix-instantiate`, the semicolon in `with pkgs;` was mistaken for the
  end of the value, so everything after it was lost.
- The header now shows a build id. **If a fix does not seem to have landed,
  check that number first** — an old copy being served looks exactly like a
  broken fix.

### Before that

- **Every starter field is editable** — boot loader (systemd-boot, GRUB or
  none), NetworkManager, flakes, groups, `stateVersion`. Switching a block off
  removes its lines rather than commenting them out.
- **Options set in both files are flagged in red**, because two `lib.mkDefault`
  definitions of equal priority make NixOS refuse to choose.
- **Fixed: a generated file that imported itself.** Carrying `imports` across
  could leave a reference to `./generated.nix` inside it, ending in
  `stack overflow; max-call-depth exceeded` with no clue where.
- **Fixed: `imports` was being dropped entirely**, so
  `hardware-configuration.nix` never loaded and the rebuild failed on a missing
  `fileSystems."/".fsType`.
- Reading an existing `configuration.nix`, with every line accounted for in one
  of four groups.
- One package per line, and long values no longer truncated at 400 characters.

### beta — first release

- Search across every option and package in the stable channel, a form built
  from the published type data, and a live view of the file being generated.

---

## 日本語

## v1.0.0-dev.10 — 2026-08-12

`development` ブランチに先に入り、その後 `main` に統合された内容です。保守のための一巡: 検査ツールを1つ追加し、プリセットを宣言的にし、不具合を10件修正しました。うち3件は数日前に出したばかりのコードの中にあり、新しい検査とその前の監査が見つけたものです。

### build 2026-08-12x

**半年ごとのリリース周期への備え。** NixOS は半年ごとに新リリースを出し、その間に nixpkgs は名前を変えます。nixgen は既にそれで落ちない作りです(プリセットは候補を並べ、カタログにある最初のものを採る) — そして**それこそが問題**です。古くなった名前は例外を出さず、設定が1つ静かに書かれないだけ、分類から1行静かに消えるだけだからです。

- **`tools/catalogue_check.py`** は、動いているアプリにプリセットが名指ししている全オプション名・パッケージ名を尋ね、索引にどれが現存するかを問い合わせ、無いものを名指しします。ソースを解析するのではなく**生きているページから表を読む**ので、検査対象との食い違いが原理的に起きません。**意図して残した旧綴り**(nixgen は3リリースを提供するので、旧綴りが古いチャンネルを支えています)と**本当に消えた名前**を区別します。狼少年になる検査は誰も走らせないからです。CI で毎プッシュ実行されます。
- **CLAUDE.md に「新しい NixOS リリースが出たとき」のランブック**を追加しました。新チャンネルの索引を作り、1つのコマンドを流し、出力に従って直し、そのあと各ハーネスを「前段が通って初めて次が信用できる」順に流す、という手順です。
- **各プリセットのオプションパスを表に引き上げました**(`GPU_PATHS`・`LANG_PATHS`・`FLATPAK_PATHS`・`SHELL_PATHS`・`KERNEL_PATHS`・`REGION_PATHS`)。関数本体に埋まっていたものが1か所で読めるようになり、検査ツールからも見えます — 対象は56群から**71群**に増えました。
- **改名されたアプリは「2つの綴りを持つ1項目」**になりました(`['thunar', 'xfce.thunar']`)。デスクトップのロールが既に使っている候補方式と同じです。

**修正した不具合。**

- **LTS が2年古いカーネルを渡していました。** 6.18 は 2025-11-30 から longterm で、このチャンネルも配布しているのに、一覧の先頭は 6.12 のままでした。**新しい検査が捕まえた**もので、この検査を作った理由そのものです。
- **nixgen 自身の PulseAudio 出力を取り込むと、ビルドできないファイルになっていました。** インポータが `lib.mkForce` を畳んで落としていたためです。PipeWire に対する `lib.mkForce false` は、あのプリセットがそう書く理由そのもの — 素の `false` はデスクトップの素の `true` と衝突するので、それを避けるために存在します。今後 `mkForce` と `mkOverride` は書かれたまま保存し、`mkDefault` は従来どおり畳みます(nixgen が書く configuration.nix は全行が mkDefault で、Setup タブは自分のファイルを読み戻す必要があるため)。両方を固定ケースで、**2つのリーダー両方**で固定しました。
- **すべてのパッケージアイコンが、テーマが持つ最低サイズで配信されていました。** アイコンディレクトリを順位付けする並べ替えが逆向きで、16×16 が 256×256 を上書きしていました — 直上のコメントが述べる意図と正反対の動作です。Firefox は 128×128、VLC は 256×256、GIMP は SVG から出るようになりました。
- **モジュールカードの × が別のカードを消すことがありました。** オプションのパスで消していたためで、同じオプションを2回設定するファイル(ユーザー2人、vhost 2つ)は、同じパスを共有する別々のキーで登録されます。
- **プリセットのプルダウン3つが機械翻訳よけの保護リストから漏れていました**(Region の18個の日英併記ラベルを含みます)。
- 不正なクエリパラメータに対して**何も返していませんでした**。`do_GET` にも `do_POST` と同じ例外ラッパを付けました。`?limit=-1` はカタログ全件を返していました(SQLite は負の LIMIT を「無制限」と読みます)。またオフライン時、「未使用の索引」一覧が**現役チャンネルの索引を削除候補として提示**していました。チャンネルが現役かを知る唯一の柵が、探索が空を返したときに開いてしまうためです。
- **ダークモードでホスト名の入力ミスが見えませんでした**(1.17:1。ダークモード以前からの色指定)。再索引失敗のメッセージは `app.js` に残る最後のハードコード色でした。
- **スイープがアプリの故障中に合格しうる状態でした。** `check_syntax` はステータス欄を消さずに読んでおり、ハンドラは何も書かずに返ることがあるので、前の項目の判定がそのまま今回の合格として読まれえました。`settled()` が返す false も捨てていたので、前のファイルに対して検証してしまう可能性がありました。

検証: fuzz、インポータ(両リーダー)、11項目スイープ、新しいカタログ検査、そして新規生成の束と往復後モジュールの両方に対する `eval_check`。

## v1.0.0-dev.9 — 2026-08-12

`development` ブランチに先に入り、その後 `main` に統合された内容です。この見出しから `v1.0.0-dev.8` までが、この版で加わった内容です。

### build 2026-08-12w

- **Flatpak の行にプルダウンが付きました。ストアアプリを選べます。** GNOME Software・KDE Discover・Bazaar・Warehouse — 3つの設定だけでは手に入らない**GUI 側の半分**です。**先頭の「設定のみ」が従来の動作**で、そのまま残してあります(3つの設定だけを入れ、既に入っているフロントエンドは外します)。ストアアプリは1つずつで、切り替えると前のものは外れ、**何が外れたかはステータスバーが名指しします**。
- **4つは「実在する4つ」で、名前を信じずに中を開いて確かめました。** 候補はすべてビルドして Flatpak バックエンドを探しています: GNOME Software の `libgs_plugin_flatpak.so`、Discover の `flatpak-backend.so`、そして Bazaar と Warehouse は実行時クロージャに flatpak 本体を持つこと。**Flatseal が無いのは nixpkgs にそのパッケージが無いから**です — あれは Flathub のアプリで、つまりこの行が用意する仕組みで入れるものです。
- **GNOME Software はパッケージではなく設定として入ります。** `services.gnome.gnome-software.enable` はプログラムに加えて **systemd ユニットも**連れてきます(素のパッケージでは付きません。評価済みシステムから読み戻して確認しました)。GNOME 以外のデスクトップでも機能します(Xfce で評価)。なお GNOME は Flatpak が有効になると自分でこの同じオプションを立てますが、**双方が `true` なので衝突せず併合されます** — 出荷前に評価して確かめました。直前のメディア再生の行で、ちょうど逆のケースに噛まれたばかりだったからです。
- 動いているアプリに対して13項目で検証しました: 各選択が主張どおりに書くこと、どの切り替えでもストアアプリがちょうど1つだけ残り構文も通ること、「設定のみ」でプルダウン導入前の出力に戻ること、Undo 1回で丸ごと戻ること、取り込んだファイルでプルダウンが選択されること、ラベルが閉じた select に収まること。そのうえで本番の検査 — **GNOME + GNOME Software** と **Plasma + Discover** の束をアプリに実際に生成させ、**本物の NixOS システムとして評価**して、ストアアプリが `environment.systemPackages` に(そして systemd ユニットも)入っていることを読み戻しました。仕上げに11項目のスイープも全て通っています。

## v1.0.0-dev.8 — 2026-08-12

`development` ブランチに先に入り、その後 `main` に統合された内容です。この見出しから `v1.0.0-rc.3` までが、この版で加わった内容です。

### build 2026-08-12v

- **グラフィックスと言語の間に「メディア再生」のプルダウンを追加しました: PipeWire か PulseAudio です。** PipeWire は互換レイヤーごと入ります — Steam や wine のための 32bit 対応込みの ALSA、そして大半のアプリが実際に話しかける PulseAudio ソケット — さらにリアルタイムスケジューリングを与える rtkit も。PulseAudio は 32bit 対応と、**書き方に理由のある1行**を連れてきます: `services.pipewire.enable = lib.mkForce false`。デスクトップによっては PipeWire を素の `true` で自分から有効化するため(このチャンネルのリビジョンでは GNOME のリモートデスクトップがそうします)、普通の false では同優先度の衝突になってビルドが拒否されます — mkForce を使えというのは、モジュールシステム自身のエラーメッセージの助言です。ステータスバーはこの選択の代償(画面共有や GNOME リモートデスクトップは PipeWire を要する)と、PulseAudio + GDM が NixOS 26.11 で廃止予定であることを伝えます。
- **推測ではなく評価しました。** それぞれのサーバーを GNOME と、Plasma と、単独で — 計6システムを索引のリビジョンで実際に評価し、素の false の衝突は mkForce を選ぶ**前に**再現させています。ブラウザでは11項目: PipeWire の5設定、PulseAudio への置き換え、双方向の切り替えで定義が1つだけ残り構文も通ること、行が Options タブだけに出ること、ラベルが閉じたプルダウンに収まること(開いたタブで実測 — 隠れた select は幅0を返します)、Undo 1回で丸ごと戻ること、PipeWire 入りモジュールの取り込みでプルダウンが選択されること。仕上げに11項目のスイープも全て通っています。

## v1.0.0-rc.3 — 2026-08-12

3つめのリリース候補です。`v1.0.0-rc.2.2` に、下の `v1.0.0-dev.4` から `v1.0.0-dev.7` までの4見出し(先に `development` に入り、統合済みのもの)をすべて加えたものです。一言でいえば、Undo ボタン、最後のページを閉じるとサーバーが終了、ステータスバーが2倍の大きさに、そしてダークモード(OS 追従・手動切り替え・ロゴとアイコンも連動)です。

## v1.0.0-dev.7 — 2026-08-12

`development` ブランチに先に入り、その後 `main` に統合された内容です。この見出しから `v1.0.0-dev.6` までが、この版で加わった内容です。

### build 2026-08-12u

- **ダークモードを実装しました。** ページはまず OS の設定に自動で従い、ヘッダのボタンで手動でも切り替えられます。選んだ結果は記憶され、何も選んでいなければ OS の変更に**その場で**追従し続けます。ダークは「同じ部屋の照明を消しただけ」です: ファイル欄はもともと夜の配色なので変わらず、残りのページがその色の家族に移ります。ネイティブ部品(プルダウン・チェックボックス・スクロールバー)も一緒に暗くなります。
- **ロゴとアイコンも切り替わります。** ヘッダの雪の結晶は文字色で描かれているので自動で追従します。5つの手順の上のアートワークはアルファチャンネルだけの純黒なので、反転すると**にじみのない白の原画**になります(README のダークテーマ用ロゴと同じ事実に依っています)。ファビコンもインクを差し替えるので、ブラウザのタブも揃います。System update ボタンは両テーマで琥珀色のまま — マシンを変更する唯一のボタンだからです。
- **推測ではなく確認しました:** ダーク設定の OS では何もせずダークで開き、切り替えは両方向ともリロードを生き延び、反転ロゴとファビコンの差し替えは動いているページから読み戻し、ダークで検査した全ての文字/背景の組がコントラスト 4.5:1 を満たし(淡色ラベルが最初 3.6:1 で落ちたので明るくしました)、どの幅でも横スクロールは出ず、11項目のスイープも全て通っています。`background:#fff` が1つインラインスタイルに隠れていて、CSS の走査ではなく**スクリーンショットで**見つかりました。
- 記憶したテーマは、nixgen がブラウザに保存する唯一のものです。起動のたびにリセットされる切り替えボタンは壊れて見えます。大事なものは今までどおりすべてメモリの中にあり、それ以外は何も保存しません。

## v1.0.0-dev.6 — 2026-08-12

`development` ブランチに先に入り、その後 `main` に統合された内容です。この見出しから `v1.0.0-dev.5` までが、この版で加わった内容です。

### build 2026-08-12t

- **ステータスバーの高さを2倍にし、文字を大きくしました。** アプリが返す日英の答えはすべてファイル欄の下のこのバーに出ますが、ページで一番小さい文字(11px)が、2行ぶんに張り付いた箱に入っていました。今は 14px で、箱の高さは**実測した従来値のちょうど2倍**(45px → 90px)を確保します。スクロールの上限も一緒に倍にした(160px → 320px)ので、長いメッセージはスクロールが始まる前に2倍の量が読めます — そしてページを押し広げるのではなく、今までどおり自分の箱の中でスクロールします。前後とも目分量ではなく実測で確認し、320px 以上のどの幅でも横スクロールは出ません。

## v1.0.0-dev.5 — 2026-08-12

`development` ブランチに先に入り、その後 `main` に統合された内容です。この見出しから `v1.0.0-dev.4` までが、この版で加わった内容です。

### build 2026-08-12s

- **最後の nixgen のページを閉じると、サーバーも終了するようになりました。** ページがアプリケーションそのものです。最後のページが閉じられて数秒すると、プロセスは自分で終わり、裏には何も残りません — もう一度アイコンをクリックすれば、新しく起動します。推測ではなく**数えています**: 各ページが自分の ID を発行して申告し(読み込み時に hello、20秒ごとに ping、閉じる瞬間に bye ビーコン)、リロード(bye の直後、猶予内に新しいページの hello が届く)も2つめのウィンドウ(単に2つめの ID)も、特別扱いではなく算術から自然に落ちます。
- **遅い部分は意図的です。** 通常の「閉じる」が即座なのは bye ビーコンのおかげです。5分の無応答バックストップは、bye を言えずに死んだブラウザのためだけにあり、その長さにも理由があります — Chrome はバッテリー駆動時に非表示タブを凍結し、凍結されたページは ping を打てません。まだ存在しているページの足元でサーバーが終了すれば、それはデータ喪失に見えます。時計は一貫して monotonic なので、ノート PC のサスペンドは誰の不利にもなりません。最初のページが接続するまで機構は武装しないので、初回の5分の索引構築も安全です。
- **`--no-browser` はこの機構を丸ごと無効にします。** テスト・CI・ブラウザ検査のような「駆動される」サーバーは、機械の速度でページを開閉します。スイートの合間にサーバーが終了しては困るので、そこでは従来どおりページを閉じてもサーバーは残ります。
- 実プロセスに対して検証しました: リロードと2つめのウィンドウではサーバーが残り、最後のページを閉じると数秒で終了し、`--no-browser` のサーバーはページの出入りを無視します。仕上げに11項目のスイープも全て通っています。

## v1.0.0-dev.4 — 2026-08-12

`development` ブランチに先に入り、その後 `main` に統合された内容です。この見出しから `v1.0.0-rc.2.2` までが、この版で加わった内容です。

### build 2026-08-12r

- **モジュール欄のヘッダに Undo ボタンを追加しました。** 1回押すと、直前の手順の前に画面にあった状態へ戻ります。「1手順」はユーザーの操作1回です: オプションやパッケージの追加、プリセットの適用(何枚カードを書いても1手順)、ファイルの取り込み(`configuration.nix` が埋める Setup タブの入力欄も含めて戻ります)、カードの編集や削除。編集は**1編集=1手順**で、1文字ごとではありません — スナップショットは入力欄にフォーカスした瞬間、つまり入力の前に取られます。最大50手順まで遡れ、戻る先が無いときはボタンが眠り、続けて押せばさらに遡ります。
- **自動修復は手順に数えません。** `ensureImType` と `ensureUnfree` は復元後のレンダリングで再適用されるので、復元された状態も組み立てた状態と同じルールに従います。「steam を追加」を取り消せば、自動で入った `allowUnfree` も一緒に消えます(steam が居なくなれば誰も必要としないからです)。逆に、unfree なものがまだ残っている状態へ戻れば、スイッチは即座に戻されます。
- 動いているアプリに対して19項目で検証しました: ボタンはスタックに合わせて起き・眠り、追加したオプションが消え、steam は自動スイッチごと消え、デスクトッププリセット一式が1回で戻り、編集は値だけ戻ってカードは残り、`configuration.nix` の取り込みは Setup 入力欄とモジュールが揃って戻り、2手順は順番どおりに2回で戻り、`generated.nix` の取り込みも丸ごと戻ります。仕上げに11項目のスイープも全て通っています。
- そのスイープが出荷前に1件を捕まえました: スタックの宣言を最初は関数群の隣(ファイル後方)に置いたところ、`boot()` が初期実行の同期パスでそれに触れるため、**`const` の temporal dead zone** で boot が中断 — スターターファイルが読み込まれず、症状は「2つの取り込み検査が空の `configuration.nix` で失敗する」という離れた場所に出ました。`SWAY_CONFIG_NO_BAR` の教訓の再演です。宣言はファイル先頭の `state` の隣に移しました。

## v1.0.0-rc.2.2 — 2026-08-12

`v1.0.0-rc.2.1` に、System update の改善を1つ加えた版です。渡されるコマンドが、**実際にダウンロードされた書庫を直接指定する**ようになりました。これまではありそうなフォルダを探して最初の一致を使っていたため、以前の同じ名前の書庫を展開してしまったり、ブラウザが `name (1).tar.gz` の名前で保存した場合に新しいほうを見つけられなかったりする可能性がありました。詳細はすぐ下の `v1.0.0-dev.3` にあり、このタグで加わるのはちょうどその内容です。

## v1.0.0-dev.3 — 2026-08-12

`development` ブランチに先に入り、その後 `main` に統合された内容です。この見出しから `v1.0.0-rc.2.1` までが、この版で加わった内容です。

### build 2026-08-12q

- **System update が書庫の実際の保存先を検知し、コマンドがそのファイルを直接指定するようになりました。** 渡すコマンドはこれまで、ありそうなダウンロードフォルダを順に探して最初の一致を使っていました。これには穴が2つあります。以前の同名書庫が新しいダウンロードに勝ってしまうこと。そしてブラウザが衝突を避けて `name (1).tar.gz` の名前で保存すると、探索は新しいファイルを見つけられず**古いほうを展開してしまう**ことです。ダウンロード後、アプリはサーバー(同じマシン・同じユーザーで動いています)に「クリック以降に書庫の名前で保存されたファイルはどこか」を尋ねます。重複時の別名も対象で、最新のものが勝ちます。見つかればダイアログ内のコマンドがその場で**実ファイル直指定**に差し替わり、保存先も表示します。見つからなければ(ブラウザが特殊な場所に保存した場合)、従来の探索コマンドがそのまま残ります。検知は精度の上乗せで、待たされることはありません。
- **特権側は動いていません。** 追加したエンドポイントは読み取り専用で、受け取るのはホスト名と時刻だけ — **パスは一切受け取りません**。書庫名はサーバー側で再計算し、探すのは固定のダウンロードディレクトリ一覧の中だけです(最初に見るのは XDG 設定で、ローカライズされた「ダウンロード」という名前が実際に記録されている場所です)。コマンドは今までどおりあなたのターミナルで動き、2回の確認・バックアップ・内部にシングルクォート無し、もそのままです。見つかったパスは、二重引用符から抜け出せない文字だけで出来ているときにのみ埋め込み、少しでも怪しければ探索コマンドのままにします。
- 動いているアプリに対して通しで検証しました。ダイアログは即座に探索コマンドで開き、実際のダウンロードフォルダ(この開発機では `~/ダウンロード`)に保存されるとコマンドが実パス指定に差し替わり、別の場所に保存された場合は探索コマンドのまま残ります。差し替え後コマンドの非特権部分は日本語パスのまま実行して動作を確認し、fish への貼り付けも通しました。仕上げに11項目のスイープも全て通っています。

## v1.0.0-rc.2.1 — 2026-08-12

`v1.0.0-rc.2` に重要な修正を1つ加え、次の候補版を待たずにタグを打った版です。AMD や Intel を選んでも `nixpkgs.config.allowUnfree` が外れなくなり、unfree なものがファイルにあればスイッチが自動で入ります。詳細はすぐ下の `v1.0.0-dev.2` にあり、このタグに入っているのはちょうどその内容です。

## v1.0.0-dev.2 — 2026-08-12

`development` に先に入り、`main` にも統合済みです — 次の候補版を待たせない重要度の修正のためです。この見出しから `v1.0.0-rc.2` までが、この版で加わった内容です。

### build 2026-08-12p

- **AMD や Intel を選んでも `nixpkgs.config.allowUnfree` が外れなくなりました。** 実機からの報告です。グラフィックスのプリセットは「他に必要とするものが無ければ」スイッチを外していましたが、その判定は **UI 自身が追加したパッケージしか知りません**でした。import で入った Steam がリストにあっても、AMD のクリックがビルドを通す唯一の行を消してしまいます。**自動で外す処理そのものを無くしました。** カードの削除はユーザーだけの操作です。
- **スイッチは、必要になった場所で自動的に入ります。** 毎回のレンダリングでファイル中のパッケージ名と NVIDIA 設定を走査し、見たことのない名前は索引に問い合わせます(どのパッケージが unfree かは、索引がずっと知っていました)。unfree なものがファイルにあり、スイッチが無ければカードを追加し、ステータスバーが**どのパッケージのためか**を名指しします。これで入ってくる全経路をカバーします — 検索結果のクリック、`generated.nix` / `configuration.nix` の取り込み、verbatim カードへの手書き、NVIDIA モジュールの import。スイッチが既にどこかで設定されていれば(モジュール内でも、取り込みの configuration.nix 側でも)何もしません。unfree なものが残ったままカードを消すと、次のレンダリングで戻ります。スイッチ無しで unfree を名指しするファイルは、`nixos-rebuild` が門前払いするものだからです。
- コードを読んでではなく、動いているアプリに対して検証しました: NVIDIA→AMD→Intel と切り替えてもカードは残り、検索からの steam も import からの steam もカードを連れてきて、設定済みのファイルには2つめが入らず、import された `hardware.nvidia.*` でも入り、firefox 単独では入りません。仕上げに11項目のスイープも全て通っています。

## v1.0.0-rc.2 — 2026-08-12

2つめのリリース候補です。`v1.0.0-rc.1` に、下の `v1.0.0-dev.1` 見出しの内容(先に `development` に入り、統合済みのもの)をすべて加えたものです。一言でいえば、nixgen がアプリケーションになりました — 一度インストールすればアプリメニューに並び、アイコンから専用のウィンドウが最大化で開きます。README のステップ2と2aは起動の2通り(コマンドから・アイコンから)を名乗るようになり、ホームページにもアイコンからの起動を記載しました。

## v1.0.0-dev.1 — 2026-08-12

`development` ブランチに先に入り、その後 `main` に統合された内容です。この見出しから `v1.0.0-rc.1` までが、この版で加わった内容です。その下は、元になったリリース候補です。

### パッケージング、2026-08-12e

- **デスクトップエントリを追加しました。** これで `nix profile install github:hatake716/nixgen` がこのツールに必要な最後のコマンドになります。以降はアプリメニューの「システム」に並び、そこから起動すればブラウザが自動で開きます。アイコンはビルド時に `tools/mark.py` が生成するので、**マークの出どころはそのファイル1つのまま**です(2つのページが出力を貼り付けているのと同じ理由)。いずれも白地を持たせてあります。アプリメニューが表示するファイルは1つで、README のロゴのようにテーマごとに選び分けられないためです — 背景が透明な線画では、暗いパネルで見えなくなります。
- **原案のアートワークを数値にしたので、アイコンを原案そのものにできました。** `docs/logo.png` はラスタ画像で、余白のある場所でしか使えませんでした — アプリのヘッダとファビコンが簡略版のフレークを使ってきたのはそのためです。これを `tools/mark.py` の中にパスデータとして起こしたので、**元の描画をどのサイズでも描けます**。64px 以上のアイコンは、近似ではなく原案そのものです。ただし**変換で変わるのは形式であって密度ではありません**: 32px と 48px では原案は依然として雪の結晶と判別できないので、そのサイズはフレークのままにしました。線引きは、両方を 32・48・64 でレンダリングして決めています。GTK の挙動も推測せず確認しました — 完全一致するサイズのディレクトリが `scalable` より優先されるので、24px のパネル枠に原案が入ることはありません。
- **最初の1コマンドは無くせません。そしてそれは nixgen 側で直せる話ではありません。** NixOS には**GUIによるパッケージ導入手段がそもそも存在しません** — GNOME Software も KDE Discover も、ここではシステムのパッケージを扱わないからです。また、これで全工程がGUIだけになるわけでもありません: `System update` は今も**意図して**コマンドを1つ渡すだけで、代わりにリビルドはしません(サーバーに認証が無いためです)。今回無くなったのは、その**2つの間にあった**コマンドのすべてです。
- **2回目の起動は、拒否せずに既に動いている nixgen を開きます。** ブラウザのタブを閉じてもサーバーは残るので、クリックするアイコンがある以上これは開発中の事故ではなく**通常の操作**です。誰も開いていないターミナルに向かって拒否のメッセージを出せば、アイコンが壊れているようにしか見えません。開く前に `/api/meta` で確認します: 使用中のポートには全く別のものが居ることもあり、無関係なローカルサービスへブラウザを送るのは、置き換えようとしたメッセージより悪いからです。その場合と `--no-browser` の場合は従来どおり拒否します — ただし**それぞれ実際の理由**を述べるようにしました。**どちらのコピーが応答したかは、今もヘッダのビルド番号が答えます**。そこだけは覆い隠してはならない一点です。
- **初回起動が、伝える先のターミナルが無くても伝えるようになりました。** 索引の構築には5分ほどかかりますが、メニューから起動した場合その進捗行はどこにも出ません。代わりにデスクトップ通知を出します。届けるにはセッションバスが必要なので、これはベストエフォートで、失敗しても起動は止めません。
- **アイコンから起動したときは、専用のウィンドウで開きます** — タブバーもアドレスバーも、戻る・進むもありません。メニューに並んでいる以上これはアプリケーションであり、既に開いているブラウザの20個目のタブとして現れれば、いま押したものではなく**ウェブサイトに見えます**。ブラウザ側の枠は、このページが使うものを何一つ提供していません。デスクトップエントリが `--app` を渡します。ターミナルからの起動には付かないので、従来どおりの通常ブラウザのままです(そこではタブこそが求めたものだからです)。**このために追加した依存はありません** — このフラグは Chromium 系のもので、いずれも綴りが同じなので、**マシンに既にあるものを使うか、何もしないか**のどちらかです。何もない場合は従来の動作になります。**Firefox は意図して外しています**: 一番近いのは `--kiosk` で、これはウィンドウ枠の無い本物の全画面です。**出口の見つからないウィンドウは、タブより悪い答え**です。ここで得られるのは通常のウィンドウ操作を備えた普通のウィンドウで、全画面にしたければ F11 で切り替わります。
- **このウィンドウは最大化した状態で開きます。** このアプリは3つの列を横に並べる作りですが、ブラウザがアプリウィンドウに与える既定のサイズは、それらが縦に積み上がってしまう程度の幅しかありません。「左に入力、右にファイル」という構成のツールの第一印象としては誤りです。**全画面ではなく最大化**です。タイトルバーとそのボタンは残るので、通常の操作で好きな大きさに戻せます。
- **ドックに登録したアイコンは、登録した時点の版を起動し続けます。** README に明記しました。nixgen の不具合ではなく、こちら側では直せません: ドックはランチャーを絶対パスで保存し、メニュー項目はストアへの symlink なので、**保存されるのはストアパス**です。ストアパスは変わらないので、更新は新しいものを作るだけで、登録済みのファイルは古いほうを指したままになります。実機で Plank を使っていて見つかりました — 症状は `--app` が全く効いていないのと**見分けがつきません**。アイコンを削除して登録し直せば直ります。アプリメニュー自体はプロファイルを読むので問題ありません。

## v1.0.0-rc.1 — 2026-08-12

最初のリリース候補です。この見出しの下にあるものが、この候補に含まれる内容です。さらに下の build 見出しは、ここに至るまでの履歴です。

**何ができるか。** NixOS をインストールした直後から、使えるマシンまで。オプション名を1つも知らないまま、24,557件の設定と144,245件のパッケージを検索し、型に応じたウィジェットで値を入れ、初回ログインから使えるデスクトップを選び、**マシンに何も起きないうちに中身を読める**3つのファイルを持ち帰れます。

**この候補に入っているもの。**

- デスクトップ9種。うち2つは Wayland コンポジタで、**シェル・端末・キーリング・自動起動ユニットまで配線済み**で出てきます(Sway + noctalia、niri + noctalia。どちらも実機で確認済み)。
- **日本語環境が通しで整います**: ロケール、コンソールのキーマップ、X **と** Wayland 両方のキーボードレイアウト、fcitx5 と mozc、そしてセッションに合わせたフロントエンド。アプリ自身もすべて日英併記です。
- カーネル・シェル・グラフィックス・言語・地域・Flatpak が各1クリック。定番アプリは12分野189個で、アイコンは**お使いのマシンにあるもの**から出します。
- 既存の `configuration.nix` を読めます。Setup タブが持つ項目はその入力欄へ、`imports` は統合、**それ以外は編集できるカード**になります。`generated.nix` を読み戻すと、プルダウンもその内容に合わせて選択されます。
- **生成のみ。** nixgen はあなたのファイルを書き換えず、特権の口も持ちません。System update は**読めるコマンドを1つ渡す**だけです。

**どう検査しているか。** 毎プッシュで `tools/fuzz.py` と `tools/import_check.py`、そして実アプリをブラウザで操作する11項目の `tools/browser_check.py`。このタグの前には `tools/eval_check.py` で、生成した3ファイルを**実際の NixOS システムとして評価**し、その主張を読み戻しました(ログイン画面が提示するセッション名、生成された pam.d/login のキーリング行、sway 設定の include とバーの不在、Wayland のレイアウト変数)。往復後のモジュールも同一に評価されます。

**既知の制限。** NixOS 専用。Hyprland は非表示です(自動生成される設定が nixgen の書くものを上書きするため)。`Check syntax` は Nix のパーサであって**型は判定できません** — 切り替える前に `dry-build` を。

---


### ツール、2026-08-12d

- **ブラウザ検査の11項目がコマンドになりました**: `tools/browser_check.py` が実際のアプリを操作し(本物の検索・本物のファイル入力・本物の Check syntax)、これまでのリリース点検が毎回確かめてきた全項目を通します。CI でも独立ジョブとして毎プッシュ走ります。以前はセッションのスクラッチパッドにあり、点検のたびに手で作り直していました — スクリーンショットに施したのと同じ直し方です。
- **実システム評価もコマンドになりました**: `tools/eval_check.py` は検査が保存したディレクトリを受け取り、スタブの hardware ファイルを添えて書庫を**実際の NixOS システムとして評価**し、module の主張を評価済みシステムから読み戻します — ログイン画面が提供するセッション名、ビルドされた pam.d/login のキーリング行、include ありバー無しの sway 設定、Wayland のレイアウト変数、nvidia ドライバ、タイムゾーン。`--generated` で往復後の module を、`--revision` で報告者の nixpkgs を評価できます。CI には意図して載せていません: ピン留めした nixpkgs の取得と数分の評価が要るためです。
- どちらもこのビルドで完走済みです: 11項目すべて通過、新規生成の書庫も往復後の module も、索引のリビジョンに対して評価と読み戻しが正しく通りました。

### build 2026-08-12o

- **修正: 取り込みで1つの葉が2つの形で定義され、ファイルが解析不能になることがありました。** インポータは読み込みの過程で形を変えます — ファイル内のフラット行は親オプションの attrs カードに畳み込まれ、属性セットは葉ごとのカードに平坦化されます。一方、取り込み時の置換はレンダリングパスの**完全一致**で比較していたため、ファイル側のカードとフォーム側のカードが同じ属性を別のパスで持ち、両方が生き残れました。nixgen 自身の `generated.nix` を、それを作ったセッションに読み戻すだけで再現します: 言語プリセットが書いたフラットな `environment.sessionVariables.XKB_DEFAULT_LAYOUT` カードがファイル由来の畳み込みブロックの隣に残り、Check syntax は `attribute … already defined` を報告し、デスクトップの選び直しで治るのはユニットと etc の側だけでした。二形状衝突の**第4変種**です。
- 突き合わせは**キー単位・双方向**になりました。プリセットで既に使っていた `dropFromAncestors` と同じやり方です: 届いたカードは自分のキーを祖先の attrs カードから消し、届いた attrs カードは自分が持つキーのフラットカードを消します。**異なる**キーの入れ子は普通の Nix なのでそのまま残します — `nix.settings = { experimental-features = …; }` と `nix.settings.cores` の同居は今も解析でき、取り込みも生き延びます。このビルドでブラウザ検査11項目の全走とあわせて再検証済みです。

### ドキュメント、2026-08-12c

- **`DEBUGGING.md` を追加しました**: 次にデバッグする人への引き継ぎです。これまでの検証のやり方と再現手順(ブラウザ検査の11項目・実システム評価ハーネス・実ファイル検査のレシピ)、これまでの全バグが属した**6つの族**、検証済みと未検証の**正直な境界**、繰り返さないためのテスト側誤検出の記録。不変条件の本体は CLAUDE.md のままで、こちらは**方法**の本体です。

### build 2026-08-12n

- **修正: 取り込み時のステータスで、二段表記のラベルが連結して表示されていました**(「Language言語、Region地域」)。積み重ねラベルは1つの span なので、全文を読むと両言語が繋がります。英語名は最初のテキストノードにあり、いまはそれを使います。
- 直近2機能をさらに攻めましたが、他は見つかりませんでした: configuration.nix から取り込んだパッケージのグレーアウトと追記、2回目の取り込みが置換になること(重複しない)、Setup 項目だけのファイルで module が空のままなこと、非表示の Hyprland を含むファイルで何も選択されないこと、新しい経路でも aarch64 がアーキテクチャ欄を再表示すること。

### build 2026-08-12m

- **`configuration.nix` を取り込むと、Setup タブが持たない項目はすべて module のカードになります。** これまでは、それらを Setup タブが書く `configuration.nix` へ**そのまま写して**いました。
- **変えた理由**: 写す先のファイルはどのみち nixgen が生成するので、**何も保存されていませんでした**。そして写したテキストは眺めることしかできませんが、カードなら**変更でき**、カタログと突き合わせられ、衝突も検出できます。Setup タブの入力欄と `imports` の扱いは従来どおりで、**Setup が持つ項目は module に入りません**(2つのファイルに同じ設定が入るのを防ぐため)。
- Options のプルダウンも追従するので、ロケールとタイムゾーンを持つ `configuration.nix` を読み込むと、Language と Region が選択済みで戻ります。

### 検証パス、2026-08-12b

安定版と呼ぶ前の2度目の総点検です。前回以降のすべて — allowUnfree の配線、UI再設計、Setup タブの日英併記、アーキテクチャの固定 — を対象にしました。**修正を要するバグは0件**です。

- **書庫がまるごとビルドできます**: 全プリセット同時(Sway + noctalia・NVIDIA・日本語・地域・カーネル・シェル・Flatpak・検索からのパッケージ)でダウンロードし、展開して NixOS システムとして評価。評価済みシステムからの読み戻しも確認: `allowUnfree` の下で `videoDrivers = ["nvidia"]`、タイムゾーン、Wayland のレイアウト変数、include ありバー無しの sway 設定、login の pam_gnome_keyring 3行。
- **その書庫を読み戻してデスクトップを選び直しても、定義は1つずつに畳まれます**(etc 1行・ユニット1つ)。
- **デスクトップを歩き回っても、最後に残るディスプレイマネージャはちょうど1つ**。allowUnfree は保たれ、コンポジタの消し残しもありません。
- System update のダイアログ、壊れたファイルの取り込み(属性の二重定義・null の入力メソッド type・aarch64 でのアーキテクチャ再表示)、モバイルのナビ、見た目の規約(日本語の文中空白0・320〜1800px で横スクロールなし)、両リーダーの固定ハーネス、フレークビルド — すべてクリーンです。

### build 2026-08-12k

- **Architecture の欄を `x86_64-linux` に固定し、非表示にしました。** 決めることが1つ減ります。ほぼすべてのPCで答えは同じだからです。
- **削除ではなく非表示です。** 配線は残してあり、**別のアーキテクチャを持つ `configuration.nix` を取り込むと、その値と一緒に欄が再表示されます**。マシンの実際のアーキテクチャが見えないまま持ち回られることはありません。両方向を検証済みです: 新規ページでは欄が隠れて flake は `x86_64-linux` を指し、`aarch64-linux` のファイルを取り込むと欄が現れて flake も追従します。

### build 2026-08-12j

- **Setup タブの文言をすべて日英併記にしました。** 冒頭の説明、各入力欄のラベル(プリセット行と同じ二段表記)、チェックボックス3つ、Groups・GRUB・`system.stateVersion`・`lib.mkDefault` の注記、rebuild コマンドの見出し2つ — さらに**動的なメッセージも**: チャンネルと参照先の注記の全パターン、残った索引の案内、ホスト名・ユーザー名・stateVersion の警告、そして「索引を作り直す/一覧を切り替える/索引を作る」のボタンラベルです。
- 途中で描画の規則がひとつ確定しました。`\n` を改行として描くのは **app.js が書く動的な注記だけ**です。静的な注記は HTML ソース内で折り返されており、そこに `pre-line` を当てると**ソースの折返しが文の途中の改行として出てしまいます**。

### build 2026-08-12i

デザインの見直しです。モノクロの見た目はそのままに、**作業の順序をUI自身が着る**ようにしました。

- **5つの手順が、部品そのものに付きました。** カタログの3タブに番号チップ(1 Setup・2 Options・3 Packages、それぞれに日本語の小さな添え書き)、ヘッダーの Check syntax と Download all three に 4 と 5。空のモジュール欄が順序を説明し、**画面の部品が同じ順序を示します**。
- **初めての人が読む場所を全て日英併記に**: プリセット行のラベル(Kernel — カーネル など)、絞り込みの行、モジュール欄のタイトル。
- **モノクロのまま、質感と動きを**: セグメント型タブ、ホバーで浮くカードの影、押した感のあるボタン、角丸の統一、控えめなスクロールバー、見えるフォーカスリング。**ホームページにも同じトークン**(影・角丸・アプリのチップと揃えた手順の丸数字)を適用し、スクリーンショットも撮り直しました。
- 途中で1件修正: ボタンに `inline-flex` を与えたことで**非表示のボタンが空のピルとして描画**されていました。CSS の display 指定はブラウザの `[hidden]` 規則に勝つためで、`[hidden]` を `display: none` に固定するリセットを入れました。

### build 2026-08-12h

- **ファイルタブを切り替えるたびにヘッダーのボタン名が変わるのをやめました。** 主ボタンは `Download generated.nix` → `Download configuration.nix` → `Download flake.nix` → 書庫、と**1つのボタンで4つの意味**を持ち、しかも最後のタブでは `Download all three` を隠していました。**2つのダウンロードボタンが隣り合って席を入れ替えている**状態でした。
- **ヘッダーのダウンロードは `Download all three` の1つだけにし、主ボタン(青)にしました。** 5つの手順が最後に押すものなので、**出口に見えるボタン**がそれです。
- **Copy と `Download this file` は、ファイルタブの行に移しました。** 対象のファイルを選ぶタブの隣です。`all three` では単一ファイルが無いので、どちらも引っ込みます。**失われた経路はありません。** 手書き設定のマシン向けに `generated.nix` だけ取ることも、変わらず1クリックです。

### ドキュメント、2026-08-12b

- **両方の README から「毎回使うなら(任意)」の手順を削除しました。** プロファイルに入れることはマシンを動かす手順の一部ではなく、しかも**入れたコピーは固定される**ので、手で更新しない限り古いままになります(実際に何度か、古いビルドの原因になりました)。入口は `nix run github:hatake716/nixgen` の1つに揃えます。

### build 2026-08-12g

- **NVIDIA を選ぶと `nixpkgs.config.allowUnfree = true` も一緒に入ります。** ドライバが unfree のため、このプリセットの出力は**生成そのままではビルドできない唯一のもの**でした。いまは通ります(実システムとして評価済み)。スイッチが実際にファイルへ入ると、従来の警告は引っ込みます。
- **GPU を切り替えると、前の設定を掃除するようにしました。** これまで NVIDIA → AMD にしても `hardware.nvidia.*` と `videoDrivers = ["nvidia"]` が残り、**AMD の顔をした NVIDIA 構成**ができていました。外すのはプリセット自身が書いた値だけです。比較の際は nullable のラッパーを剥がします — `hardware.nvidia.open = false` は素の `false` と一致せず、どの切り替えでも生き残っていました。
- **`allowUnfree` が外れるのは、他に必要とするものが無いときだけです。** vscode や Steam なども unfree なので、一覧に残っていればカードは残り、どれが理由かをステータス欄が名指しします。

### 検証パス、2026-08-12

安定版と呼ぶ前の総点検です。**修正を要するバグは0件**でした。そう終わったのは初めてです。次回も同じ点検ができるよう、確認した内容を残します。

- **ゴールデンパスを通しで**: 全プリセット(カーネル・シェル・デスクトップ・グラフィックス・言語・地域・Flatpak)と検索からのパッケージ追加、Check syntax、書庫(3ファイル・ヘッダーに build id)、そして**書庫全体を NixOS システムとして評価**。NVIDIA は記載どおり `allowUnfree` の1行が必要で、これは設計どおりです(警告が表示され、どの再描画でも消えません)。
- **往復**: 生成した module を読み戻しても失われるものはなく、差分はすべて Nix の正規化で、結果はパースを通ります。
- **デスクトップ行列**: 9種を1セッションで順に選択。どの時点でもディスプレイマネージャはちょうど1つ、消し残しは蓄積せず、最後のファイルもパースを通ります。
- **壊れた入力**: 属性二重定義のファイルは読めて・名指しされて・1つに畳まれる。null の入力メソッド type は修復される。不正な API リクエストは 400。連打5回でも行は1つ。全カード削除で5つの手順が戻る。configuration.nix の取り込みは Setup 側に入り、module は空のまま。
- **見た目の規約**: 日本語の文中空白0件(アプリ・ホームページ)、7つのプルダウン全てが閉じた箱に収まる、320〜1800px で横スクロールなし。
- 固定ハーネス(`fuzz.py`、`import_check.py` の両リーダー)と flake ビルド。

### ドキュメント、2026-08-12

- **README のロゴが、読む人のテーマに追従するようになりました。** 原画は黒の線画なので、**GitHub のダークテーマでは沈んで見えません**でした。白版を並べて置き、`<picture>` で切り替えます。ダークでは白、ライトでは黒です。**白に差し替えるだけでは、今度はライトテーマで消えます。**
- **1つめの理由に、選べるデスクトップを名前で入れました。** GNOME・KDE Plasma・Xfce・Cinnamon・COSMIC・LXQt・i3、そしてシェルが最初から載った状態で出てくる Wayland コンポジタ2つ、Sway + noctalia と niri + noctalia です。**アプリのプルダウンと突き合わせて検査**しているので、提供していないものをページが名乗ることはありません。
- **ホームページと両方の README が、3つの理由から始まるようにしました。** 読む人が実際に判断する順序に合わせています。初回ログインから使えるデスクトップ、通しで整う日本語環境、そして**あなたが実行するまでマシンには何も起きない**こと。
- ホームページの見出しは **「インストール直後から、使えるマシンまで。」** です。3つの理由はヒーローの直下に、地色を変えた独立した帯として置きました。**ページ内で最も目立つ節**です。
- どの理由も、裏にある具体で支えています。シェルがアプリを起動するために要る PATH、どこにも書かれていない Wayland のキーボードレイアウト環境変数、この道具が意図的に持たない特権の口。**オプション数はヒーローに残し、看板にはしません。** あれは nixpkgs の数字で、この道具の成果ではないからです。

### build 2026-08-12d

- **取り込み時の誤警告を修正しました。** `nix.settings` の行を含むファイルを読み込むと「別のカードの中でも定義されています」と表示し、rebuild の失敗を予告していましたが、**そのファイルは問題なくビルドできます**。カタログは `nix.settings.cores` などを独立したオプションとして持つため、取り込みは畳まれた `nix.settings` カードの隣に leaf カードを必ず作ります。この入れ子は**同じキーが両方に無い限り合法な Nix**で、旧判定(パスだけを見る)はそれを確かめていませんでした。
- 判定が**実際のキー**を見るようにしました。leaf のキーが祖先カードの中に本当にあるとき(オブジェクトのキーとして、または verbatim ソース内の `key =` として)だけ警告し、それ以外は黙ります。両方向をブラウザで検証し、誤警告されていたファイルは実システムとして評価してすべての設定が効くことを確認しました。

### build 2026-08-12c

- **Sway と niri を選ぶと gnome-keyring が設定されるようになりました。** コンポジタには secret service が無く、資格情報を保存するもの — まずブラウザ — に保存先がありませんでした。デーモンが入り、**PAM がログインパスワードでキーリングを開く**ので、2つめのパスワードを聞かれることもありません。
- **PAM のスイッチは sddm 側ではなく `login` サービス側です。** sddm 側のスイッチは**何も変えない**ことが分かりました。生成される pam.d/sddm は `include login` の1行だけです。両方をビルドして実ファイルを読んで特定し、生成した module を評価して pam.d/login に pam_gnome_keyring の3行が入ることを確認しました。
- Sway ⇄ niri の切り替えではこの2枚は**ちょうど1組**のまま残り、GNOME や Plasma に切り替えると外れます。あちらは自前で配線しているためです。

### build 2026-08-12b

- **修正: 取り込んだ module の上で言語を選び直すと、`nixos-rebuild` がファイルを拒否していました。** ファイルを読み戻すと、フラットな `environment.sessionVariables.XKB_DEFAULT_LAYOUT = …` の行は**親オプションの属性セット**に畳まれます。その上で言語を選び直すと、フラットな行が**そのブロックの隣に**書かれ、同じ leaf の二重定義として `attribute … already defined` になります。読み戻されたファイルは**前回の修正自身の出力**で、それが実機に届いた経路です。
- フラットなカードを書くとき、**祖先の属性セットカードからも同名キーを取り除く**ようにしました。取り除くのはそのキーだけで、ブロックの他のキー(持ち込まれた `NIXOS_OZONE_WL` など)は残ります。実機の流れ(取り込み → niri へ切り替え → 日本語を選び直し)をそのまま再現し、結果を**実機と同じ nixpkgs リビジョンで評価**しました。定義は1つで、変数はセッション環境に入ります。

### build 2026-08-12a

- **Desktop のプルダウンの表記を、得られるものの名前にしました。** `Sway + noctalia` と `niri + noctalia` です。どちらも実機で、セッション・シェル・端末・キーボード配列まで**通しで動作確認済み**です。
- **Hyprland は非表示にしました。** キーボード配列も端末も警告バナーも、Hyprland が自前で書き出す設定ファイルが握っていて、**nixgen の書く設定を上書きします**。フォームだけでは「動くデスクトップ」を約束できないためです。Hyprland を含むファイルの**取り込みは従来どおり動き**、デスクトップ切り替え時の掃除もそのまま働きます。プリセットは削除ではなく非表示です。

### build 2026-08-11z

同じ sway マシンからの報告2件を修正しました。

- **修正: 旧ファイルを取り込んで Sway を選び直すと、`environment.etc."sway/config"` が二重定義になっていました。** 取り込まれた側は**平坦化された行**として届き、プリセットは**ブロック**を書いていたため、Nix が両者を拒否します。プリセットは**フラットな1行**(`environment.etc."sway/config".source = …`)を書くようにしました。この形は何とでもマージでき、読み戻しても同じ形に戻ります。復旧手順(壊れたファイルを取り込み → Sway を選び直す)を通しで再検証し、正しい sway 由来の定義が**1つだけ**出てくることを確認しました。
- **修正: 日本語設定のマシンが、sway に US 配列でログインしていました。** `services.xserver.xkb` は wlroots 系コンポジタには届きません。これらのキーマップは環境変数 `XKB_DEFAULT_LAYOUT` にフォールバックします(libxkbcommon のライブラリ実体で確認)。言語プリセットが `environment.sessionVariables` 経由でこれを設定するようにしました。PAM が全ログインに適用します。評価で、この変数が利用者自身の項目と並んでセッション環境に入ることを確認済みです。**Hyprland は例外**で、自動生成設定の `kb_layout = us` が環境変数に勝つため、注記でその旨を案内します。

### build 2026-08-11y

- **修正: sway が黒い画面のままになり、noctalia も起動しませんでした。** 昨日のバー除去は、差し替え設定を `pkgs.sway` から作っていました。ところが**それはモジュールがインストールする sway ではありません**。同じバージョンの別ビルドで、モジュール側(`isNixOS = true`)の設定には壁紙があり、末尾に `include /etc/sway/config.d/*` — **noctalia の起動元になる systemd 連携を読み込む行** — があります。素の `pkgs.sway` は**その両方を持たないようにパッチ**されています。そのため差し替え後は壁紙が無く(黒画面)、include も無い(セッション target が立たず、シェルも起動しない)状態でした。nixpkgs のパッチファイルにそのまま書かれており、そこから特定しました。
- 差し替えは `config.programs.sway.package` から作るようにしました。**ピン留めリビジョンと報告元マシンのリビジョンの両方でビルドして確認**: include と壁紙が戻り、バーのブロックは消え、キー割り当て75行は全て残ります。

### build 2026-08-11x

- **sway でバーが2つ出なくなりました。** sway 自身の設定の末尾に、時計付きの swaybar を起動する `bar { }` ブロックがあり、noctalia のパネルの上に並んでいました。これを消すオプションは無いので、プリセットが `/etc/sway/config` を**パッケージ同梱のものからそのブロックだけを除いたもの**に差し替えます(`environment.etc."sway/config"`。NixOS はこれを `mkOptionDefault` で設定しているので、衝突ではなく上書きになります)。
- **消えるのはその13行だけです。** 生成結果をビルドしてパッケージ同梱の設定と差分を取り、**バーのブロックだけが消え、キー割り当て75行は全て残る**ことを確認しました(`$mod+Return` も含みます)。別のデスクトップを選べばこのカードも外れます。

### build 2026-08-11v

- **Hyprland のプリセットが、画面上部に出る警告について説明するようにしました。** `You're using an autogenerated config! Edit the config file to get rid of this message.` は **Hyprland 自身**が出しているもので、故障でも noctalia でもありません。初回ログイン時に自分の設定ファイルをホームへ書き出し、それを編集するまで表示し続けます。NixOS のオプションでは消せないので、**削除すべき行**(`autogenerated = true`)と、端末・ランチャーのキー割り当てを注記に書きました。
- 推測ではなく実体バイナリから読み出しました。その過程で前ビルドの変更も裏付けられました。Hyprland が埋め込んでいる設定は `local terminal = "kitty"` です。

### build 2026-08-11u

- **Hyprland に入れる端末を `foot` から `kitty` に変えました。** Hyprland の既定設定は **kitty を名指し**するため、foot が入っているマシンでは端末のキー割り当てが何も開きませんでした(パッケージには読み取れる設定ファイルが同梱されていないので、実際に動かして分かったことです)。niri は foot のままです。そちらでは動いています。
- この2つを行き来すると**端末だけが入れ替わり**、noctalia-shell は残ります。掃除は「新しいデスクトップも必要とするもの」は外さないためです。

### build 2026-08-11t

- **修正: 壊れたファイルを読み戻せませんでした。** 属性の二重定義は Nix では**構文エラー**で、`nix-instantiate --parse` がファイルごと拒否します。取り込みは Nix に読ませる仕組みなので、そこで諦めて「そのファイルを読めませんでした」としか言えませんでした。ファイルの残りは利用者の設定であり、拒否することは**復旧手段を断つこと**でした。
- **このエラーに限って、Nix を使わず直接読む**ようにしました。取り込みサマリには、二重になっていた属性名を**英日併記**で出します。他のエラーでは従来どおり中止します。壊れたファイルを推測で読むことが、生成物が静かに誤る原因だからです。
- **読み込むこと自体が修復になります。** フォームは1属性につき1枚しか持てないので、2つの定義は1つに畳まれます(上から読んでいった人が取るのと同じく、後のほうを採ります)。出てくるファイルはビルドできます。NixOS システムとして評価して確認しました。
- **build 2026-08-11r の記述を訂正します。** 「Check syntax では捕まえられない」と書きましたが、**捕まえられます。** 失敗するのは評価ではなくパーサなので、rebuild より先に Check syntax が指摘できました。

### build 2026-08-11r

実機からの報告2件。クラッシュ1つと、消え残り1つです。

- **修正: `attribute 'systemd.user.services.noctalia-shell.after' already defined`。** このユニットは module に**2つの形**で入ります。プリセットが書くと属性セット1枚、ファイルから読み戻すと**leaf ごとに1枚**です。取り込みの後にコンポジタを選ぶと、両方が同時に出ていました。Nix はこれを同じ属性の二重定義として扱います。どちらの形も名前で認識し、一方を書くときに他方を消すようにしました。
- **修正: 前のデスクトップのパッケージが残っていました。** niri から GNOME に切り替えても noctalia-shell・xwayland-satellite・foot が入ったままでした。外すようにし、何を外したかはステータス欄に出します。ただし**新しいデスクトップも必要とするものは残します**。Hyprland と niri を行き来しても foot は消えません。
- **追加: 別のカードの内側で定義されている場合に警告します。** あるパスが別のパスの下にある状態は、どのオプションでも同じクラッシュになるので、rebuild が言う前に `doRender` が言います。

### build 2026-08-11q

- **修正: シェルは起動するのに、そこからアプリが起動できませんでした。** NixOS の user service には `PATH=coreutils:findutils:…` だけが与えられるため、noctalia は立ち上がっても**自分が一覧に出したアプリを1つも起動できません**でした。niri を動かしている実機からの報告です。
- ユニットがこの既定を外し、**PATH を自分で書く**ようにしました(wrappers、ユーザーごとのプロファイル、既定プロファイル、現在のシステム)。nixpkgs の niri モジュールもまさにこの理由で既定を外していますが、**外すだけで足りるのはセッションが使える PATH を user manager に残している場合だけ**で、3つは揃っていません。niri-session は取り込みますが、sway は DISPLAY/WAYLAND_DISPLAY/SWAYSOCK しか取り込まず、Hyprland の `systemd.setPath` は 0.41.2 より上では既定で無効です。そのため継承ではなく明示しました。
- 3つとも評価して確認しました。coreutils だけの PATH は消え、使える PATH が1つ入っています。

### build 2026-08-11p

Sway・niri・Hyprland が、ログインした時点で使える状態になりました。

- **noctalia-shell がセッションと一緒に起動します。** 3つとも `graphical-session.target` に紐づけた user service を書くようにしました。パネル・ランチャー・通知がひとりでに立ち上がります。**誰も起動しないシェルは、ストアに置かれているだけ**でした。
- **3つともこの target に到達することを確かめました。** ユニットが実際に動くかを決めるのはここです。sway は既定設定が `sway-session.target` を起動し、それがこの target に `bindsTo` しています。niri は自前のユニットを同梱しています。**Hyprland は UWSM を通してしか到達しない**ので、プリセットで `programs.hyprland.withUWSM` を有効にし、セッション名も `hyprland-uwsm` にしました。3つとも、このユニットを入れた状態で評価済みです。
- **Hyprland と niri には `foot` も入れます。** どちらも端末を1つも持たず、既定のキー割り当てで開く先がありませんでした(評価済みシステムから読み出した事実で、推測ではありません)。sway は foot と wmenu を、i3 は xterm と dmenu を既に持っています。
- ユニットは**パッケージが実在したときだけ**書き、カードの他のキーは**置き換えずに残し**、デスクトップを切り替えると外れます。

### build 2026-08-11o

- **入力メソッドが有効なのに何も選ばれていない場合、fcitx5 を入れる**ようにしました。ビルドできないファイルについて警告するのではなく、直します。日本語・韓国語・中国語は入力メソッド無しには打てず、fcitx5 はこの3つのプリセットが既に使っているエンジンです。
- ファイルを書く直前に動くので、**その状態に至る経路をすべて覆います。** 検索欄からの追加、2種類の取り込み、カードを null に編集し直した場合。壊れた `generated.nix` を読み戻すと**直った状態で出てきます**。その結果を、クラッシュの報告元のリビジョンで評価して確認しました。
- **埋めるのは空欄のときだけです。** `type` に ibus が入っていればそれはその人の選択なので触れません(テスト済み)。埋めた場合はステータス欄でお知らせします。

### build 2026-08-11n

- **同じクラッシュの3つめの経路 `i18n.inputMethod.type = null;` を修正しました。** このオプションは `null or one of …` なので、ファイルは **type を明示的な null として持ち運べます**。画面上は決定が書かれているように見えて、実際には何も選んでいない行です。2つ前のビルドで入れた判定は「その項目が**あるか**」を見ていて「**何を持っているか**」を見ていなかったため、読み込まれた null はすり抜け、`nixos-rebuild` は以前とまったく同じように失敗しました。実機からの報告で、そうしたファイルを取り込んで再現しました。
- 判定を**値**に対して行うようにし、メッセージも「無い場合」と「null の場合」の両方を挙げるようにしました。自分のファイルを見た人には `type` の行が見えていて、設定済みだと考えるのが自然だからです。言語を選び直せば、その場で直ります。

### build 2026-08-11m

- **生成ファイルが、どの nixgen で作られたかを記すようになりました。** ヘッダーにチャンネルと日時と並べて build id が入ります。
- **これを入れた理由**: 入力メソッドのクラッシュが2度目の報告として届きましたが、そのファイルは**修正済みの nixgen では書けない形**でした。Nix は `github:` の参照を1時間キャッシュし、`nix profile install` は固定するので、**「修正が入っている」ことと「実行したものが修正版である」ことは別の事実**です。そしてファイルにはそれを示すものが何もありませんでした。区別するために、報告者自身の nixpkgs リビジョンで両方の形を評価する必要がありました。ヘッダーがあれば一目で済みます。
- 値はクライアントから届き、利用者が保管するファイルに書き込まれるので、**固定のパターンと照合してから**入れます。
- 調査の過程で確認: 現在の出力は報告元のリビジョンで問題なくビルドされ、壊れたファイルを読み戻すと警告が出ます。

### build 2026-08-11l

- **`not of type 'package'` でビルドに失敗しうる生成物を修正しました。** 言語プリセットは `i18n.inputMethod.enable` と `i18n.inputMethod.type` を**別々の手順**で書いており、2つめが入らないと `enable` だけが残り、モジュールが `environment.systemPackages` に null を押し込み、`nixos-rebuild` が原因とは無関係な systemd を指すエラーで落ちていました。実機からの報告です。
- この2つを**一体**で書くようにしました。入力メソッドを先に確定し、`enable` は現在のインターフェースがそれを使う場合だけ足します。CJK の言語は必ず両方書くか、どちらも書かないかになります。
- 保険として `doRender` にも判定を入れました。検索欄から `i18n.inputMethod.enable` を単体で有効にした場合や、type の無いファイルを読み込んだ場合に、ビルド前にステータス欄で警告します。
- クラッシュの再現と、修正後の生成物が通ることを、実際の NixOS システムとして確認しました。

### build 2026-08-11k

- **デスクトップを切り替えると、ディスプレイマネージャが入れ替わるようにしました。** NixOS は DM の2つ同時を受け付けません。gdm のモジュールが他を強制無効化するため、**前のデスクトップの lightdm が残っていると `conflicting definition values` でビルドエラー**でした(まさにその状態を評価して確認)。新しいデスクトップを選ぶと、それ以外のグリーターは module から外れます。sddm は Wayland スイッチも道連れにし、**何を外したかはステータス欄に出ます。**
- **デスクトップ本体は両方残します。** 1つのログイン画面に2つのセッションは正当で、その状態の評価でセッション一覧に両方が並ぶことも確認しました。外すのは **nixgen のプリセット自身が書くパスだけ**で、手で有効化された別名のグリーターには触れません。

### build 2026-08-11j

- **入力メソッドがセッションに追従するようになりました。** fcitx5 には2つのフロントエンドがあり、**間違ったほうは中途半端に動きます**(Wayland セッションで X11 側のままだと、ネイティブなアプリの入力が乱れます)。CJK の言語を選ぶと、module にあるデスクトップに合わせて `i18n.inputMethod.fcitx5.waylandFrontend` が設定され、**後から別のデスクトップを選ぶと同じカードが切り替わります。** GNOME・Plasma・COSMIC・Hyprland・Sway・niri で有効、Xfce・Cinnamon・LXQt・i3 で無効です。
- デスクトップ未選択なら何も書きません。後から選んだ時点で設定されます。入力メソッドの無い言語には触れません。
- **両方向を実システムとして評価しました。** Wayland フロントエンド有効時は `GTK_IM_MODULE`・`QT_IM_MODULE` が外れてアプリは text-input プロトコルを使い、無効時は両方とも `fcitx` になります。

### build 2026-08-11i

- **デスクトップを選ぶと、ログイン画面でもそのデスクトップが最初から選択されるようにしました。** 各プリセットが `services.displayManager.defaultSession` を設定します(`gnome`、`xfce`、i3 は `none+i3` など)。後から別のデスクトップを選ぶと、**行が増えるのではなく同じ値が書き換わります。**
- **セッション名は推測ではなく、評価済みシステムから読み出しました。** NixOS はビルド時に実在するセッション一覧と照合し、**間違った名前はビルドごと失敗します**。それが本当に働くことも、わざと誤名を与えて確認しました。9種すべて、この設定を入れた状態で評価済みです。
- **COSMIC には設定しません。意図的です。** `defaultSession` が効くのは GDM・LightDM・SDDM だけで、COSMIC 自前のログイン画面は唯一のセッションを最初から表示します。

### build 2026-08-11h

- **取り込みボタン2つの位置を入れ替えました。** Import generated.nix が先、Import configuration.nix が後になります。

### build 2026-08-11g

アプリ全体のデバッグを行いました。修正は2件、それ以外はすべて健全でした。

- **修正: `let` 束縛のある configuration.nix を読み込んでも警告が出ませんでした。** nixgen は式である値を書かれたとおりに写しますが、それが依存する `let` は写しません。そのため `let` の名前を参照していた行が未定義変数を参照する状態になり、Check syntax が理由なく指摘していました。取り込みサマリで、どの値が式かを挙げて**事前に警告**するようにしました。
- **修正: Check syntax のエラーが常に `generated.nix` という名前で出ていました。** configuration.nix を検査したときに別のファイル名で誤って報告していたので、**いま見ているファイルの名前**を出すようにしました。名前はメッセージに入れる前に固定の集合と照合します。
- 検証して健全と確認: 一連の往復(組み立て→書庫→両ファイルを読み戻す)、設定が入った状態でのチャンネル切替、引用符付きパス・負数・`mkIf`・非ASCII名・ドット付きパッケージだらけのファイルの取り込み、プリセットの連打、全カード削除、インデックス削除経路(使用中DB・パス状の名前・提供中チャンネルを拒否)、変わったホスト名での System update コマンド。通常操作でクラッシュ・コンソールエラー・4xx はありません。

### build 2026-08-11e

ドキュメントを、初めて使う人の目線で書き直しました。

- **READMEのインストール節が、最初から最後まで一本道になりました。** flakes を有効にする → nixgen を起動する → ブラウザで設定を組み立てる(入力欄ごとの具体的な初回例) → ファイルをマシンに載せる → rebuild、の順です。これまでのステップ4は、**Download all three ができる前の**「generated.nix を1つ受け取って imports を手で書き足す」手順のままでした。その方法も残してありますが、既定ではなく「手書きの設定を使い続ける場合」の分岐になりました。
- **アプリ内の5つの手順を、1手順=1動作にしました。** ファイル配置図は手順1から手順5へ移しました。あの図は「ファイルがどこに置かれるか」を示すもので、ファイルが手元に来るのは手順5だからです。手順2はプルダウンを先に案内します。初めての人が最初に触るべき場所だからです。
- **ホームページの「進める順序」の節だけで、通しの手順が完結するようにしました。** 最初に実行するもの、5つの手順、受け取った書庫を適用する3コマンドです。英日両方で、詳しい版へのリンクはREADMEに向けています。

### build 2026-08-11d

- **ホームページのヘッダーも、描き起こしではなく原画そのもの**になりました。高さは50ピクセルです。**HiDPIでない画面でも細部が保つのがこの辺り**だからで、26では潰れ、40でもまだ粗いことを、**1倍と2倍の両方で描画して確かめました。**
- アプリのヘッダーは結晶だけの図のままです。あちらは22ピクセルで、**この原画を22ピクセルで読める形にする方法はありません。**

### build 2026-08-11c

- **原画そのものを、アプリ・ホームページ・両方のREADMEの冒頭に入れました。** 余白を切り落として透過にし、9.6KBです。アプリは `/logo.png` で配信し、5つの手順の上に表示します。ホームページの冒頭も、描き起こしではなく**原画**になりました。
- **ヘッダーと favicon は結晶だけの図を使い続けます。** 好みではなく実測です。**原画は48ピクセルで灰色に潰れ**、ヘッダーが必要とするのは22ピクセルです。**同じ意匠を2段階の精細さで持つ**ことが、両方のサイズで使うロゴには必要になります。

### build 2026-08-11b

- **ロゴマークをアプリとホームページに入れ、配色もそれに合わせました。** 六角形の核を持つ雪の結晶が、両方のヘッダーでワードマークの隣に並びます。**favicon も同じ絵**です。
- **青をやめました。** ロゴが白地に黒なので、アクセント色も**インク**にしています(主ボタン、選択中のタブ、チップ)。検索の一致箇所は青い文字でしたが、**淡い地色**に変えました。モノクロで見分けをつけるにはこうする必要があります。
- **同じ絵の2つの形を使い分けます。** ホームページの冒頭は**全体**(弧と散らばる図形まで)、ヘッダーと favicon は**結晶だけを太い線で**描いたものです。全体を22ピクセルにすると潰れます。これは推測ではなく、**実際に描画して確かめました。**
- 作図は `tools/mark.py` が行います。**手で描いた6本の腕は6本とも少しずつ違うもの**になりますし、2つのページと favicon に貼り付けたマークは**やがてずれます**。`tools/shots.py` と同じ理屈です。

### build 2026-08-11a

- **Wayland のコンポジタ3つで XWayland を有効にしました。** X11 のアプリが動くようにするためです。Hyprland と Sway にはオプションがあるので設定します。**既定値も有効**ですが、カードとして残ることで、**どちらに設定されているかがファイルに書かれている**状態になります。
- **niri にはこのオプションがありません。** XWayland を内蔵していないためで、代わりに `xwayland-satellite` をパッケージとして入れます。設定ファイルでできるのは**入れるところまで**です。**起動は niri の設定ファイルから行う必要があり**、その旨をステータス欄に出します。
- 索引と同じリビジョンで評価しました。Hyprland と Sway のシステムには `xwayland-24.1.13`、niri には `xwayland-satellite-0.8.1` が入ります。

### build 2026-08-10z

- **取り込みが2つになりました。ファイルごとに1つです。** **Import configuration.nix** は、このマシン自身のファイルを、nixgen が書く `configuration.nix` に読み込みます。Setup の入力欄が持てるものはそちらへ、`imports` は統合し、**それ以外はすべて同じファイルに、出どころを書いたコメント付きでそのまま写します。** module には触れません。
- **Import generated.nix** は逆向きです。module を module に読み戻します。もともとそこから出てきたものだからです。タブを閉じて失った入力内容は、この往復で戻せます。
- これまでは `configuration.nix` を読むと**module のほうに**入っていました。動いてはいましたが、**2つあるファイルのうち間違ったほう**に入れていたことになります。
- 写した行は、赤い「configuration.nix にもあります」の判定対象に入れてあります。あとから **Options** で同じ項目を足すと、黙って二重定義になるのではなく、その旨が出ます。

### build 2026-08-10x

- **System update ボタンを追加しました。** ヘッダーの右端で、**マシンそのものを変える唯一のボタン**です。各段階の前に3回確認します。ブラウザで内容を確認してから書庫をダウンロードし、コマンドが `/etc/nixos` を上書きする前と、`nixos-rebuild switch` の前に、それぞれ確認します。
- **処理そのものは行わず、コマンドを渡します。** nixgen のサーバーには認証がなく、`/etc/nixos` を上書きして再構築できる口を開けると、**同じブラウザで開いている任意のページから叩ける**ことになるためです。コマンドはクリップボードにコピーします。
- **ダウンロード先は決め打ちせず、探します。** まず `xdg-user-dir`、次に `Downloads` と `ダウンロード`、最後にホームディレクトリです。**bash・zsh・fish のすべてから試しました。** あるシェルで貼って動くものが、別のシェルでも動くとは限らないためです。
- **置き換えたファイルは残します。** `configuration.nix.~1~` のような名前で新しいものの隣に残ります。`hardware-configuration.nix` は書庫にも入らず、コマンドも名前を出しません。**代わりのディレクトリを用意して一連の動作を実際に走らせて確認**しました。
- 5つの手順にも注意書きを追加しました。**設定をすべて終えて Check syntax を通してから**使うこと、**マシンが起動に使う設定を置き換える**ことを明記しています。

### build 2026-08-10w

- **Hyprland・Sway・niri を選ぶと、ログイン画面まで揃うようにしました。** sddm と `services.displayManager.sddm.wayland.enable` が一緒に入ります。3つのどれを選んでも、**テキストコンソールではなくログイン画面が起動**し、セッション一覧にそのコンポジタが並びます。
- **効いているのは2つめのオプションです。設定ファイルを両方ビルドして確かめました。** 有効なら sddm の設定は `DisplayServer=wayland` になり、ログイン画面は weston の上で動きます。無効だと `DisplayServer=x11` で、**他に何もXを使わないマシンの前にX11のログイン画面だけが立ちます。**
- `services.xserver.enable` は入れません。これらのシステムでは他に誰も必要としないからです。**実際の NixOS システムとして評価**し、ディスプレイマネージャが有効・Xは無効・セッション一覧に `hyprland-0.55.4` / `sway-1.12` / `niri-26.04` が入ることを確認しています。
- テキストコンソールから起動したい場合や `greetd` を使いたい場合は、**カードを2枚削除**するだけです。どれを消せばよいかもステータス欄に出ます。

### build 2026-08-10v

- **Hyprland と Sway でも `noctalia-shell` が一緒に入る**ようにしました。niri と同じ扱いです。3つともコンポジタそのものだけで、パネル・ランチャー・通知を載せるのが noctalia です。他の6つは自前で持っているので、何も足しません。
- 2つとも索引と同じリビジョンで**実際の NixOS システムとして評価**しました。`hyprland-0.55.4` や `sway-1.12` と並んで `noctalia-shell-4.7.6` が入ります。

### build 2026-08-10u

- **niri を選ぶと `noctalia-shell` も一緒に入ります。** niri はコンポジタそのものだけで、**パネルもランチャーも通知もありません。** noctalia はその上に載せる部分です。設定ではなく**パッケージ**(オプションのカタログには何もありません)なので、`environment.systemPackages` に**目に見える1行**として入り、削除もできます。
- 名前は**先にパッケージ索引で照合**します。アプリのカテゴリと同じ方式です。これが無いチャンネルでは、`nixos-rebuild` で失敗する行を書くのではなく**何も書きません。**
- **実際の NixOS システムとして評価**しました。セッションは `niri-26.04`、システムのパッケージに `noctalia-shell-4.7.6` が入ります。

### build 2026-08-10t

- **Shell のプルダウンを追加しました。** 位置は Kernel と Desktop の間で、bash・zsh・fish から選べます。
- **書き込むのは2項目で、忘れられがちなのは2つめ**です。`users.defaultUserShell` だけでは、そのシェルは **`/etc/shells` に載らず補完も入りません**。登録するのは `programs.zsh.enable` と `programs.fish.enable` です。**両方を実際のシステムとして評価**しました。module があると `environment.shells` に `zsh` や `fish` が入り、無いとユーザーのシェルだけが変わって一覧は bash と sh のままです。
- bash には `pkgs.bash` ではなく **`pkgs.bashInteractive`** を指定します。前者は readline 無しのビルドです。`users.defaultUserShell` の型は `absolute path or package` なので、カーネルと同じく**編集できる入力欄に Nix の式**として入ります。
- ステータス欄には、この設定が**通常アカウント全部**に効くこと(1人だけではないこと)も出します。

### build 2026-08-10s

- **niri も追加しました。** スクロール式タイリングの Wayland コンポジタです。デスクトップは10種類になりました。Hyprland や Sway と同じく**1項目のみで、ログイン画面は付けません。**
- niri のモジュールは**自前で portal を用意します**。Flatpak の行で入る GTK 版が無くても、Flatpak や画面共有が動きます。**X11 のアプリを動かすには `xwayland-satellite` が必要**で、これは設定ではなく**パッケージ**です。フォームのどのオプションにも当たらないので、ステータス欄で案内します。
- 索引と同じリビジョンで**実際の NixOS システムとして評価**しました。セッションは `niri-26.04` として登録されます。

### build 2026-08-10r

- **Desktop のプルダウンに4つ追加しました。** LXQt・Hyprland・Sway・i3 です。全部で9つになりました。
- **LXQt** はこれまでと同じ3項目(X・sddm・デスクトップ本体)です。`xfce` や `cinnamon` と同じく、**`services.xserver` の外には移っていません。** **i3** も3項目で、3つめがウィンドウマネージャになります。**タイル型の見た目や操作は一切決めていません。** 何も無い画面で起動し、初回に設定ファイルを作るか尋ねてきます。
- **Hyprland と Sway は1項目ずつで、ログイン画面は付けません。** どちらも自前では持っておらず、sddm や greetd を代わりに選ぶのは**マシンの起動の仕方を決めてしまう**ことになります。コンポジタが必要としている設定ではないので、**フォームが決めるのではなくステータス欄で案内**します。
- 4つとも索引と同じリビジョンで**実際の NixOS システムとして評価**しました。セッションもそれぞれ正しく登録されます(`lxqt-xsession`、`hyprland-0.55.4`、`sway-1.12`、`none+i3-xsession`)。

### build 2026-08-10q

- **Options タブに Flatpak の行を追加しました。** プルダウンはありません(**有効か無効かのどちらか**です)。**Add** を押すと `services.flatpak.enable`、`xdg.portal.enable`、`xdg.portal.extraPortals` の `xdg-desktop-portal-gtk` が入ります。
- **見落とされがちなのは portal のほうです。** Flatpak のアプリは xdg portal を通してシステムの外とやり取りするため、`services.flatpak.enable` だけでは**ファイル選択ダイアログも画面共有も出ない**アプリになります。GNOME と Plasma は自前のバックエンドを持つので、そこでは GTK 版は予備です。不要ならカードを削除できます。
- **設定では代われない手順も1つ**あります。インストール直後はリモートが無いため、rebuild のあとに一度だけ実行する `flatpak remote-add … flathub` をステータス欄に表示します。
- 索引と同じリビジョンで**実際の NixOS システムとして評価**しました。systemd のパッケージに flatpak が入り、portal が有効になり、`xdg-desktop-portal-gtk` が一覧に入ることを確認しています。

### build 2026-08-10p

- **3つ追加しました。** 12分野189パッケージになりました。`localsend` は**チャット・同期**へ(`warpinator` と同じ用途で、対応する機器の幅が広いものです)。`virtualbox` は**システムツール**へ。`tradingview` は**オフィスソフト**へ入れました。これは **unfree** で、その表示も出ます。
- **`virtualbox` はパッケージだけでは仮想マシンを起動できません。** そのため、追加すると**残りがどこにあるか**を表示します。カーネルモジュールを用意し `vboxusers` グループに入れるのは、**Options** タブの `virtualisation.virtualbox.host.enable` です。Steam の案内と同じく、**レンダリングのたびに作り直す**ので、一度出して消えることはありません。
- この案内と Steam の案内は、**グレーアウトの判定と同じ方法**でパッケージ一覧を読むようにしました。そのまま転記されたリストでも表示されます。

### build 2026-08-10o

- **アプリが出すメッセージを、すべて英語と日本語の併記にしました。** module の上に出る通知と、ファイルの下のステータス欄です。英語が先、その**下の行に日本語**を置いています。プルダウンの選択肢と違ってこちらは文章なので、1行に押し込まず**上下に並べて**います。
- **Nix のパーサーの出力は、そのままの言葉で残します。** **Check syntax** が失敗したときは、両方の言語で前置きを出したうえで**パーサーの出力をそのまま引用**します。あれは Nix 自身の言葉であり、**エラーを検索する人には実際に表示される文字列が必要**だからです。

### build 2026-08-10n

- **プリセットが、候補の綴りをまとめて1回で問い合わせ、存在するものだけを受け取る**ようにしました。アプリ分野のパッケージ照合と同じやり方です。これまでは候補を1つずつ試していたため、**そのリリースが使わない名前**(26.05 における `services.displayManager.lightdm.enable` など)が404を返し、**失敗ではないものが失敗としてブラウザのコンソールに出て**いました。**通常の操作で404を返す箇所は無くなり**、コンソールを読む価値が戻りました。
- 見つかったものは**その場で使います**。もう一度問い合わせることはしません。

### build 2026-08-10m

全体をもう一度、読むのではなく**動かして**点検しました。

- **修正：Setup タブを開いたままファイルを読み込むと例外が出ていました。** module を変える操作はすべて結果一覧を描き直しますが、このタブでは検索が `kind=setup` を要求し、サーバーはそれに**オプションを返します**。それが**パッケージ用の描画**に渡っていました。以前は誰にも見えない場所に何かを描くだけでしたが、**アイコンのために `attr` を読むようになってから例外**になり、取り込み処理の残りが実行されずに終わっていました。
- **修正：一覧が、存在しないアイコンまで要求していました。** アイコンの無いパッケージごとに404が出ます。**検索1回で128件**、「失敗ではない失敗」でコンソールが埋まる状態でした。各行が**アイコンの有無を持つ**ようにして、**あるものだけ**要求します。
- **修正：アイコンの索引を複数のスレッドが同時に作っていました。** 最初の一覧が行のぶんだけまとめて要求し、サーバーはスレッド式なので、**同じ地図を6本ほどのスレッドが並行して**作っていました。
- それ以外も再実行しています。2チャンネルでのプリセット、設定が入った状態への取り込み、書庫と画面の一致、レンダリング失敗、起動失敗、壊れたリクエスト16種、320〜1800pxの表示です。

### build 2026-08-10k

- **`environment.systemPackages` に既に入っているパッケージは、一覧でグレーアウトします。** 分野から選んだときも検索結果でも同じで、追加済みのオプションと同じ扱いです。**クリックすると、そのパッケージが入っているカードへ移動**します。何も起きないということはありません。
- 判定は**クリックした履歴ではなく module の中身**を見ています。カードから削除しても、入力欄で手で書き換えても、一覧の表示がそれに追従します。**そのまま転記されたリストも対象**です。`with pkgs; [ ripgrep ]` と `pkgs.ripgrep` は、書き方が違うだけで同じパッケージだからです。
- **修正：分野から最初の1つを追加すると、その分野の一覧が消えていました。** 追加すると一覧が描き直されるのですが、描き直す処理が**検索欄のことしか知らなかった**ためです。ゲームを選んで Steam を押すと、無関係な一覧が表示される状態でした。

### build 2026-08-10j

- **開発カテゴリに `ollama` を追加しました。** `lmstudio` の隣です。同じことをコマンドラインから行うもので、**こちらは unfree ではありません。** 12分野186パッケージになりました。
- **`ollama-cuda` や `ollama-rocm` ではなく `ollama`** です。**どのアクセラレータを積んでいるかはマシン固有の話**で、この一覧が扱わないことにしている領域です。素の build はどの環境でも動きます。なお **Options** タブには `services.ollama.enable` もあり、**システムのサービスとして動かす**こともできます。

### build 2026-08-10i

- **開発カテゴリに `lmstudio` を追加しました。** ローカルで言語モデルを動かすデスクトップアプリです。12分野185パッケージになりました。
- **unfree** なので、行にもステータス欄にもその表示が出ます。`nixpkgs.config.allowUnfree = true;` が無いと**ビルドが拒否されます**。この環境のアイコンテーマには該当するアイコンが無いため、**頭文字のタイル**になります。欠けているのではなく、**代替表示が働いている**状態です。

### build 2026-08-10h

- **開発カテゴリに `vscode` を追加しました。** `vscodium` の隣です。12分野184パッケージになり、うち143個にアイコンが出ます(この環境の場合)。
- 中身は同じエディタです。`vscodium` は**同じソースから、Microsoftのブランドとテレメトリを外して**ビルドしたもの、`vscode` は**Microsoft自身のビルドで unfree** です。行にもその表示が出ますし、ステータス欄にも改めて出ます。`nixpkgs.config.allowUnfree = true;` が無いと**ビルドが拒否される**ためです。

### build 2026-08-10g

- **パッケージ一覧にアイコンを表示するようにしました。** 分野から選んだときも、検索結果でも同じです。
- **取得元は、そのマシンに既に入っているアイコンテーマ**です(システムのパス、ユーザープロファイル、`XDG_DATA_DIRS`)。**何もダウンロードせず、nixgenの依存も増えません。** 引き換えの条件は隠さず書いておきます。**表示される数は、何が入っているかで変わります。** 作者のマシンでは、一覧の183個中142個にアイコンが出ます。素のインストールではもっと少なくなります。
- **アイコンが無いものには頭文字**を出します。色は名前から決まるので、**同じパッケージはいつも同じ色**です。空の四角が並ぶことはありません。`tmux` や `gcc` はそもそもどこにもアイコンが無く、灰色の四角を並べても意味がないからです。

### build 2026-08-10f

- **configuration.nix を読み込むと、Setup タブに反映されるようにしました。** ホスト名、ユーザーとそのグループ、アーキテクチャ、ブートローダー(GRUBならディスクも)、NetworkManager、flakesの有無、`system.stateVersion` が、**いま読み込んだファイルの内容**になります。読み込んだのに Setup タブが `nixos` という名前のマシンの話をしたまま、ということがなくなりました。
- **これらの項目は、コピーではなく移動します。** Setup タブの入力欄であり、スターターの `configuration.nix` が書くものだからです。moduleにもカードを残すと、**同じ属性が2つのファイルに書かれる**ことになります。どれが移ったかは取り込みサマリに一覧で出ます。それ以外はすべて module に残ります。
- 値の形は推測せず、実際に読んで合わせました。`nixpkgs.hostPlatform` は union なので**引用符が付いたままのNixソース**として届きます。flakesは `nix.settings` の中にあり、これは**キーごとにNixソースを持つ1つのattrsオプション**です。**このカードが移るのは experimental-features しか入っていないときだけ**にしました。他人の substituters は Setup タブに置くものではありませんし、隣のキー1つのために取り上げれば**それらも一緒に持って行ってしまう**からです。

### build 2026-08-10e

不具合5件を修正しました。いずれもコードを読んで見つけたものではなく、**実際にアプリを操作して**見つけたものです。最初の2件は、**画面の内容と違うファイルを渡していました。**

- **ダウンロードしたファイルが、1回分の編集より古いことがありました。** レンダリングは遅延実行でサーバー側で行われるため、キーを打った直後の一瞬は**手元にあるのが1つ前のファイル**です。ホスト名を入力してすぐ **Download all three** を押すと、**画面と一致しない書庫**が出ていました。2つのダウンロードと Copy、Check syntax は、**そのキー入力が要求したレンダリングを待ってから**動くようにしました。
- **レンダリングの失敗が見えませんでした。** `/api/render` が失敗すると、画面には**最後に成功したファイル**が残り、どのボタンもそれを渡していました。今は**その旨を表示し、成功するまで何も渡しません。**
- **設定が入っている状態でファイルを読み込むと、NixOSが拒否するファイルが出来ていました。** 1つの属性に2枚のカードがある状態で、`error: attribute 'services.openssh.enable' already defined` になります。**同じファイルを2回読み込むだけで再現しました。** 読み込んだファイルの内容が既存を**置き換える**ようにし、置き換えた項目は取り込みサマリに一覧で出します。別経路で重複が生じた場合に備え、**レンダリングのたびに検出して報告**する二重の防御も入れました。
- **読み込み中にリクエストが1つ失敗すると、画面が空のままでした。** Setup タブは起動処理の最後に表示されるため、途中で1つ失敗すると(サーバーがまだ起動中、インデックス切り替え中など)**空の列と無言**が残っていました。今は**何が起きたかと、再読み込みすればよいこと**を表示します。
- **不正なリクエストで接続が切れていました。** JSONでない本文や型の違うフィールドがハンドラまで届いて例外になり、ターミナルにトレースバック、ブラウザには何も返らない状態でした。**400とメッセージ**を返すようにしました。スターターファイルが用意できていない状態で**書庫を作ることもできなくなりました。**

### ドキュメント 2026-08-10

- **READMEを、実際に使う順序どおりに並べ替えました。** 内容ごとの分類だったため、**スターターファイルの説明がプルダウンの後**に来ており、アプリが最初に開くタブの説明が**8番目**にありました。各節は所属するタブの名前になり(Setup・Options・Packages・Check syntax・Download all three)、その順に並んでいます。
- **ホームページも、最初のスクリーンショットの直後に同じ5手順を置きました。** 英語・日本語の両方です。
- **ホームページの日本語に出ていた空白35箇所を消しました。** 日本語と日本語の間の改行は空白文字で、ブラウザはそれを**スペースとして描画します**。このページは英文と同じ感覚で折り返されたまま書かれていました。**実際に描画しないと分からない**種類の問題で、ソースを読んでも気づけません。

### build 2026-08-10c

- **5つの手順を、そのまま進める順序に組み替えました。** Setup → Options → Packages → **Check syntax** → **Download all three** です。以前は内容ごとの分類で、既存ファイルの読み込みが**途中に独立した手順として**入っていました。そのため、**誰もが最初に持つ疑問**(どれから手を付けるのか)に答えられていませんでした。
- **確認にも独立した手順を与えました。** 追加する作業と、持ち出す作業の間です。それまでは一覧の下の補足で、**手順の置き場所ではありませんでした。**
- 冒頭の1行にも同じことを書きました。先を読まない人のためです。一覧の下には、**タブにはいつでも戻れる**ことも書き添えてあります。

### build 2026-08-10b

- **Cinnamon と COSMIC の標準アプリを各カテゴリに入れました。** 19個増えて、12分野183個になりました。他の3つと**同じ方法で評価済みシステムから読み出しています。** 各デスクトップが素のシステムに追加するものから、セッション・テーマ・各種サービスを除いた差分です。
- Cinnamon からは `xreader`・`xviewer`・`pix`・`celluloid`・`warpinator`・`bulky`・`gucharmap`・`onboard`・`blueman`・`inxi`・`gnome-terminal`・`gnome-screenshot`、COSMIC からは `cosmic-files`・`cosmic-term`・`cosmic-edit`・`cosmic-player`・`cosmic-reader`・`cosmic-screenshot` です。**この6つは COSMIC の外でも動きます。** それがこの一覧の目的です。
- **`cosmic-settings` と `cosmic-launcher`、mint のテーマ類は入れていません。** そのデスクトップが動いていなければ意味がないものだからです。`nemo-with-extensions` と `evolutionWithPlugins` は、もっと単純な理由で外しました。**カタログに説明もバージョンも無いラッパー**なので**空の行として並んでしまう**うえ、`nemo` と `evolution` は既に入っています。

### build 2026-08-10a

- **Desktop のプルダウンに Cinnamon と COSMIC を追加しました。** GNOME・Plasma・Xfce に並びます。Cinnamon は Xサーバー・lightdm・デスクトップ本体の3項目です。`xfce` と同じく、**`cinnamon` も `services.xserver` の外には移っていません。**
- **COSMIC だけ2項目です。** Wayland なので**有効にするXサーバーが存在せず**、ログイン画面も自前のものを持っているためです。ここで `services.xserver` を足すと、**誰も使わないXサーバーをビルドする**ことになります。
- どちらも索引と同じリビジョンで**実際の NixOS システムとして評価**しました。セッションとして `cinnamon-6.6.8` と `cosmic-session-1.2.0` が出ること、**言語プリセットが前提にしている CJK フォントと絵文字フォントを両方とも持っている**ことを確認しています。この前提は他の3つについて調べたものだったので、推測せず確かめました。
- アプリのカテゴリに入っているのは、いまのところ GNOME・Plasma・Xfce の標準アプリだけです。この2つが何を追加するのかは**同じ方法で評価しないと分からない**ため、まだ手を付けていません。

### build 2026-08-09z

- **ヘッダーに Download all three ボタンを追加しました。** ファイルタブに追従するダウンロードボタンの隣です。`all three` タブと**同じ書庫**を、そのタブに移動せずに受け取れます。`all three` タブを開いている間は、**隣のボタンが同じことを言う**ので引っ込みます。

### build 2026-08-09y

- **4つめのファイルタブ `all three` を追加しました。** このタブで Download を押すと、`configuration.nix`・`flake.nix`・`generated.nix` が**1つの `.tar.gz`** で出てきます。中身は**ホスト名のディレクトリ**に入れてあるので、展開した場所に既にある `configuration.nix` を**上書きしてしまうことがありません。**
- **`.zip` ではなく `.tar.gz`** にしたのは、受け取る側の事情です。NixOS には `tar` と `gzip` が最初から入っていますが、**`unzip` は入っていません。**
- **このタブの Check syntax は3つとも検査**し、**失敗したファイル名を挙げます。**
- 同じ3ファイルからは**常に同一のバイト列**が出ます(更新時刻とモードを固定しているため)。2回落として差分を取れば、**中身が違う箇所だけ**が出ます。
- `hardware-configuration.nix` は含みません。タブにもそう書いてあります。**そのマシンのディスク構成**を書いたファイルで、nixgen が書いたことは一度もありません。

### build 2026-08-09x

- **Packages タブから Kernel のプルダウンを消しました。** ここにあるべきものではなく、Options にあるものの**2つめの複製に見えていました。** 前のビルドで行を追加した際、**タブ切り替えで隠す対象の一覧に入れ忘れていた**ため、すべてのタブに出たままになっていました。この一覧は `.presetline` に対する1つのルールにまとめたので、**次に行を足したときに入れ忘れることはありません。**

### build 2026-08-09w

- **Options タブの4つのプルダウンを、組み立てる順に並べ替えました。** カーネル → デスクトップ → グラフィックス → 言語です。**他のすべてがその上で動くものを先頭**に置き、そこから外側へ向かう順序です。READMEも英語版・日本語版とも同じ順序に並べ替えたので、**読む順序と画面の順序が一致**します。

### build 2026-08-09v

- **Options タブに Kernel のプルダウンを追加しました。** 標準・最新・LTS・Zen から選べます。設定するのは `boot.kernelPackages` です。これは raw なオプションなので、**式は編集できる入力欄として module に入ります。** プリセットの中に隠れることはありません。
- **書き込む前に名前を索引で確認します。** ステータス欄には見つかったバージョンが出るので、LTS を選べば `linux 6.12.102` と表示され、**どの系列かを推測せずに済みます。** なお **nixpkgs に `linuxPackages_lts` はありません**。LTS は新しい順の系列一覧で、そのチャンネルが今も持っている最初のものが採用されます。
- 4種類すべて、構文解析だけでなく**索引と同じリビジョンで実際の NixOS システムとして評価**しました。4つの異なるカーネル、4つの異なるシステム派生になることを確認しています。

### build 2026-08-09u

- **How this works を英語と日本語の二段構成にしました。** 上半分が英語の5ステップ、下半分が同じ内容の日本語です。**翻訳ではなく書き下ろし**です。各ステップはタブやボタンの名前を指しているため、機械翻訳にかけると**画面のどこにも無い名前**を指すことになるからです。
- **狭い画面でヘッダーのボタンが折り返すようにしました。** ボタン4つを一列に並べると携帯電話の幅を超えます。折り返さない flex の行は**中身より狭くなれない**ため、代わりにページ全体が横スクロールしていました。320・375・768・1280・1800ピクセルで確認し、**いずれも横スクロールしません**。

### build 2026-08-09t

- **すべてのプルダウンに日本語を併記しました。** 分野名だけではなく、チャンネル、`flake.nix` が指すもの、ブートローダー、言語、そして `choose…` の行も対象です。いずれも**翻訳機能に書き換えられないよう固定**し、自分の文字列を覚えさせてあります。オプション名を守っている仕組みは、**選択肢の文言にも同じように必要**だからです。
- **閉じた状態の幅に収まるよう、文言を詰めました。** プルダウンは閉じているとき、収まらない部分を切り捨てます。切り捨てられていたのは**後半の日本語** — 翻訳して読んでいる人が頼っている側です。`the commit it was indexed at` は `the commit` に、unstable の注記は `(daily)` にしました。分野の一覧は余裕が無かったため、**選択欄を一行まるごと使う形**に変えました。目視ではなく実測して、**40個すべてが枠に収まる**ことを確認しています。

### build 2026-08-09r

- **分野名に日本語を併記しました。** `Audio and video — マルチメディア` のような形です。**分野名は機械翻訳が最も苦手とするもの**で、これは 音楽と動画 と訳されていました。この分野に入っているのは audacity や pavucontrol で、音楽の話ではありません。両方の言語で書いたうえで、**翻訳機能に書き換えられないよう固定**してあります。

### build 2026-08-09q

- **GNOME・Plasma・Xfce の標準アプリを各カテゴリに入れました。** 12カテゴリ151パッケージになりました。**二重にインストールするためではありません** — デスクトップを有効にすれば標準アプリは既に入ります。**そのデスクトップを使わずに、アプリだけ取れるようにするため**です。Xfce で `gwenview` を使いたい、Plasma で `gnome-calculator` を使いたい、といった場合です。
- どれが標準アプリなのかは、**評価済みの3システムから読み出しました。** 記憶ではありません。各デスクトップが素のシステムに追加するものから、セッションとテーマの土台を除いた差分です。`kwrite` を外したのもこの過程で分かったことで、**nixpkgs では kate に同梱**されており、提示できる属性名が存在しません。

### build 2026-08-09p

- **デスクトップ・言語の隣に、グラフィックスのプルダウンを追加しました。** AMD・Intel・NVIDIA から選べます。どれを選んでも `hardware.graphics` と32bit側を有効にします(Steam や wine に必要です)。そのうえで、**そのカードに実際に必要なことだけ**を行います。
- **Intel** には VAAPI ドライバも入れます。これが無いと動画のハードウェアデコードが働かないためです。**AMD** はこれ以上何も足しません。mesa が必要なものを持っているからです。**NVIDIA** はXのドライバ名を指定し、modesetting を有効にし、`hardware.nvidia.open = false`(プロプライエタリのカーネルモジュール)を設定します。**このドライバが対応する全カードで動く選択**です。
- **`services.xserver.videoDrivers` を設定するのは NVIDIA だけです。** 手抜きではありません。既定の `modesetting` が、現行カーネルの AMD と Intel では正解です。**amdgpu のXドライバを強制しても得るものがありません。**
- **NVIDIA を選ぶと、ドライバが unfree である旨を表示し続けます。** 既存の unfree 警告は `environment.systemPackages` しか見ておらず、こちらはモジュール経由で入るためです。`allowUnfree` が無いと**ビルドは拒否されます。**

### build 2026-08-09o

- **アプリの一覧を拡充しました。想像ではなく、実際に使われている設定ファイルから採っています。** 12カテゴリ121パッケージになりました。行き場のなかったものを収める **Chat and sync** も追加しています。
- 入れたもの：Xfce一式(parole、ristretto、catfish、gigolo、xfce4-screenshooter、orage、xfburn)、動画まわり(davinci-resolve、gpu-screen-recorder-gtk、ffmpeg-full)、Steam周辺(protonup-qt、goverlay、steam-run、moonlight-qt)、ハードウェア関連(lm_sensors、lshw、pciutils、solaar、piper)、リモート接続(remmina、virt-viewer)、コンパイラと言語サーバー、obsidian、freecad、gimp-with-plugins。
- **入れなかったもの：特定のマシンに紐づくもの。** AMD GPU 関連、ROCm、マイクロコード、パネルプラグイン、手書きの `callPackage` 式です。これらは**個人の設定ファイルに書くもの**であって、全員に提示する一覧に載せるものではありません。
- `xfce.*` の改名がまた効いています。parole、ristretto、catfish、gigolo、orage、xfburn、xfce4-screenshooter は 25.11 では `xfce.` の下、26.05 ではトップレベルです。**両方の綴りを並べてあります。**

### build 2026-08-09n

- **言語を選べば、言語設定が完結します。** デスクトップのプルダウンの隣で、英語・日本語・フランス語・ドイツ語・スペイン語・韓国語・中国語から選べます。**ロケール、コンソールのキーマップ、Xのレイアウト**が入り、日本語・韓国語・中国語では**入力メソッド**も設定されます。この3言語は入力メソッド無しには打てないためです。
- **フォントは含めていません。必要ないからです。** GNOME・Plasma・Xfce のいずれも、CJKフォントと絵文字フォントを既に持っています(実際に評価して確認しました)。**タイムゾーンも設定しません。** 言語は場所ではないので、片方からもう片方を推測すると外すほうが多くなります。
- **アプリのカテゴリを3つ追加しました。** アクセサリー(Accessories)、ファイラー(File managers)、ターミナル(Terminals)です。
- 名前についてまた1つ。`xfce.*` のパッケージは 25.11 と 26.05 の間にトップレベルへ移動し、`dolphin`・`konsole`・`kcalc` は `kdePackages` の下にあります。**両方の綴りを並べてあり、いま使っているチャンネルにあるほうだけが出ます。**

### build 2026-08-09m

- **ブラウザに Google Chrome、ゲームに Steam を追加しました。** どちらも unfree なので、`nixpkgs.config.allowUnfree = true;` を設定するよう促す表示が出ます。**これが無いとビルドは拒否されます。**
- **Steam を選ぶと、より適した方法を案内するようにしました。** 一覧から外すのではなく、こちらの形にしました。パッケージとしても動きますが、32bit のグラフィックドライバを揃え、リモートプレイのポートを開けられるのは **Options** タブの `programs.steam.enable` です。**一覧から外すと、探させるだけでした。**

### build 2026-08-09l

- **Packagesタブに「よく使うアプリ」のプルダウンを追加しました。** ブラウザ、メーラー、オフィスソフト、マルチメディア、グラフィックス、ゲーム、システムツール、開発の8分野です。「欲しいものの種類は分かるが、ここでの名前が分からない」ときのためのものです。**カテゴリを選ぶと検索結果欄にそのアプリが並びます。** 追加するのは検索結果をクリックするのと同じ操作で、**勝手にインストールされるものはありません。**
- **絞った一覧であることを画面にも書いています。** ここは道具の中で唯一、**誰かの好みで見えるものが決まる場所**です。だから小さく保ち、それ以外を探す手段は検索欄のままにしてあります。
- 名前はすべてカタログと照合しました。これは形式的な作業ではありません。`kdenlive` の実体は `kdePackages.kdenlive`、`0ad` は `zeroad`、`superTuxKart` は 25.11 と 26.05 の間に `supertuxkart` へ改名されています。**そのチャンネルに無い名前は、一覧に出ません。**

### build 2026-08-09k

- **デスクトップ環境をプルダウンから選べるようにしました。** **Options** タブで GNOME、KDE Plasma、Xfce のいずれかを選ぶと、NixOSマニュアルが挙げている3項目が追加されます。**追加されるのは通常のオプションと同じカード**なので、中身を読んで、変更も削除もできます。見えないファイルに何かが書き込まれることはありません。
- 項目名だけでもこの機能の価値があります。`gdm` と `sddm` は `services.xserver` の外に移動しましたが、**`lightdm` は移動していません。** `gnome` と `plasma6` は外に出ましたが、**`xfce` は中に残っています。** `plasma5` は消滅しました。**推測で当てられる並びではありません。** そのため各項目は決め打ちせずカタログを照合し、**そのチャンネルに実在する名前**を使います。

### build 2026-08-09j

- **作業内容を失ったときの復旧方法を、画面に書きました。** タブを閉じると入力は消えます(保存先を持たない設計のため)。**`generated.nix` が保存ファイルの役割を果たします。** ダウンロードしておいて **Import configuration.nix** で読み込めば、同じ設定が同じ値で戻ります。以前からできたことですが、どこにも書いていませんでした。
- **push のたびにチェックが走るようにしました。** `tools/fuzz.py` と `tools/import_check.py` は良いハーネスですが、**誰かが思い出したときにしか走りませんでした。** スクリーンショットが3世代古くなったのとまったく同じ形です。すべて `nix develop` 経由なので、CIが実行するコマンドと、手元で叩くコマンドが同一になります。あわせて `nodejs` を開発シェルに入れました。チェックリストには以前から `node --check` と書いてあるのに、シェルに入っていませんでした。

### build 2026-08-09i

- **手順1に、ファイルの置き場所を図で示しました。** 「新規マシン用のスターターファイル」はこれまで1文だけでしたが、Setupタブが用意する2つのファイルがそれぞれ何なのか、そして `/etc/nixos` に最終的に並ぶ4つのファイルを一覧で示すようにしました。**どれがどれを読み込むのか**も書いてあります。文章だけでは伝わりにくかった部分です。
- **修正：横幅の広い行があると、狭い画面でページ全体が横にはみ出す不具合。** 1カラム表示のとき、レイアウトが中身の幅に合わせて広がってしまい、枠の中でスクロールしませんでした。**広い行が無かったため、これまで表面化していませんでした。** 今回のファイル一覧で初めて出ました。

### build 2026-08-09h

- **起動すると、画面中央に使い方の5ステップが出るようになりました。** これまで「まだ何も設定されていません」と出ていた場所です。スターターファイル、既存の設定ファイルの読み込み、設定項目の追加、ソフトウェアの追加、出来たファイルの使い方。ひととおりの流れが書いてあります。**設定を1つ足せば、その場所が設定の一覧に変わります。** 閉じるボタンはありません。

### build 2026-08-09g

- **取り込み結果のサマリを、設定項目の上に戻しました。** 設定ファイルを読み込んだとき、**「この版に存在しないオプション」の一覧が、カード1〜2画面分の下に埋もれていました。** `nixos-rebuild` がはっきり拒否するのはこれだけなので、いちばん先に目に入る必要があります。`environment.systemPackages` が列の先頭に来る動きはそのままです。

### ドキュメント

- **スクリーンショットを最新の状態にしました。** チャンネル選択も、`flake.nix` が何を指すかの選択も、オプション一覧の鮮度表示も写っていない、3世代前のものでした。撮り直しはコマンド化してあります(`tools/shots.py`。実際のアプリを操作します)。今後はずれにくくなるはずです。

### build 2026-08-09f

- **ポート8823が使われているとき、Pythonのトレースバックではなく普通のメッセージを出すようにしました。** たいていの原因は**前に起動したnixgenがまだ動いていること**なので、その旨と、ヘッダーのビルド番号で見分けられることを併せて表示します。あわせて、待ち受けに失敗する前に「serving …」と表示してブラウザを開く動きもやめました。**古いほうの画面に案内した上で、新しいほうが起動したように見えていました。**
- **一覧から外れたチャンネルのインデックスを、Setupタブから削除できるようにしました。** 1つあたり約37MBありますが、消す手段が無く、そこにあること自体これまで表示されていませんでした。削除の対象は**nixgenが自分で作ったファイルだけ**です。使用中のものと、まだ選べるチャンネルのものは対象外にしてあります。

### build 2026-08-09e

- **`nixos-unstable` を選べるようにしました。** 番号付きリリースと並びます。選ぶと**すべてがunstableになります。** オプション、パッケージ、`flake.nix`、`system.stateVersion` です。**混在はありません。** 「パッケージだけ別のチャンネルから」はできませんし、対応する予定もありません。
- **オプション一覧がいつ公開されたものかをSetupタブに表示し、古くなったら再構築を提案するようにしました。** unstableなら翌日、番号付きリリースなら数週間後です。表示するのはチャンネル側の公開日時で、ダウンロードした日時ではありません。**この表示が無かったことが、unstableを長く非対応にしていた理由です。**
- **`system.stateVersion` がチャンネルに追従します。** `nixos-unstable` は名前にバージョンを持たないため、カタログから読み取ります(現時点で26.11)。手で入力すると、以降は追従しなくなります。
- 項目名を **nixpkgs release** から **nixpkgs channel** に変えました。並ぶものの1つがリリースではないためです。

### build 2026-08-09d

- **What flake.nix points at の既定を、リリースブランチに変えました。** 公開時の既定はコミットでした。**正確さではコミットが上です。** 画面に出ていたオプションと、実際にビルドされるnixpkgsが一致するのはこの設定だけだからです。ただし、決して動かない既定値は、**設定を変えない限りセキュリティ更新が届かない**ということでもあります。インストールしたばかりの人にとっては、こちらのほうが困ります。コミットの指定はプルダウンで1操作、いまどちらを選んでいるかは隣の説明に出ます。

### build 2026-08-09c

設定ファイル読み込みの検証ハーネスを追加し、**初回実行で見つかった6件**を修正しました。ハーネスは**2つのリーダー両方**を通します。Nixのパーサーを使う経路と、Nixが無い環境用のフォールバックです。この2つは壊れ方が違い、6件のうち3件は片方でしか現れませんでした。

- **修正：正常に適用できるのに、何も起きない設定。** `boot.kernel.sysctl."net.core.rmem_max"` が引用符の中のドットで分割され、**別の属性に書き込まれていました。** ファイルは構文チェックを通り、`nixos-rebuild` も受け付け、設定だけが効きません。この形の項目は76個あります。
- **修正：非ASCII文字が文字化けする不具合。** `日本語` や `Grüße` が読み込み時に壊れていました。エスケープ解除がUTF-8のバイト列をlatin-1として読んでいたためです。
- **修正：空のパッケージ一覧に追加できない不具合。** `environment.systemPackages = [ ];` が「空のリスト」ではなく「式」と判定され、追加先が無くなっていました。
- **修正：`services.foo.nice = -5` が `__sub 0 5` になる不具合。** Nixに負数リテラルは無いため、パーサーはこの形で返してきます。値としては正しいのですが、**自分が書いた行だと気づけません。**
- **修正：引用符を含むパッケージ名が、リストごと壊す不具合。** 並べ替えの際に `rubyPackages."http_parser.rb"` が2つに割れ、`rubyPackages.` という壊れた記述が残っていました。

### build 2026-08-09b

- **修正：名前にドットを含むパッケージを追加すると、壊れたファイルが出る不具合。** 検索から `python313Packages.requests` や `CuboCore.coreaction` を選ぶと `pkgs.` が付かずに書き出され、`nixos-rebuild` が `error: undefined variable 'python313Packages'` で止まっていました。**カタログの83%が名前にドットを含みます** — `python3Packages.*`、`haskellPackages.*`、`aspellDicts.*` などすべてです。よく使うもの(`firefox`、`git`、`ripgrep`)にはドットが無いため、気づかれずにいました。
- **修正：同じパッケージが、設定ファイルの読み込み時に「編集できないテキスト」になっていた不具合。** Nixのパーサーは `python313Packages.requests` を `((python313Packages).requests)` の形で返しますが、読み込み側がこれを認識できず、**リスト全体がそのまま転記**されていました。該当パッケージが1つあるだけで、リスト全部がそうなります。
- **修正：リスト内の負の数が、転記時に括弧を失う不具合。** `nix-instantiate` が無い環境でのみ起きます。`[ (-1) ]` は通りますが `[ -1 ]` は通らないため、`syntax error, unexpected '-'` で失敗していました。
- **生成される `flake.nix` が、ブランチではなくコミットを指すようになりました。** オプション一覧を作った時点のnixpkgsのリビジョンをそのまま固定します。**フォームが提示したオプションと、実際にビルドされるnixpkgsが一致します。** ブランチがその後どこまで進んでいても影響しません。どのコミットかはSetupタブに表示されます。
- **どちらを指すかは選べます。** リリース選択の隣に *What flake.nix points at* を追加しました。ブランチを選べば従来どおりの挙動です。最初のビルドが `flake.lock` で固定され、`nix flake update` で先へ進みます。
- そのリリースのインデックスがまだこのマシンに無い場合は、チャンネルサーバーに現在のコミットを問い合わせます。ビルドの再現性は確保されますが、**オプション一覧がそのコミットのものである保証はありません。** 生成されるファイルには、4つの経路のどれで決まった値なのかを明記しています。見分けが付かないまま同じ顔をさせないためです。
- `fetch-data.sh` がチャンネルの `git-revision` を取得し、`build_index.py` がデータベースに保存するようにしました。今回より前に作ったインデックスにはこの値がありません。その場合、コミットを選んでいても**画面にその旨を表示します。** 黙ってブランチを返すことはしません。

### ドキュメント

- **`nix run github:…` が古いビルドで起動する理由を明記しました。** Nixは `github:` の参照を1時間キャッシュし、`nix profile install` で入れたものは固定されます。どちらも不具合ではありませんが、**修正が効いていない状態と見分けが付きません。**
- **unstableについての記述を訂正しました。** 「仕組み上むずかしい」と書いていましたが誤りで、`nixos-unstable` も同じオプションデータを公開しています。本当の障害は、チャンネルが常に最新のスナップショットを返すのに対し `flake.lock` は特定のコミットを固定すること、そしてunstableが毎日変わることです。チャンネルの混在は別の話で、こちらは引き続き対象外です。

### build 2026-08-05h

- **Setupタブを一番左に移動し、起動時の初期表示にしました。** Options・Packagesより前です。インストール直後のマシンでは、まずこれらのファイルが必要になるためです。

### build 2026-08-05g

- **Setupタブでnixpkgsのリリースを選べるようにしました。** 最新の安定版とその前2つ、計3つです。`flake.nix` は選んだリリースを指します。一覧はチャンネルサーバーに問い合わせて作るので、古くなりません。
- **選んだリリースにオプション一覧も追従します。** ずれている場合はその旨を表示し、そのリリースのインデックス構築を提案します。初回のみ数分、以降は瞬時です。リリースごとに別のデータベースを持つためで、選択は再起動後も保持されます。
- `brotli` コマンドが無い環境では、`fetch-data.sh` がPythonのbrotliモジュールにフォールバックするようにしました。`nix develop` の外でも再構築できます。

### build 2026-08-05f

- **パッケージ一覧をアルファベット順に。** 読み込み時も、追加したときも揃います。Nixは順序を気にしませんが、読みやすく、差分も小さくなります。
- **修正：nix非搭載環境でパッケージ一覧が丸ごと失われる不具合。** `nix-instantiate` が無い環境向けの読み込みで、`with pkgs;` のセミコロンを値の終端と誤認していました。
- ヘッダーにビルド番号を表示するようにしました。**直したはずの挙動が変わらないときは、まずこの番号を見てください。** 古いファイルが配信されている状態と、修正が効いていない状態は、見た目では区別が付きません。

### それ以前

- **スターターの全項目を編集可能に。** ブートローダー(systemd-boot / GRUB / なし)、NetworkManager、flakes、グループ、`stateVersion`。オフにした項目はコメントアウトではなく行ごと消えます。
- **両方のファイルに書かれたオプションを赤字で表示。** 同じ優先度の `lib.mkDefault` が2つあると、NixOSはどちらを採るか決められないためです。
- **修正：生成ファイルが自分自身をimportする問題。** `imports` を転記する際に `./generated.nix` への参照が残り、`stack overflow; max-call-depth exceeded` で止まっていました。原因を示す情報が一切出ないエラーです。
- **修正：`imports` が丸ごと捨てられていた問題。** `hardware-configuration.nix` が読み込まれず、`fileSystems."/".fsType` が未定義でビルドが失敗していました。
- 既存の `configuration.nix` の読み込みに対応。すべての行が4分類のいずれかに計上されます。
- パッケージを1行ずつ表示。長い値が400文字で切れる問題も修正しました。

### beta — 初回公開

- 安定版チャンネルの全オプション・全パッケージの検索、公開されている型データから組み立てたフォーム、生成中のファイルのリアルタイム表示。
