# 公開初版 1.0.0

公開先はaltimix/LumaStudio。初期取り込みは新しいGit履歴として行い、旧Issue・PR・コミットは移さない。
Windows x64 / Mac arm64に対応し、素材・タイムラインは空で起動する。BGM001〜005を選択して利用できる。

アプリはGPL-3.0-only。第三者ライセンスを保持する。FFmpegとFFprobeは共有の固定ソースからビルドし、nonfree構成を使用しない。ソースアーカイブとビルド手順を配布する。

受け入れ条件: npm ci、verify:demo、verify:readme、npm test、build、両OSのpackageとverify:packaged成功。外部開発者が公開リポジトリと公開ビルド素材だけでビルドできること。公開ファイルに認証情報・個人データを含めないこと。
