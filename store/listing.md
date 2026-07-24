# ストア掲載文案

## スクリーンショット（ダッシュボードにアップロード）

- `assets/screenshot1.png` … プロフィールでの表示例
- `assets/screenshot2.png` … アクティビティ表示例

## 短い説明（132文字以内）

dアニメストアで視聴中の作品名・話数・サブタイトルを Discord のステータスに表示します。ネイティブアプリのインストールが別途必要です。

## 詳細説明

【できること】
- dアニメストア再生中の作品名を Discord Presence に表示
- 話数・サブタイトル・再生進捗の表示
- （任意）作品サムネイルの表示

【必要なもの】
1. この Chrome 拡張
2. ネイティブホスト（Windows / 下記コマンドでインストール）
3. Discord デスクトップアプリ

※ Discord Application の作成は不要です。拡張だけでは動作しないため、必ずネイティブホストも入れてください。

【リポジトリ】
https://github.com/MametaroGG/d_anime_discord_presence

※ Chrome ウェブストア開発者ダッシュボードの「ウェブサイト」欄も、必ず上記 URL にしてください。
　ストア公開版では、この欄が「拡張機能のウェブサイトを開く」に使われることがあります（manifest の homepage_url より優先される場合あり）。

【ネイティブホストのインストール（PowerShell）】
iwr "https://raw.githubusercontent.com/MametaroGG/d_anime_discord_presence/main/installer/windows.ps1" | iex

【使い方】
1. この拡張をインストール
2. 上記の PowerShell コマンドでネイティブホストをインストール
3. Chrome を再起動
4. Discord を起動した状態で dアニメストアを再生
5. プレイヤーの時間表示を「現在 / 総時間」形式にする

【プライバシー / 利用規約】
視聴情報はローカルの Discord にのみ渡し、開発者サーバーへ送信しません。
- プライバシーポリシー: https://mametarogg.github.io/d_anime_discord_presence/store/privacy-policy.html
- 利用規約: https://mametarogg.github.io/d_anime_discord_presence/store/terms.html

【クレジット】
本拡張は kitashimauni/d_anime_discord_presence (MIT) を改変した非公式フォークです。
リポジトリ: https://github.com/MametaroGG/d_anime_discord_presence
