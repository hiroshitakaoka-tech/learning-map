# Dropbox共有記録の初期設定

学力診断マップ: https://hiroshitakaoka-tech.github.io/learning-map/

## 構成と注意
- GitHub Pages: 静的HTML、274診断課題、記録画面
- Cloudflare Worker: 共通アクセスコードの検証・Dropbox APIとの通信
- Dropbox: `/原因追跡型学力診断/records/u-xxxxxxxxxxxxxxxxxxxxxxxx.json` に利用者別保存
- 診断記録、Dropboxアクセストークン、共通アクセスコードをGitHubに書き込まないでください。
- 氏名は「記録者の選択」であり、本人認証ではありません。共通アクセスコードを知る人は、他の利用者名も選択できます。
- 既存の端末内記録（localStorage）とJSONバックアップ機能は残ります。共有を設定するまで従来通り使えます。
- 共有記録は児童の情報を含むため、学校の規程と個人情報の取扱いについて別途確認してください。

## 1. Dropboxアプリの作成（管理者のみ）
https://www.dropbox.com/developers/apps

「Create app」を開き、Scoped access → Full Dropbox を選択し、任意の名前で作成。
※ 既存の共有フォルダを使用するため、App folder方式ではなくFull Dropboxが必要です。
※ 認可されたアプリには共有フォルダ以外もAPI権限が及びます。重要な他のDropboxデータがある場合は専用アカウントの利用を検討してください。

Permissions で以下にチェックを入れ、Saveします：
- files.metadata.read
- files.content.read
- files.content.write

Settings → OAuth2 → Redirect URIs に正確に次を追加：
`https://hiroshitakaoka-tech.github.io/learning-map/setup.html`

## 2. 管理者のDropbox認可（初回のみ）
https://hiroshitakaoka-tech.github.io/learning-map/setup.html

Dropboxアプリの **App key** を入力し、管理者自身のDropboxアカウントで認可。
表示された `DROPBOX_APP_KEY` と `DROPBOX_REFRESH_TOKEN` を **CloudflareのSecretへだけ** 入力してください。
ChatGPT、GitHub、メールやチャットには送らないでください。

## 3. Cloudflare Workerの作成（管理者のみ）
https://dash.cloudflare.com/

Workers & Pages → Create → Worker を作成（例: `learning-map-sync`）。
表示されたデフォルトコードを、次のファイルの全内容に置換し、Deployします。

https://github.com/hiroshitakaoka-tech/learning-map/blob/main/worker/worker.js

Worker → Settings → Variables and Secrets に、Type **Secret** として次の3つを作成：
1. `DROPBOX_APP_KEY`: 上記2のApp key
2. `DROPBOX_REFRESH_TOKEN`: 上記2で発行した長期更新トークン
3. `MAP_ACCESS_CODE`: 教員・保護者にだけ渡す推測困難な共通アクセスコード（長い英数字を推奨）

Secretを反映させるため再Deployします。
Workerの公開URLは `https://任意の名前.サブドメイン.workers.dev` の形です。
`https://(Worker URL)/health` にアクセスして `"configured":true` と表示されるか確認します。
`/health` は設定状況のみ表示し、トークンなどは表示しません。

## 4. マップ側から接続
https://hiroshitakaoka-tech.github.io/learning-map/

上部の「☁ Dropbox共有記録」を開き、
**氏名**、**立場**、**共通アクセスコード**、**Worker URL** を入力し、「この氏名でDropboxに接続」を押します。
初回は自動で `records` フォルダと、使用者ごとのJSONを作成します。
以後、項目の「この項目の記録を保存」で端末とDropboxの両方に保存します。

別端末では同じ氏名・立場・Worker URL・アクセスコードを使います。
初回接続時、旧端末の記録がある場合は、自動上書きされないようバックアップ確認が表示されます。

## 5. 記録の閲覧・書き出し
同じマップの「☁ Dropbox共有記録」から「全員の記録一覧」を開く。
全員のCSV・HTML形式のファイルを出力できます。
従来の「④ 記録一覧」では選択中の使用者のJSON・CSV・HTMLを出力できます。

## 6. 二重更新・バックアップ
Dropboxのファイル改訂番号（rev）で同時編集を検知し、古い記録からの上書きを拒否します。
競合時はこの端末のJSONを書き出してからDropboxを読み直し、内容を確認してください。
Dropboxとの通信に失敗しても、記録は端末内に残ります。手動で「Dropboxへ保存」を再実行します。
Dropboxの共有リンクを知るだけでは、Workerの認証なしにAPIから更新できません。

## 未完了の前提
このリポジトリにはWorkerコードがありますが、CloudflareへのDeploy、Dropbox APIアプリ作成と認可、3つのSecretの登録は別途管理者作業が必要です。完了するまでオンライン同期は動作しません。
