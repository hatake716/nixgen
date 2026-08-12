# HANDOVER.md — taking over nixgen

Written at `v1.0.0-rc.4.1`, build `2026-08-12z`, for whoever maintains this
next. It is not a summary of the code — the code is readable and `CLAUDE.md`
holds the reasoning. It is the things a newcomer cannot get from either: what
state the project is in, what is deliberately unfinished, and which mistakes
this codebase has already paid for.

日本語の要点は各節の末尾にあります。

---

## 1. What to read, and in what order

| File | What it is | Read it |
|---|---|---|
| `README.md` / `README.ja.md` | What the tool is, for a user | First, once |
| **`CLAUDE.md`** | **The invariants and the decisions, with reasons** | **Second, in full** |
| `CHANGELOG.md` | Every change, English then Japanese | As reference |
| `HANDOVER.md` | This file | Second-and-a-half |
| `DEBUGGING.md` | **Historical.** Written for a one-off debugging pass before `v1.0.0-rc.1` | Only for its bug-family taxonomy |

`CLAUDE.md` is long (about 1,300 lines) and that is the point: every bullet is
a bug that reached a real machine, written down so it is not paid for twice.
**Read it before touching anything.** The single most expensive habit you can
form here is deciding a bullet looks obvious and skipping it.

> 読む順番は README → **CLAUDE.md（全文）** → この文書。`DEBUGGING.md` は rc.1 前の一度きりの作業向けで、いまは歴史的資料です（バグの分類だけは今も有用）。CLAUDE.md は長いですが、**一行ごとが実機で踏んだバグ**です。飛ばさないでください。

---

## 2. Where things stand

- **`v1.0.0-rc.4.1`** is the current tag, on `main`. The build id in the app
  header is `2026-08-12z`. Stable `v1.0.0` is the next step, waiting only on
  the author's evaluation.
- **Two branches.** Work lands on `development`, is merged to `main` when it
  has held up, and tags are cut on `main`. Both READMEs carry
  `github:hatake716/nixgen/development` on `development` and must not on
  `main` — the check is `git grep -n 'nixgen/development' README.md
  README.ja.md` after every merge, which must return nothing.
- **CI runs on every push**: source parse, the flake builds, `fuzz.py`,
  `import_check.py`, the eleven-point browser sweep, and `catalogue_check.py`.
  `eval_check.py` is deliberately out — it fetches a pinned nixpkgs and takes
  minutes. Run it before a release and whenever a preset changes what it
  writes.
- **Channels offered**: `nixos-26.05`, `nixos-25.11`, `nixos-25.05`,
  `nixos-unstable` — the current release, the two before it, and unstable.
  This is `releases.KEEP = 3` and it is probed, not hard-coded.
- **The tag is a plain version.** `v1.0.0`, not a channel-qualified name; the
  channels go in the release title. `CLAUDE.md` records why.

> 現在 `v1.0.0-rc.4.1`（ビルド `2026-08-12z`）。作業は `development` → `main`、タグは `main` に打ちます。CI は毎プッシュで構文・flake・fuzz・import・11項目スイープ・カタログ検査まで走り、`eval_check.py` だけ手動です。

---

## 3. The working loop

```bash
cd ~/src/nixgen-pub
git add -A          # flakes ignore untracked files; new files are invisible without this
nix run .           # a dot, not github: — that would fetch the published copy
```

**Bump `BUILD` in `build/static/app.js` on every change to that file.** Hours
have been lost three separate times to "the fix does not work" that turned out
to be a stale copy — browser cache, Nix's hour-long `github:` memory, or an
old server process still holding the port. The build id in the header is how
those are told apart in one glance.

**The same trap has a Python half.** `server.py` imports the other modules at
start, so an edit to `nix_import.py` or `nixgen_core.py` does nothing until you
restart the server. This cost real time during this session: a fix was correct,
the test failed, and the process was serving the old module.

Before shipping, the commands are listed under "Checks before shipping" in
`CLAUDE.md`. The short version: renderer changes → `fuzz.py`; importer changes
→ `import_check.py` (it runs **both readers**, which fail differently); UI
changes → the sweep; preset or starter changes → `eval_check.py` as well.

> 開発は `nix run .`（ドット）。`app.js` を変えたら **`BUILD` を必ず上げる**。**Python を変えたらサーバーを再起動する** — モジュールは起動時に読まれるので、直したのに直らない現象の主犯です。

---

## 4. The maintenance rhythm

### Every six months: a new NixOS release

This is the one recurring obligation, and `CLAUDE.md` has the full runbook
("When a new NixOS release lands"). The short form: build an index for the new
channel, start the server on it, and run

```bash
python3 tools/catalogue_check.py http://127.0.0.1:8824/
```

It names every option path and package the presets promise that the new
channel no longer has. `BROKEN` and `UNRESOLVED` are real; **add the new
spelling to the front of the candidate list and keep the old one**, because
three releases are offered at once. `CHECK … KERNELS.lts` is the one question
the index cannot answer — whether a kernel series is longterm is
kernel.org's designation, and a human has to go and look.

Point CI's `CHANNEL` at the new channel as soon as it publishes. That turns
the six-month surprise into a checklist item months early, and it is the
cheapest thing on this list.

### When a bug is reported

Ask for the second line of the generated file:

```
# channel: nixos-26.05   generated: 2026-08-12 10:00   nixgen: 2026-08-12z
```

It names the build that wrote the file. Two reports during this project were
fixed bugs running from a cached copy; that line is what tells "the fix is in"
from "the fix is what you ran".

> 半年ごとの NixOS リリースが唯一の定期作業です。新チャンネルの索引を作り `catalogue_check.py` を1回流し、`BROKEN`/`UNRESOLVED` は**候補リストの先頭に新綴りを足す（古い綴りは残す）**。CI の `CHANNEL` を早めに新チャンネルへ向けるのが一番安上がりな早期警戒です。不具合報告には**生成ファイルの2行目**を必ず添えてもらってください。

---

## 5. Open and deferred work

Nothing here is a known-broken feature. These are things a five-way audit and
an adversarial review flagged, which were judged not worth doing in the same
pass that introduced them. Each says why, so the next person can disagree with
the reasoning rather than rediscover the item.

**Open**

- **`with lib;` between a module header and its body defeats the importer.**
  Pre-existing; the file is refused rather than partly read. Hard because
  `with` opens a scope: reading the body correctly means knowing every bare
  `mkForce` inside it is `lib.mkForce`, and `classify` reasons about one
  expression at a time. It matters more now that `PRIORITY_KEEP` matches the
  bare spelling. A file nixgen wrote never has this shape; a hand-written one
  often does. Also recorded in `CLAUDE.md`'s Open items.

**Deferred, with reasons**

- **The sweep does not touch six recent features.** `#s-audio`, `#s-flatpak`,
  `#btn-undo`, `#btn-theme` appear nowhere in `browser_check.py`, and the
  archive is fetched through `/api/bundle` rather than the download button, so
  the button, `settled()` and the locate-bundle flow are unexercised. Each of
  those shipped with a one-off suite that was thrown away — which is the exact
  practice `browser_check.py` was created to end. **This is the highest-value
  item on this list.**
- **The `allowUnfree` scan can silently truncate.** `doRender` sends every
  distinct `pkgs.<attr>` in the file to `/api/packages?attrs=` unbounded, and
  the endpoint caps at 40. Names past the cap are then marked known-free. A
  file with more than 40 distinct package names and an unfree one late in the
  list would not get its switch. Fix: batch on the client, and make the
  server's truncation visible rather than silent.
- **Four preset values are written without a lookup.** `SHELLS.pkg`,
  `LANGUAGES.addons`, `GPU extras` and the xdg portal go straight into a value
  instead of through `/api/packages?attrs=` first. `catalogue_check.py` does
  verify all four exist, so CI catches a rename — but at runtime, on a channel
  where one is missing, the file fails at `nixos-rebuild` instead of degrading.
- **The seven preset "add" functions share a shape that is copied, not
  factored.** The same steps loop and the same bilingual "this release has
  no …" sentence appear six times each. This is the extensibility tax: a new
  preset is written by copying one, and the copy is where the Japanese half
  gets forgotten. Deferred because it edits the most bug-scarred code in the
  file and the only thing that could prove it is a sweep that does not yet
  touch two of the seven presets. **Do the sweep coverage first, then this.**
- **`doRender` is 229 lines holding six independent checks.** The extraction is
  mechanical and the result much more readable, but the note ordering is
  user-visible and each note carries a comment recording a bug it was paid
  for. Right refactor, wrong time to do it beside the one above.
- **Two "same rule twice" pairs have no check**: `bundle_name` vs
  `bundleName`, `sort_key` vs `sortKey`, `_SEGMENT` vs `segmentsFor`.
  `CLAUDE.md` names them as pairs that must stay in step; nothing enforces it.
  A small stdlib-only `tools/server_check.py` could cover these plus the
  exit-on-last-page-close arithmetic and `locate_bundle`, none of which any
  harness reaches today.
- **`server.py` at 1,369 lines was reviewed for splitting and the verdict was
  don't.** `import_check.py` reaches into `server.import_config`,
  `server.render` and `server.DB_PATH`, so a split means shims or churning the
  code the project trusts to catch regressions. The section dividers already
  do most of the work.

> ここに壊れている機能はありません。監査とレビューが挙げ、**同じ回でやるべきでないと判断した**ものです。最優先は**スイープが最近の6機能に触れていない**こと。プリセットの共通化はその後です（証明手段が先に要るため）。

---

## 6. What this codebase keeps teaching

Three habits earned the hard way. They are worth more than any individual fix.

**"It does not crash" is not "it works."** The whole preset system degrades
safely: a renamed option is simply absent, nothing is written, nothing throws.
That was the design, and it turned out to be the problem — a stale name
produces a setting quietly not written and nobody is told. Every mechanism
that merely avoids crashing deserves a second question: *how would anyone find
out?* `catalogue_check.py` exists because of this, and it found on day one
that "LTS kernel" had been handing out a two-year-old kernel.

**Changes that look correct are not evidence.** Almost every bug in
`CLAUDE.md` was found by running the thing on a real machine, not by reading
the code. The harnesses exist so that "I checked" means something. During this
session a fix was made, the test still failed, and the cause was a stale server
process — suspect the test and the process before the code.

**A fix can be the next bug.** Three defects in the last pass were introduced
by the fix immediately before them: keeping `lib.mkForce` verbatim fixed a
round trip and broke the Setup fields; it also made a latent truncation in
`appendToNixList` reachable for the first time. All three were caught by an
adversarial review — a separate pass whose job is to break the change, not
confirm it. **Budget for that pass.** Self-review found none of them.

And one specific to this project: **the comments are load-bearing
documentation.** They record why, not what. A refactor that loses a comment's
reason is a regression even if the behaviour is identical.

> 3つの習慣が高くつきました。①**「落ちない」は「動く」ではない** — 黙って設定が1つ減る類の失敗は、必ず「どうやって気づくのか」を問い直すこと。②**正しく見える変更は証拠ではない** — 実機とハーネスで確かめること。③**修正が次のバグになる** — 直近の3件は直前の修正が原因で、いずれも「壊しにいくレビュー」だけが見つけました。自己レビューでは1件も出ませんでした。そして**コメントは仕様書**です。理由を失う整理は、挙動が同じでも後退です。

---

## 7. Facts that drift

The counts in `README.md`, `README.ja.md`, `docs/index.html` and `CLAUDE.md`
are per *revision*, not per release, so they move within a release. Recompute
rather than copy; the command is in `CLAUDE.md`'s Documentation section.

At `nixos-26.05` / `ee48b147`: **24,557 options**, **144,245 packages**,
**88.3% (21,681)** with a real widget, **1,252** distinct type strings,
**5,082 (21%)** with a placeholder.

Screenshots are regenerated by `tools/shots.py`, which drives the running app
and takes each shot twice, light and dark. The build id and the counts are
visible in every shot, which is how a stale one is spotted.

> 数値は**リビジョンごと**に動きます。コピーせず再計算してください（コマンドは CLAUDE.md にあります）。スクリーンショットは `tools/shots.py` が実アプリを操作して撮り直します（ライト/ダークの2枚組）。
