# nixgen

NixOSの設定モジュールをフォーム入力で生成するツールです。安定版チャンネルのオプション24,517件とパッケージ144,200件を検索し、型に応じたウィジェットで値を入れると、そのまま`imports`できる`.nix`ファイルが出てきます。

![nixgen](docs/screenshot.png)

生成は一方向のみです。既存の設定ファイルを読むことも書き換えることもしないので、今動いている環境を壊す経路がありません。

English version: [README.md](./README.md)

---

## インストール

必要なのはNixOS、または他のLinux上のNixだけです。pipもnpmも不要で、**cloneも必要ありません。**

### ステップ1 — flakesを有効にする

NixOSを新規インストールした直後は、flakesが有効になっていません。まず確認します。

```bash
nix flake --help
```

ヘルプが表示されたらステップ2へ進んでください。「機能が無効です」というエラーが出た場合は、設定ファイルに次の1行を足します。

```nix
nix.settings.experimental-features = [ "nix-command" "flakes" ];
```

そして適用します。

```bash
sudo nixos-rebuild switch
```

もう一度 `nix flake --help` を実行して、ヘルプが出れば成功です。

### ステップ2 — 起動する

```bash
nix run github:hatake716/nixgen
```

**これでインストールは完了です。** Nixがプログラムを取得・ビルドして起動します。

**初回は5分ほどかかります。** 順に次の処理が走ります。

1. Pythonのラッパーをビルド
2. `nixos-26.05` のオプションとパッケージのメタデータ(約10MB)をダウンロード
3. `~/.local/share/nixgen` に検索インデックス(約37MB)を構築
4. 不要になった生データを削除
5. ブラウザで <http://127.0.0.1:8823/> を開く

3つのペインが表示されるはずです。左に検索ボックス、中央は空、右は暗い背景で生成中のファイルが出ます。検索ボックスに `openssh` と入れて先頭の結果をクリックすれば、動作確認になります。

終了はターミナルで **Ctrl-C** です。インデックスは構築済みなので、2回目以降は1秒ほどで立ち上がります。

### ステップ3 — 常用する(任意)

また使いそうなら、`nixgen` と打つだけで起動できるようにしておきます。

```bash
nix profile install github:hatake716/nixgen
nixgen
```

削除は `nix profile remove nixgen` です。

### ステップ4 — 生成物を使う

**Download generated.nix** を押し、`configuration.nix` と同じ場所(通常は `/etc/nixos/`)に保存します。そしてimportに追加します。

```nix
{
  imports = [
    ./hardware-configuration.nix
    ./generated.nix
  ];
}
```

適用する前に確認します。

```bash
sudo nixos-rebuild dry-build
```

成功したら `sudo nixos-rebuild switch` で適用してください。取り消したくなったら `./generated.nix` の行を消してリビルドするだけです。**他の設定には一切手が入っていません。**

### うまくいかないとき

**`experimental Nix feature 'nix-command' is disabled`**
ステップ1を飛ばしているか、リビルドがまだ済んでいません。

**`does not contain a 'flake.nix', searching up`**
または **`Path 'build' does not exist in Git repository`**
gitリポジトリの中で実行しています。`/etc/nixos` が典型例です。flakesはディスクではなくgitからファイルを読むため、未追跡のファイルはNixから見えません。上記の `github:` 形式を使うか、そのリポジトリで先に `git add -A` を実行してください。

**`Address already in use`**
ポート8823が他で使われています。`nixgen --port 9000` のように変更してください。

**ブラウザが開かない**
<http://127.0.0.1:8823/> を自分で開いてください。ターミナルにもアドレスが出ています。

**やり直したい**
`rm -rf ~/.local/share/nixgen` を実行してから起動し直すと、インデックスが再構築されます。

### ローカルにcloneして使う

コードを変更したい場合のみ必要です。

```bash
git clone https://github.com/hatake716/nixgen.git
cd nixgen
nix run .
```

cloneは既存のgitリポジトリの外に置いてください。理由は上記の注意点と同じです。

---

## 実行時のオプション

```bash
nixgen                       # nix run . でも同じ
nixgen --port 9000           # ポートを変える
nixgen --no-browser          # ブラウザを開かない
nixgen --db /path/to/db      # インデックスを指定する
```

環境変数は2つです。

| 変数 | デフォルト | 用途 |
|---|---|---|
| `NIXGEN_DATA` | `~/.local/share/nixgen` | インデックスの置き場所 |
| `NIXGEN_CHANNEL` | `nixos-26.05` | インデックス化するリリース |

### バージョンを切り替える

```bash
rm -rf ~/.local/share/nixgen
NIXGEN_CHANNEL=nixos-25.11 nixgen
```

対応はリリースチャンネルのみです。unstableを意図的に外している理由は「対応していないこと」の節に書きました。

### 別の端末から使う

サーバは`127.0.0.1`にバインドしており、**認証機構はありません。** 信頼できないネットワークで`0.0.0.0`に変更しないでください。別マシンから使いたい場合はSSHでポートフォワードしてください。

```bash
ssh -L 8823:127.0.0.1:8823 your-desktop
```

そのうえで手元のマシンで <http://127.0.0.1:8823/> を開きます。


### 別の言語で読む

ページは素のHTMLなので、ブラウザ内蔵の翻訳がそのまま使えます。Chromeなら右クリックから「日本語に翻訳」を選ぶだけです。

**翻訳されるのは説明文だけです。** オプションのパス、パッケージ名、型の表記、デフォルト値、生成されたNixコードは英語のまま残ります。`services.openssh.enable`が翻訳されてしまうと、Nixとして成立しなくなるためです。

これらの要素には`translate="no"`を付けていますが、この属性を尊重しないブラウザもあります。そのため各要素は自分の本来のテキストを保持していて、書き換えられたら元に戻します。コードペインについては単純な復元ではなく再描画しているので、シンタックスハイライトも保たれます。


## 公開する

`docs/index.html` は単体で完結するランディングページです。公開するには、リポジトリの **Settings → Pages** で
source を *Deploy from a branch* にして、`main` / `/docs` を選びます。

先に同ファイル内の `YOUR-GITHUB-NAME` を自分のアカウント名に置き換えてください。cloneコマンドとヘッダーのリンクに出てきます。

---

## コードをいじる場合

```bash
nix develop                                  # python3, brotli, curl, sqlite
./build/fetch-data.sh nixos-26.05
python3 build/build_index.py --channel nixos-26.05
python3 build/server.py
```

この手順ではインデックスがホームではなく`./data/`に作られ、ストア内のコピーではなく作業ツリーのファイルが実行されます。

flakesを使わない場合はこれだけでも動きます。

```bash
nix-shell -p python3 brotli curl sqlite
```


### 新規マシン用のスターターファイル

**Setup** タブは、生成モジュールの周りに必要な2つのファイルを出力します。それをimportする `configuration.nix` と、システムをビルドする `flake.nix` です。
ホスト名・ユーザー名・アーキテクチャを入力すると、右のタブに `generated.nix` と並んで現れます。

スターターの `configuration.nix` は全ての定義を `lib.mkDefault` で包んでいます。これが無いと、同じオプションを両方のファイルで設定したときに次のエラーになります。

```
error: The option `networking.hostName' has conflicting definition values
```

`mkDefault` があれば、nixgen側で設定した値がそのまま優先されます。

---

## Check syntax について

アプリ内のボタンが実行しているのは `nix-instantiate --parse` です。括弧の不一致やセミコロンの抜けといった、
Nixとして壊れた記述は捕まえます。しかし**値の型が正しいかどうか、オプションの組み合わせが成立するかどうかは見ていません。**

そこを判定できるのは `nixos-rebuild dry-build` だけです。switchする前に必ず実行してください。

---

## 既存のconfiguration.nixを読み込む

**Import configuration.nix** を押してファイルを選ぶと、設定済みの項目がカタログと照合されてフォームに反映されます。値も一緒に入ります。ファイルは読み取り専用で開かれ、書き換えは一切しません。

読み込みはまず`nix-instantiate --parse`に渡します。**本物のNixパーサに解析させる**ので、ソースを正規表現で殴る必要がありません。返ってくるのは正規化・完全括弧化された形で、`a.b.c = x`はネストしたattrsetに展開済みです。これを辿って平坦化します。

**すべての項目が出力に入ります。** 扱いは3通りに分かれます。

- **フォームに反映。** ウィジェットに載るリテラルの場合です。`true`、`"Asia/Tokyo"`、`[ 22 80 443 ]`、`with pkgs; [ vim git ]` など。`lib.mkForce`と`lib.mkDefault`は中身を取り出します。パス中の名前も拾うので、`services.nginx.virtualHosts."example.com".root`は`<name>`スロットに埋まります。
- **そのまま転記 — モジュール構造。** `imports`、`options`、`disabledModules`は設定ではなくカタログにも載りませんが、`imports`が落ちると`hardware-configuration.nix`が読み込まれず、`fileSystems."/".fsType`が未定義でビルドが失敗します。相対パスを`./…`に復元したうえで転記するので、**出力は読み込んだファイルと同じディレクトリに置いてください。**
- **そのまま転記 — 値が式である。** `lib.mkIf config.foo.enable true`や、`let`で束縛した変数を参照しているものです。フォームは条件分岐を保持できないので、式をそのままの形で出力に書き込みます。
- **そのまま転記 — このリリースに存在しない。** オプションが改名・削除されたか(`hardware.opengl.enable`は26.05で消滅)、`nix.settings`のような自由形式サブモジュールの中にあってカタログに載っていないかのどちらかです。どちらなのかは読み込み結果に表示されます。

転記された行はファイルペインで**色分け表示**され、行末に`# verbatim`コメントが付きます。ダウンロード後も判別できます。並び順は末尾送りではなく、通常のアルファベット順の位置に入ります。

注意点が2つあります。元ファイルの`let`束縛を参照していた式は単体では解決できません。**Check syntax**が該当行を正確に指摘します。存在しなくなったオプションは`nixos-rebuild`が拒否します。捨てずに残して目立たせているのは、まさにそれを気付かせるためです。

---

## しくみ

NixOSは全リリースについて、全オプションの機械可読なメタデータを配信しています。

```
https://channels.nixos.org/nixos-26.05/options.json.br
https://channels.nixos.org/nixos-26.05/packages.json.br
```

`options.json`には各オプションのパス、型、デフォルト値、例、説明文、宣言元ファイルが入っています。このプロジェクトにはオプションごとの手書き定義が一行もありません。カタログ全体がこのファイル由来なので、網羅性は「書く量」ではなく「パースの精度」の問題になります。

厄介なのは`type`フィールドです。これは構造化スキーマではなく、人間向けの文章です。

```
"boolean"
"null or (list of string)"
"16 bit unsigned integer; between 0 and 65535 (both inclusive)"
"attribute set of (submodule)"
```

チャンネル全体で**1,247種類**の型文字列が存在します。`nixgen_core.py`はこれを小さな型ツリー(`nullable` / `list` / `attrs` / `enum` / `int` / `str` / `lines` / `path` / `package` / `bool`)に変換し、UIがノードごとにウィジェットを選びます。

**専用ウィジェットに対応できるのは全体の88.3%(24,518件中21,652件)です。** 残りは型文字列と上流のサンプルを表示したうえで、Nix式を直接書くテキストボックスにフォールバックします。ただしフォールバックの大半は`attribute set of (submodule)`のようなコンテナの親であり、その子(`services.nginx.virtualHosts.<name>.root`など)は独立したオプションとして完全に対応しています。実際にフォームで埋められないものの割合は12%よりかなり低いはずです。

### 検索

24,517件のツリーを人間が辿るのは不可能なので、実質的な操作系は検索です。結果は「クエリがパスにどう一致したか」で段階分けし、そのあと階層の浅さ、末尾が`.enable`かどうか、トップレベル名前空間の一般性の順に並べます。

効いているのは**セグメント単位の一致判定**です。`firewall`と打つと`networking.firewall.enable`が先頭に来ます。こちらは`firewall`がドット区切りの完全なセグメントであるのに対し、`services.firewalld.enable`は部分文字列として含んでいるだけだからです。

`build_index.py`の`NS_RANK`にある名前空間の重み付けは単なるヒューリスティックで、同点時の並べ替えにしか使いません。検索でヒットする範囲そのものは変えません。

### 正しさの検証

レンダラは本物のNixパーサでファジングしています。1回につきランダムな8,000オプション、それを8シード分。値には敵対的なもの(クォート、バックスラッシュ、`${`、改行、`''`、空文字列、日本語)を、`<name>`の置換にも敵対的なもの(スペース、ドット、空、Nix予約語)を入れています。全て`nix-instantiate --parse`を通過します。

この過程で実際に見つかったバグが3件あり、いずれも修正済みです。

| バグ | 影響範囲 |
|---|---|
| プレースホルダは`<name>`だけではない。`<n>`、`*`、さらに`<imports = [ pkgs.ghostunnel... ]>`のような上流のノイズもある | 5,031件(全体の20%)が該当 |
| `[ -1 ]`は構文エラー。負数には括弧が必要 | リスト内の`signed integer`全般 |
| `if` / `rec` / `or` / `let` などの予約語は属性名としてクォートが必要 | systemdサービス名が`if`だった場合など |

属性パスはセグメント単位でレンダリングし、通常の識別子でないセグメントは自動でクォートします。そのため`my site.example.com`という名前のvhostは、壊れたNixではなく`services.nginx.virtualHosts."my site.example.com"`として出力されます。

---

## 対応していないこと

**unstable。** オプションとモジュールはチャンネルをまたいで混在させられません。unstableの`services.foo.*`はunstableのモジュールセットを前提にしているため、安定版のシステム向けに出力する手段がそもそも存在しません。パッケージだけならoverlayで混ぜられますが、それをやると出力形式が変わるうえ、オプション側は依然として嘘をつくことになります。1チャンネル・1つの真実、という切り分けにしています。

**既存設定への書き戻し。** 読み込みは上記の通り対応しました。しかし構造とコメントを保ったまま値を書き戻すのは桁違いに難しい問題で、失敗したときの代償が「動いているシステムの破壊」です。読み込みが安全なのは、読むだけだからです。

**型チェック。** 判断できるのは`nixos-rebuild dry-build`だけです。

**submoduleコンテナを一括で設定すること。** 設定できるのは`services.nginx.virtualHosts.<name>.root`であって、`services.nginx.virtualHosts`をひとかたまりとしてではありません。

---

## 構成

```
build/
  nixgen_core.py    型文字列パーサ + Nixレンダラ(依存なし)
  nix_import.py     既存のconfiguration.nixの読み込み
  starter.py        Setupタブの configuration.nix / flake.nix
  build_index.py    チャンネルJSON -> SQLite + FTS5
  server.py         標準ライブラリのみのHTTPサーバ。検索/生成/検証API
  fetch-data.sh     チャンネルのダウンロード
  static/           UI(バニラJS、ビルド工程なし)
data/
  nixgen.sqlite     生成されるインデックス
docs/
  index.html        GitHub Pages 用のランディングページ
  screenshot*.png
flake.nix
```

pipもnpmも使いません。必要なのはPythonの標準ライブラリとブラウザだけです。

---

## ライセンス

MIT — [LICENSE](LICENSE) を参照してください。生成されたファイルはTakeshiさん自身のものです。
ライセンスが及ぶのはこのツールであって、その出力ではありません。

