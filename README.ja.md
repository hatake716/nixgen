# nixgen

NixOSの全オプションをフォームで扱うツールです。安定版チャンネルの24,517オプションと144,200パッケージを検索し、型に応じたウィジェットで値を入れると、そのまま `imports` できる `.nix` モジュールが出てきます。

![nixgen](docs/screenshot.png)

- **検索** — 厳選された一部ではなく、全オプション・全パッケージが対象です
- **読み込み** — 既存の `configuration.nix` を取り込めます。読むだけで、書き換えはしません
- **雛形生成** — Setupタブが、生成モジュールの周りに必要な `configuration.nix` と `flake.nix` を出力します

必要なのはPythonの標準ライブラリとブラウザだけ。pipもnpmもビルド工程もありません。

English: [README.md](./README.md) ·
ホームページ: <https://hatake716.github.io/nixgen/>

---

## インストール

必要なのはNixOS、または他のLinux上のNixだけです。**cloneも必要ありません。**

### ステップ1 — flakesを有効にする

NixOSを新規インストールした直後は、flakesが有効になっていません。まず確認します。

```bash
nix flake --help
```

ヘルプが表示されたらステップ2へ進んでください。「機能が無効です」というエラーが出た場合は、設定ファイルに次の1行を足します。

```nix
nix.settings.experimental-features = [ "nix-command" "flakes" ];
```

適用したあと、もう一度 `nix flake --help` を実行してヘルプが出れば成功です。

```bash
sudo nixos-rebuild switch
```

### ステップ2 — 起動する

```bash
nix run github:hatake716/nixgen
```

**これでインストールは完了です。**

**初回は5分ほどかかります。** 順に次の処理が走ります。

1. Pythonのラッパーをビルド
2. `nixos-26.05` のオプションとパッケージのメタデータ(約10MB)をダウンロード
3. `~/.local/share/nixgen` に検索インデックス(約37MB)を構築
4. 不要になった生データを削除
5. ブラウザで <http://127.0.0.1:8823/> を開く

3つのペインが表示されるはずです。左が検索、中央が空、右が暗い背景で生成中のファイルです。検索ボックスに `openssh` と入れて先頭の結果をクリックすれば、動作確認になります。

終了はターミナルで **Ctrl-C** です。インデックスは構築済みなので、2回目以降は1秒ほどで立ち上がります。

### ステップ3 — 常用する(任意)

```bash
nix profile install github:hatake716/nixgen
nixgen
```

これで `nixgen` がPATHに入ります。削除は `nix profile remove nixgen` です。

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

---

## 使い方

### 探す

24,517件のツリーを人間が辿るのは不可能なので、**実質的な操作系は検索です。** サービス名を打てば、たいてい目的のオプションが先頭に来ます。**Options** と **Packages** のタブが検索するのは、NixOSマニュアルの生成元と同じカタログです。

*Hide options that need hand-written Nix* にチェックを入れると、専用ウィジェットを持つ88.3%だけに絞り込めます。

### 既存のconfiguration.nixを読み込む

**Import configuration.nix** を押してファイルを選ぶと、設定済みの項目がカタログと照合されてフォームに反映されます。値も一緒に入ります。ファイルは読み取り専用で開かれ、書き換えは一切しません。

読み込みはまず `nix-instantiate --parse` に渡します。**本物のNixパーサに解析させる**ので、ソースを正規表現で殴る必要がありません。返ってくるのは正規化・完全括弧化された形で、`a.b.c = x` はネストしたattrsetに展開済みです。これを辿って平坦化します。

**すべての項目が出力に入ります。** 扱いは4通りに分かれます。

| | 内容 |
|---|---|
| **フォームに反映** | ウィジェットに載るリテラル。`lib.mkForce` と `lib.mkDefault` は中身を展開し、パス中の名前は `<name>` スロットに入るので `services.nginx.virtualHosts."example.com".root` も扱えます |
| **そのまま転記 — モジュール構造** | `imports`、`options`、`disabledModules`。設定ではありませんが、`imports` を落とすと `hardware-configuration.nix` が読み込まれません。相対パスは `./…` に復元します |
| **そのまま転記 — 値が式** | `lib.mkIf` や `let` 参照。フォームは条件分岐を保持できないので、式をそのままの形で書き込みます |
| **そのまま転記 — このリリースに無い** | 改名・削除されたか(`hardware.opengl.enable` は26.05で消滅)、`nix.settings` のような自由形式サブモジュールの中にあります |

`imports` については1点だけ調整が入ります。**`./generated.nix` への参照は削除されます。** 生成されたファイルが自分自身をimportすることはできないためです。そのままだと `nixos-rebuild` が `stack overflow; max-call-depth exceeded` で失敗し、しかもどこが原因か一切示されません。削除した場合は読み込み結果に表示されます。

転記された行はファイルペインで**色分け表示**され、行末に `# verbatim` コメントが付きます。ダウンロード後も判別できます。並び順は末尾送りではなく、通常のアルファベット順の位置に入ります。

注意点が2つあります。元ファイルの `let` 束縛を参照していた式は単体では解決できません。**Check syntax** が該当行を正確に指摘します。存在しなくなったオプションは `nixos-rebuild` が拒否します。捨てずに残して目立たせているのは、まさにそれに気付かせるためです。

### 新規マシン用のスターターファイル

**Setup** タブは、生成モジュールの周りに必要な2つのファイルを出力します。それをimportする `configuration.nix` と、システムをビルドする `flake.nix` です。右のタブに `generated.nix` と並んで現れ、入力に応じてその場で書き換わります。

**中身はすべて編集できます。**

| 項目 | 補足 |
|---|---|
| Host name | `networking.hostName` と、flakeの `nixosConfigurations.<host>` になります |
| Main user | `isNormalUser` で作られるアカウント。*Create the user account* を外せばユーザー定義ごと省けます |
| Architecture | `x86_64-linux` / `aarch64-linux` |
| Boot loader | systemd-boot(UEFI)、GRUB(BIOS・ディスクを指定)、または他のモジュールに任せる「none」 |
| NetworkManager | 外すと `networking.networkmanager.enable` の行ごと消えます |
| Flakes | 外すと `nix.settings.experimental-features` の行ごと消えます |
| Groups | `wheel` が sudo を使うための指定です。`docker`・`libvirtd`・`video` などを追加できます |
| `system.stateVersion` | インデックス中のリリースが初期値。**新しいNixOSに合わせて上げないでください** |

**オフにした項目はコメントアウトではなく行ごと消えます。** 実際に指定したものだけが残るので、ファイルが無駄に長くなりません。

スターターの `configuration.nix` は、全ての定義を `lib.mkDefault` で包んでいます。これが無いと、同じオプションを両方のファイルで設定したときに次のエラーになります。

```
error: The option `networking.hostName' has conflicting definition values
```

`mkDefault` があれば、nixgen側で設定した値がそのまま優先されます。

### 両方のファイルが同じオプションを設定した場合

スターターの `configuration.nix` と `generated.nix` が同じオプションを定義することがあります。該当する行はファイルペインで**赤字**になり、カードにも *also in configuration.nix* のバッジが付きます。

通常は無害です。スターター側は `lib.mkDefault` を使っているので、`generated.nix` の素の値が勝ちます。問題になるのは**両方が `lib.mkDefault` の場合**で、読み込んだ値が式だったためにラッパーごと転記されたときに起こります。

```
error: The option `networking.hostName' has conflicting definition values
```

同じ優先度の定義が2つあり、Nixは推測しません。不要なほうのファイルから該当行を消してください。

### Check syntax にできること・できないこと

実行しているのは `nix-instantiate --parse` です。括弧の不一致やセミコロンの抜けといった、Nixとして壊れた記述は捕まえます。しかし**値の型が正しいかどうか、オプションの組み合わせが成立するかどうかは見ていません。**

そこを判定できるのは `nixos-rebuild dry-build` だけです。switchする前に必ず実行してください。

### 別の言語で読む

ページは素のHTMLなので、ブラウザ内蔵の翻訳がそのまま使えます。Chromeなら右クリックから「日本語に翻訳」を選ぶだけです。

**翻訳されるのは説明文だけです。** オプションのパス、パッケージ名、型の表記、デフォルト値、生成されたNixコードは英語のまま残ります。`services.openssh.enable` が翻訳されるとNixとして成立しなくなるためです。これらには `translate="no"` を付けていますが、尊重しないブラウザもあるため、各要素は本来のテキストを保持していて、書き換えられたら元に戻します。

### コマンドラインオプション

```bash
nixgen                       # nix run github:hatake716/nixgen でも同じ
nixgen --port 9000           # ポートを変える
nixgen --no-browser          # ブラウザを開かない
nixgen --db /path/to/db      # インデックスを指定する
```

| 変数 | デフォルト | 用途 |
|---|---|---|
| `NIXGEN_DATA` | `~/.local/share/nixgen` | インデックスの置き場所 |
| `NIXGEN_CHANNEL` | `nixos-26.05` | インデックス化するリリース |

バージョンを切り替えるときは、インデックスを消してチャンネルを指定します。

```bash
rm -rf ~/.local/share/nixgen
NIXGEN_CHANNEL=nixos-25.11 nixgen
```

対応はリリースチャンネルのみです。unstableを意図的に外している理由は「対応していないこと」に書きました。

### 別の端末から使う

サーバは `127.0.0.1` にバインドしており、**認証機構はありません。** 信頼できないネットワークで `0.0.0.0` に変更しないでください。SSHでポートフォワードしてください。

```bash
ssh -L 8823:127.0.0.1:8823 your-desktop
```

そのうえで手元のマシンで <http://127.0.0.1:8823/> を開きます。

---

## しくみ

### オプションごとの手書き定義は一行もありません

NixOSは全リリースについて、全オプションのメタデータを機械可読な形で配信しています。

```
https://channels.nixos.org/nixos-26.05/options.json.br
https://channels.nixos.org/nixos-26.05/packages.json.br
```

`options.json` には各オプションのパス、型、デフォルト値、例、説明文、宣言元ファイルが入っています。カタログ全体がこのファイル由来なので、網羅性は「書く量」ではなく「パースの精度」の問題になります。

厄介なのは `type` フィールドです。構造化スキーマではなく人間向けの文章で、しかも1,247種類あります。

```
"boolean"
"null or (list of string)"
"16 bit unsigned integer; between 0 and 65535 (both inclusive)"
"attribute set of (submodule)"
```

`nixgen_core.py` がこれを小さな型ツリー(`nullable` / `list` / `attrs` / `enum` / `int` / `str` / `lines` / `path` / `package` / `bool`)に変換し、UIがノードごとにウィジェットを選びます。**24,517件中21,652件、88.3%が専用ウィジェットに対応します。** 残りは型文字列と上流のサンプルを表示したうえで、Nix式の直接入力にフォールバックします。

ただしその大半は `attribute set of (submodule)` のようなコンテナの親であり、子は独立したオプションとして完全に対応しています。実際にフォームで埋められないものの割合は12%よりかなり低いはずです。

### 検索の並び順

クエリがパスにどう一致したかで段階分けし、階層の浅さ、末尾が `.enable` かどうか、トップレベル名前空間の一般性の順に並べます。

効いているのは**セグメント単位の一致判定**です。`firewall` と打つと `networking.firewall.enable` が先頭に来ます。こちらは `firewall` がドット区切りの完全なセグメントであるのに対し、`services.firewalld.enable` は部分文字列として含んでいるだけだからです。

`build_index.py` の `NS_RANK` にある名前空間の重み付けは単なるヒューリスティックで、同点時の並べ替えにしか使いません。検索でヒットする範囲そのものは変えません。

### 正しさの検証

レンダラは本物のNixパーサでファジングしています。1回につきランダムな8,000オプション。値には敵対的なもの(クォート、バックスラッシュ、`${`、改行、`''`、空文字列、日本語)を、`<name>` の置換にもNix予約語を含む敵対的なものを入れています。全て通過します。

この過程で実際に見つかったバグが3件あります。

| バグ | 影響範囲 |
|---|---|
| プレースホルダは `<name>` だけではない。`<n>`、`*`、さらに `<imports = [ pkgs.ghostunnel... ]>` のような上流のノイズもある | 5,080件(21%)が該当 |
| `[ -1 ]` は構文エラー。負数には括弧が必要 | リスト内の `signed integer` 全般 |
| `if` / `rec` / `or` / `let` などの予約語は属性名としてクォートが必要 | systemdサービス名が `if` だった場合など |

属性パスはセグメント単位でレンダリングし、通常の識別子でないセグメントは自動でクォートします。`my site.example.com` という名前のvhostは、壊れたNixではなく `services.nginx.virtualHosts."my site.example.com"` になります。

スターターファイルも同じ方針で検証しています。スタブの `hardware-configuration.nix` を用意し、**実際のNixOSシステムとして `config.system.build.toplevel` まで評価**して確認しました。

---

## 対応していないこと

**unstable。** オプションとモジュールはチャンネルをまたいで混在させられません。unstableの `services.foo.*` はunstableのモジュールセットを前提にしているため、安定版のシステム向けに出力する手段がそもそも存在しません。パッケージだけならoverlayで混ぜられますが、それをやると出力形式が変わるうえ、オプション側は依然として嘘をつくことになります。1チャンネル・1つの真実、という切り分けにしています。

**既存ファイルへの書き戻し。** 読み込みは対応していますが、構造とコメントを保ったまま値を書き戻すのは桁違いに難しい問題で、失敗したときの代償が「動いているシステムの破壊」です。読み込みが安全なのは、読むだけだからです。

**型チェック。** 判断できるのは `nixos-rebuild dry-build` だけです。

**submoduleコンテナを一括で設定すること。** 設定できるのは `services.nginx.virtualHosts.<name>.root` であって、`services.nginx.virtualHosts` をひとかたまりとしてではありません。

---

## 開発

```bash
git clone https://github.com/hatake716/nixgen.git
cd nixgen
nix develop                                  # python3, brotli, curl, sqlite
./build/fetch-data.sh nixos-26.05
python3 build/build_index.py --channel nixos-26.05
python3 build/server.py
```

この手順ではインデックスがホームではなく `./data/` に作られ、ストア内のコピーではなく作業ツリーのファイルが実行されます。cloneは既存のgitリポジトリの外に置いてください。理由は「うまくいかないとき」に書いた通りです。

```
build/
  nixgen_core.py    型文字列パーサ + Nixレンダラ(依存なし)
  nix_import.py     既存のconfiguration.nixの読み込み
  starter.py        Setupタブの configuration.nix / flake.nix
  build_index.py    チャンネルJSON -> SQLite + FTS5
  server.py         標準ライブラリのみのHTTPサーバ。検索・生成・読込・検証
  fetch-data.sh     チャンネルのダウンロード
  static/           UI(バニラJS、ビルド工程なし)
data/
  nixgen.sqlite     生成されるインデックス。gitには入れません
docs/
  index.html        ホームページ。GitHub Pagesが /docs から配信します
  screenshot*.png
flake.nix
flake.lock          nixpkgsを固定し、誰がビルドしても同じ結果にします
```

`docs/index.html` は単体で完結します。フォークする場合は中の `hatake716` へのリンクを書き換え、**Settings → Pages** で `main` / `/docs` を指定してください。

---

## ライセンス

MIT — [LICENSE](LICENSE) を参照してください。生成されたファイルはあなた自身のものです。ライセンスが及ぶのはこのツールであって、その出力ではありません。

NixOSプロジェクトとは無関係の個人プロジェクトです。
