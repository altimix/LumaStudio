# Luma Studio公式サイト

Cloudflare Workers Static Assets: https://lumastudio.altimix.jp

Node.js 22.12以上を使用します。

```sh
npm ci
npm ci --prefix website
npm run build --prefix website
npm run dev --prefix website
```

`website/build.mjs`がサイトを生成し、リポジトリのREADME.htmlをオンラインマニュアルとして組み込みます。原稿・CSS・画面例はGitで管理し、生成結果の`website/dist`は管理しません。

## 検証

```sh
npx playwright install chromium
node website/verify.cjs
```

開発サーバーの既定ポートと合わせて`SITE_URL`を指定します。verifyの既定は`http://localhost:8791`なので、`npm run dev --prefix website -- --port 8791`で起動できます。`SITE_URL=https://lumastudio.altimix.jp`を設定すると公開後のページ・リンク・検索を検証できます。証跡は`test-results`に保存されます。

## 公開

Cloudflareの対象アカウントにログインし、設定のアカウントとドメインが正しいことを確認します。

```sh
npm run deploy --prefix website
```

`wrangler.jsonc`にカスタムドメインを定義しています。公開先Workerは`lumastudio-official`です。認証情報を設定ファイルに書かないでください。サイトだけの変更で、アプリのリリースや他のWorkerを更新しません。

## 新しいアプリのリリース時

`build.mjs`内のバージョン、配布ファイル名・サイズ、対応条件を新しい公開版に合わせて更新し、README.htmlのマニュアルと整合させます。まだ配布していない機能を提供済みとして掲載しません。公開前後にリンクと表示を検証します。

会社情報の確認元: https://altimix.co.jp/company/ / https://altimix.co.jp/contact/

画面例の映像: Sintel — © Blender Foundation、CC BY 3.0。サイトのaboutページで出典・ライセンス・加工を表示しています。

本番HTTPSを指定した検証では、配布EXE・ZIP・起動手順・SHA256のリンクをリダイレクト対応HEADで確認します。Website CIはローカルの変更案と現在の公開サイトの両方を検証します。未公開版の配布リンクはリリース公開後、サイト更新後の本番検証で確認します。
