# Changelog

[English](#english) · [日本語](#日本語)

The version you are running is printed in the header of the app, next to the
option counts.

---

## English

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
