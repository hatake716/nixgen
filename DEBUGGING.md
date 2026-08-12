# DEBUGGING.md — デバッグ担当への引き継ぎ

対象: リリース候補 `v1.0.0-rc.1` 直前の nixgen(build `2026-08-12n`、commit `6cab105`)。
この文書は「何を・どう検証してきたか」「どこが壊れやすいか」「同じ検証を再現する手順」の引き継ぎです。
設計判断と不変条件の一覧は [CLAUDE.md](./CLAUDE.md) にあり、そちらが本体です。既知バグの再発防止表もそちらにあります。

日本語で書いていますが、コマンドと識別子はそのままです。

---

## 1. 現在の状態

- 全機能凍結済み。ユーザー(作者)が数日 RC を実機評価し、その後 `v1.0.0` を打つ計画。
- 直近2回の全体点検(CHANGELOG の「検証パス」2件)は**どちらも修正0件**で通過。
- 作者の検証機は nixpkgs `fcb8fcd6`(チャンネルの現在地)で、開発側のピン留めは `ee48b147`(索引の構築元)。**両者は別物**で、これまでに1度、この差がバグ報告の再現条件になった。

## 2. 動かし方と、最初に確認すべきもの

```bash
cd ~/src/nixgen-pub
git add -A          # flakes は未追跡ファイルを見ない
nix run .           # ドット。github: は1時間キャッシュされる
```

- 開発中のテストサーバーは **8824** で立てる(8823 は常用ポート):
  `python3 build/server.py --db data/nixgen.sqlite --port 8824 --no-browser`
- **画面上部の build id を必ず見る。** 「直したはずが直っていない」の原因は、ほぼ毎回どれか:
  ブラウザキャッシュ / `github:` の1時間キャッシュ / `nix profile` の固定 / 古いサーバープロセス。
  生成ファイルのヘッダー(`nixgen: 2026-08-12n`)にも同じ id が入るので、**報告者が実行した版**はファイルから特定できる。
- `app.js` を触ったら `BUILD` を上げる。上げ忘れると上記の切り分けが全部効かなくなる。

## 3. リポジトリに常設の検査(まずこれを回す)

```bash
nix develop --command python3 tools/fuzz.py          # レンダラ: 固定回帰 + ランダム
nix develop --command python3 tools/import_check.py  # インポータ: 両リーダーで全ケース
nix develop --command node --check build/static/app.js
nix develop --command python3 -c "import ast,glob; [ast.parse(open(f).read()) for f in glob.glob('build/*.py')]"
nix build .#default --no-link                        # flake としてビルドできるか
python3 tools/browser_check.py <url> <outdir>        # §4 の11項目(playwright 必要)
python3 tools/eval_check.py <outdir>                 # §5 の実システム評価と読み戻し
python3 tools/shots.py <url> docs                    # スクリーンショット撮り直し(playwright 必要)
```

**固定ケースがランダム部より重要。** ランダムは自分のレンダラが出す形しか作れないため、
過去に負数バグを取りこぼした実績がある。新しい形の入力は `CASES`(import_check)へ足すこと。

## 4. ブラウザ検証(tools/browser_check.py に恒久化済み)

かつてセッション限りだった Playwright スイート(golden / stable2 / confroute / pickers /
lastfeat など)は消失し、パスのたびに手で再構成していた。いまは **`tools/browser_check.py`
が11項目そのもの**で、CI(checks.yml の browser ジョブ)でも毎プッシュ走る。
起動レシピはツールの docstring にある(要 playwright。`<outdir>` を渡すと
生成された3ファイルとラウンドトリップ後の module を保存し、それが §5 の入力になる)。

```bash
B=/nix/store/pxhpj9rn0a04sj5cy4xcvsbpa36ivinw-playwright-browsers   # 作者機のパス
PLAYWRIGHT_BROWSERS_PATH=$B PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 nix shell --impure \
  --expr '(import <nixpkgs> {}).python3.withPackages (ps: [ ps.playwright ])' \
  --command python3 tools/browser_check.py http://127.0.0.1:8824/ <outdir>
```

ツールが検査する11項目(手で確かめるときの一覧としても残す):

1. 全プリセット同時(kernel=lts, shell=fish, desktop=sway, gpu=nvidia, lang=ja, region=Asia/Tokyo, Flatpak)+検索から1パッケージ → Check syntax が `Parses cleanly.`
2. Download all three → 書庫に3ファイル、`generated.nix` に allowUnfree / sway config 差し替え / keyring / XKB / timeZone / unit が全部ある
3. その `generated.nix` を Import generated.nix → sway を選び直し → **etc とユニットの定義がそれぞれ1つ**(二形状衝突の再発チェック)
4. デスクトップを gnome→niri→xfce→cosmic と歩く → **DM は常にちょうど1** / allowUnfree 生存 / noctalia 消し残しなし
5. System update ダイアログが開いて閉じる(日英併記)
6. 属性二重定義ファイルの取り込み → 読めて・名指しされて・1つに畳まれる
7. `i18n.inputMethod.type = null` のファイル → fcitx5 に修復される
8. aarch64 の configuration.nix → Architecture 欄が値付きで再表示
9. 日本語の文中空白 0(正規表現 `[ぁ-ん...][ ]+[ぁ-ん...]` を**描画結果**に対して)
10. 320/390/768/1800px で横スクロールなし
11. モバイル下部ナビ(Catalog/Module/Output)でパネルが切り替わる

テスト補助の作法:

- 画面のコード読み取りは `#out` の **textContent** を使う。`inner_text` は block 表示の span で改行が倍になり、
  **過去3回、テスト側の誤検出を生んだ**。
- プルダウンの収まり検査は「クローンを `width:max-content` にして実幅と比較」。**非表示タブ上で測ると幅0になる**。
- 何かを「バグ」と断定する前に、**テスト自身を疑った回数のほうが多い**ことを覚えておく
  (unfree 評価に allowUnfree を入れ忘れた、隠し要素を測った、旧仕様の期待を残した、等)。

## 5. 実システム評価(これが最終防衛線 — tools/eval_check.py に恒久化済み)

構文チェックは `nix-instantiate --parse` **だけ**。型も評価も見ない。生成物の正しさは
**実際に NixOS システムとして評価**して確かめる。いまは `tools/eval_check.py` が
このハーネスそのもの: §4 が保存したディレクトリを渡すと、スタブの
hardware-configuration.nix を添えて評価し、下の読み戻しまで自動で行う。
`--generated generated-roundtrip.nix` で往復後の module を、`--revision <hex>` で
報告者のリビジョンを評価できる。CI には載せていない(ピン留めした nixpkgs の取得と
数分の評価が要る)。リリース前と、プリセットが書く内容を変えたときに回すこと。
以下は手で組む場合の元の手順:

```bash
mkdir eval && cd eval && git init -q
# flake.nix: nixpkgs を検証対象リビジョンにピン留めし、./configuration.nix を読む nixosSystem
# configuration.nix: hardware-configuration.nix(スタブ) と generated.nix を import、stateVersion は mkDefault
# hardware-configuration.nix: fileSystems."/" と boot.loader.grub.device のスタブ
cp <検証したい generated.nix> generated.nix && git add -A
nix eval --raw '.#nixosConfigurations.<host>.config.system.build.toplevel.drvPath'
```

evalが通ったら、**中身も読み戻して**確認する(通っただけでは足りなかった実例が多数):

```bash
nix eval --json '...config.services.displayManager.sessionData.sessionNames'  # セッション名の実在
nix build --no-link '...config.environment.etc."pam.d/login".source' && grep -c gnome_keyring <path>
nix build --no-link '...config.environment.etc."sway/config".source'
#   → include /etc/sway/config.d が1行 / bar { が0行 / bindsym 75行、を確認
nix eval --json '...config.environment.sessionVariables' --apply 'v: v.XKB_DEFAULT_LAYOUT or "unset"'
```

リビジョンを報告者のものに差し替えるには flake.nix の URL を書き換えて `rm flake.lock`。
**「開発ピンで通る」と「報告者のリビジョンで通る」は別の事実**(input-method 事件で実証済み)。

## 6. 壊れやすい場所(系譜つき)

詳細は CLAUDE.md のバグ表。ここでは**族**として挙げる。新しいバグもだいたいこのどれかの新種だった。

1. **二形状衝突** — 同じ設定が「attrs ブロック」「フラット行」「取り込みで平坦化された leaf」の
   複数形で共存すると `attribute … already defined`(**パーサ**が拒否するので Check syntax で捕まる)。
   これまで4変種。プリセットが attrs オプションに書くときは**フラット行**+`dropFromAncestors` が現行の答え。
   第4変種(2026-08-12o で修正)は取り込み側: 置換がパスの完全一致比較だったため、
   インポータの畳み込み/平坦化で形が変わった同じ葉をすり抜けた。プリセット入りのフォームに
   自分の generated.nix を読み戻すと再現した。`intoModule` がキー単位で双方向に突き合わせるのが現行の答え。
2. **nullable のラッパー** — フォーム内部では `{__null:false, v:…}`。存在チェックや素の値比較は
   **必ずすり抜ける**(type=null 事件、GPU 掃除のカード残留)。ガードも比較も**値**に対して書く。
3. **同名別ビルド** — `pkgs.sway` と module が入れる sway は別物(isNixOS パッチ差)。
   Hyprland の `bin/Hyprland` はラッパーで、文字列は `.Hyprland-wrapped` にある。
   「パッケージを見た」は「モジュールが使う物を見た」ことにならない。
4. **環境の穴** — user service の PATH は coreutils だけ / Wayland の配列は `XKB_DEFAULT_LAYOUT` /
   sddm の PAM は `include login` の1行で sddm 側スイッチは no-op。
   **評価済みシステムから実ファイルを読む**ことでしか見つかっていない。
5. **CSS の作者規則 vs UA 規則** — `.btn { display:… }` が `[hidden]` を殺した、
   `pre-line` がソースの折返しを改行にした。display を触るときは `[hidden]` リセットの存在を思い出す。
6. **キャッシュによる偽バグ報告** — 修正済みバグの再報告が2回あった。まず生成ファイルのヘッダーの
   build id を確認。古ければコードではなく配布の問題。

## 7. 検証済みと未検証の境界(正直な申告)

**済み**(自動または実機報告で確認):
- 生成→書庫→評価→読み戻し→再選択の全往復。9デスクトップ行列。全プリセットの実システム評価。
- niri / Sway は実機ログインまで**ユーザー確認済み**。Hyprland は理由付きで非表示。
- System update のコマンドは bash/zsh/fish で実行済み(ヘッダー変更後もコマンド生成部は不変)。

**未検証・薄い場所**:
- **実機ログイン以降の動作全般は作者の RC 評価に依存**(これがこの数日の予定)。
- CI(.github/workflows)は fuzz/import_check/構文に加えて、**ブラウザ検査(11項目)とカタログ検査(`tools/catalogue_check.py`)を毎プッシュ回しています**。回していないのは `tools/eval_check.py` だけで、これはピン留めした nixpkgs の取得に数分かかるためリリース前に手で流します(2026-08-12 更新)。
- 翻訳ガード(MutationObserver + data-keep)は実際の Chrome 翻訳では最近試していない。
- unstable チャンネルの経路はしばらく通しで触っていない(仕組みは 25.11 切替テストと同一)。
- モバイルはビューポートのみで実機なし。アクセシビリティはフォーカスリング程度。

## 8. 引き継ぎ後の推奨タスク(優先順)

1. ~~§4 のブラウザ検査を `tools/` に恒久化して CI に載せる~~ **済み(2026-08-12)**:
   `tools/browser_check.py` が11項目、`tools/eval_check.py` が §5 のハーネス。
   前者は CI の browser ジョブで毎プッシュ走る。後者はリリース前に手で回す。
2. RC 評価で出た報告の一次対応。報告には「ヘッダーの nixgen: 行」を必ず添えてもらう。
3. リリース時: README のベータ表記を範囲明示に書き換え → CHANGELOG に rc 見出し → 注釈付きタグ
   `v1.0.0-rc.1` → GitHub prerelease。検証機は `nix run github:hatake716/nixgen/v1.0.0-rc.1` で固定。

## 9. 検証に使える固定データ

- 壊れた入力の作り方は本文中の各スイープに含まれるほか、代表3種は:
  属性二重定義(attrs ブロック+同 leaf のフラット行) / `i18n.inputMethod.type = null` /
  `nixpkgs.hostPlatform = "aarch64-linux"`。
- 文書の数値(24,557 / 144,245 / 88.3% / 1,252 / 5,082)は **CLAUDE.md のスニペットで再計算**する。
  コピーすると必ずずれる。リビジョンは `meta` テーブルにある。
