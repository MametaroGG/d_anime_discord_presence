# ストア掲載文案

## スクリーンショット（ダッシュボードにアップロード）

- `assets/screenshot1.png` … Discord プロフィールでの Presence 表示例（ボタン付き）
- `assets/screenshot2.png` … Discord アクティビティ表示例（再生進捗・再生アイコン）

## 短い説明（132文字以内）

dアニメストア視聴中の作品名・話数を Discord に表示。進捗バーや作品／話へのボタン、一時停止表示にも対応。ネイティブホストの別途インストールが必要です。

## 詳細説明

【できること】
- dアニメストア再生中の作品名を Discord Presence（視聴中）に表示
- 話数・サブタイトルの表示
- 再生進捗（シーケンスバー）の表示
- 作品サムネイルの表示（拡張の設定で OFF 可）
- 再生／一時停止アイコンの表示
- 一時停止中はステータスを残し「一時停止中」と表示
- 他人から見えるボタン
  - 「作品ページ」… 作品ページを開く
  - 「この話を視聴」… 再生中の話を開く

【必要なもの】
1. この Chrome 拡張
2. ネイティブホスト（Windows / 下記コマンドでインストール）
3. Discord デスクトップアプリ

※ Discord Application の作成は不要です。
※ 拡張だけでは動作しません。必ずネイティブホストも入れてください。
※ ボタンは自分の画面には出ず、他のユーザーから見たときに表示されます。

【リポジトリ】
https://github.com/MametaroGG/d_anime_discord_presence

※ Chrome ウェブストア開発者ダッシュボードの「ウェブサイト」欄も、必ず上記 URL にしてください。
　ストア公開版では、この欄が「拡張機能のウェブサイトを開く」に使われることがあります。

【ネイティブホストのインストール（PowerShell）】
iwr "https://raw.githubusercontent.com/MametaroGG/d_anime_discord_presence/main/installer/windows.ps1" | iex

【使い方】
1. この拡張をインストールして有効化する
2. 上記の PowerShell コマンドでネイティブホストをインストールする
3. Chrome を再起動する
4. Discord デスクトップアプリを起動する
5. dアニメストアでアニメを再生する
6. プレイヤーの時間表示を「現在の時間 / 総時間」形式にする
7. Discord のプロフィール／アクティビティで Presence を確認する

【プライバシー / 利用規約】
視聴情報はローカルの Discord にのみ渡し、開発者サーバーへ送信しません。
- プライバシーポリシー: https://mametarogg.github.io/d_anime_discord_presence/store/privacy-policy.html
- 利用規約: https://mametarogg.github.io/d_anime_discord_presence/store/terms.html

【クレジット】
本拡張は kitashimauni/d_anime_discord_presence (MIT) を改変した非公式フォークです。
リポジトリ: https://github.com/MametaroGG/d_anime_discord_presence

本拡張は dアニメストア / Discord / Google の公式サービスではありません。
