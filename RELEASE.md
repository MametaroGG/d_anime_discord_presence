# Chrome Web Store 公開手順（dアニメ Discord Presence+）

このフォークを Chrome Web Store で公開するためのチェックリストです。  
元プロジェクト ([kitashimauni/d_anime_discord_presence](https://github.com/kitashimauni/d_anime_discord_presence), MIT) の派生物です。

## 0. 前提

- Google アカウント（Chrome Web Store 開発者登録、一度きりの登録料あり）
- Discord アカウント
- このリポジトリを自分の GitHub にフォーク／公開できること（プライバシーポリシー URL 用）

## 1. Discord Application を自分で作る（必須）

1. [Discord Developer Portal](https://discord.com/developers/applications) を開く
2. **New Application** → 名前は Presence に出る名前（例: `アニメ`）
3. 左メニュー **Rich Presence → Art Assets** で、フォールバック用に `presence_icon` をアップロード（任意だが推奨）
4. **General Information** の **Application ID** を控える

> 他人の Application ID のまま公開しないでください。

## 2. プライバシーポリシーと利用規約を公開する（必須）

1. `store/privacy-policy.html` と `store/terms.html` を自分のリポジトリに置く
2. GitHub Pages 等で HTTPS 公開する  
   例:
   - `https://<user>.github.io/<repo>/privacy-policy.html`
   - `https://<user>.github.io/<repo>/terms.html`
3. Chrome Web Store の掲載設定で、両方の URL を登録する
4. `extension/manifest.json` の `homepage_url` をリポジトリまたはポリシーページに更新

## 3. 拡張をパッケージする

```powershell
cd <repo>
.\installer\pack-store.ps1
```

生成物: `dist/danime-discord-presence-plus-store.zip`  
（中に `key.pem` を含め、manifest から `key` フィールドは除去済み）

## 4. Chrome Web Store にアップロード

1. [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole) → **新しいアイテム**
2. zip をアップロード（最初は下書きで可）
3. **アイテム ID**（拡張 ID）を控える
4. ストア掲載情報を入力（文面案は `store/listing.md`）
5. プライバシーポリシー URL を設定
6. 審査へ提出

## 5. ネイティブホストを公開する（利用者向け）

利用者は Discord App ID / 拡張 ID を意識しません。配布側で次を固定します。

- `installer/windows.ps1` 内の `$DISCORD_APP_ID` / `$EXTENSION_ID`
- GitHub Releases に `d_anime_discord_presence.exe` を添付

ローカル確認用:

```powershell
cargo build --release
.\installer\windows-plus.ps1 -DiscordAppId "<YOUR_APP_ID>" -ExtensionId "<STORE_EXTENSION_ID>"
```

利用者向けインストール（README 掲載用）:

```powershell
iwr "https://raw.githubusercontent.com/MametaroGG/d_anime_discord_presence/main/installer/windows.ps1" | iex
```

**拡張だけでは動きません。** README に必ずワンライナーを書いてください。

## 6. ローカル確認

1. ストア版を入れた Chrome で拡張を有効化
2. Discord を起動
3. dアニメで再生し、時間表示を `{現在}/{総時間}` にする
4. プロフィールでタイトル・話数・サブタイトル・サムネを確認
5. 拡張の「詳細」→ 設定でサムネ OFF も確認

## 注意

- サムネイルは作品画像の再表示です。デフォルト ON、設定で OFF 可能にしています
- 既存の公式ストア拡張と名前が近いので、説明文で「非公式フォーク／別作者」を明記してください
- MIT ライセンス表記と、元作者へのクレジットを残してください
