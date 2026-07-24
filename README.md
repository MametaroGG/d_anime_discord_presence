# dアニメ Discord Presence+

[kitashimauni/d_anime_discord_presence](https://github.com/kitashimauni/d_anime_discord_presence) (MIT) の派生版です。  
dアニメストアで再生中の作品名・話数・サブタイトル・（任意）サムネイルを Discord Presence に表示します。

## 追加機能（本フォーク）

- サブタイトル表示
- 作品サムネイル表示（設定で OFF 可）
- Discord Application ID を `config.json` で指定
- Chrome Web Store 公開用の梱包・手順（`RELEASE.md`）

## ローカルで使う（開発／個人利用）

```powershell
cargo build --release
.\installer\windows-plus.ps1
```

1. `chrome://extensions` でデベロッパーモードをオン
2. 「パッケージ化されていない拡張機能を読み込む」→ `extension` フォルダ
3. Discord を起動して dアニメを再生
4. 時間表示を `{現在}/{総時間}` にする

## Chrome Web Store に出す場合

**必ず** 自分の Discord Application を作り、`RELEASE.md` の手順に従ってください。

```powershell
.\installer\pack-store.ps1
```

## License

MIT（元リポジトリのライセンスを継承）  
Original: [kitashimauni/d_anime_discord_presence](https://github.com/kitashimauni/d_anime_discord_presence)
