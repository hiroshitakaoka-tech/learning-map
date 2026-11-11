# 小1～中1 原因追跡型・学力診断／補習マップ

公開アプリ: https://hiroshitakaoka-tech.github.io/learning-map/

**Dropboxでの複数利用者記録の共有機能を追加しました。**

Dropboxとの同期を有効にするには、管理者によるOAuthアプリ認可とCloudflare Workerの初期設定が必要です。未設定のままでも、以前と同じ端末内保存・JSONバックアップ機能は使用できます。

初期設定の手順: [SYNC_SETUP.md](./SYNC_SETUP.md)

管理者用認可画面: https://hiroshitakaoka-tech.github.io/learning-map/setup.html


## GitHub Pages 公開方法

1. GitHub で `learning-map` という新しい **Public** リポジトリを作成。
2. このフォルダ内の `index.html` と `.nojekyll` をリポジトリのルートにアップロード。ZIPファイルをそのままアップロードしないこと。
3. リポジトリの **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: main / (root) → Save** を指定。
4. 公開後のURL例は `https://<GitHubユーザー名>.github.io/learning-map/`。実際のURLはPages設定画面で確認。
5. GitHub PagesはHTTPSで公開されるが、サイト自体は原則インターネットから誰でも閲覧できる。**児童の記録JSONやCSV/HTMLレポートをリポジトリへアップロードしない。**

## 診断記録（オンライン同期を設定していない場合）

- ブラウザー内のローカル保存（localStorage）。公開サーバーへ送信されず、端末・ブラウザー間では自動同期しない。
- 「④ 記録一覧」で閲覧、絞り込み、HTML・CSVのダウンロードが可能。
- 「記録をJSONでバックアップ」で、別端末へ復元・移行できる。インポートは既存記録と**置き換え**るため、その前にバックアップする。
- 旧ファイルをMacで使っていた場合、そのブラウザーで以前に書き出したJSONを、新URLのアプリに読み込む必要がある。
- 記録が入ったレポートは家庭内のDropboxやiCloud Driveなど非公開の場所に保管する。一般公開リンクは作らない。
- Webサイトの更新で通常記録は維持されるが、Safariがサイトデータを削除する場合もあるため定期的にJSONバックアップする。
- インドネシア語の課題は全274件に参考訳を付けているが、翻訳や課題の妥当性について専門的な確認が必要な部分がある。

## 注意

GitHub Pagesだけでは同期できません。現在はCloudflare Worker経由でDropboxに利用者別JSONを保存する機能を追加済みです。認証と接続の初期設定は SYNC_SETUP.md を参照してください。