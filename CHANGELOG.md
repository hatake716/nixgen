# Changelog

[English](#english) · [日本語](#日本語)

The version you are running is printed in the header of the app, next to the
option counts.

---

## English

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

### build 2026-08-09l

- **Packagesタブに「よく使うアプリ」のプルダウンを追加しました。** ブラウザ、メール、オフィス、音楽と動画、グラフィックス、ゲーム、システム、開発の8分野です。「欲しいものの種類は分かるが、ここでの名前が分からない」ときのためのものです。**カテゴリを選ぶと検索結果欄にそのアプリが並びます。** 追加するのは検索結果をクリックするのと同じ操作で、**勝手にインストールされるものはありません。**
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
