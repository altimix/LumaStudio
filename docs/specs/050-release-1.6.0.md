# 1.6.0の正式配布と公式サイト更新

Issue: https://github.com/altimix/LumaStudio/issues/50

クロップ、長方形・楕円・ベジェマスク、クロマキー、数値入力欄の左右ドラッグ、プロジェクト操作中ダイアログの配置改善を1.6.0として公開する。機能の受け入れ条件は `040-video-crop-mask.md`、`041-bezier-mask.md`、`042-chroma-key.md`、`043-number-input-scrub.md`、`044-project-operation-dialog.md` に従い、1.5.0以前の機能と既存プロジェクトの互換性を維持する。

## 配布

- アプリ、ロックファイル、HTMLマニュアル、OS別起動ガイド、公式サイトの版数と配布名を1.6.0に揃える。
- 利用者向けの機能名は「クロマキー」とする。実写比較が完了するまでUltra Key相当などの比較表現は使用しない。
- 最終候補の同一内容でWindows / Mac CI、配布アプリの全検証、Website CI、CodeQL、Codexレビューを確認する。
- 成功したCIのWindows x64 EXEとMac arm64 ZIPを使用し、公開タグとCIのソースツリーを照合する。バージョン、内蔵マニュアル、Macのarm64とad-hoc署名を確認する。
- 起動ガイド、HTMLマニュアル、ライセンス、固定したメディアツールの対応ソース・ビルド手順を添付し、全添付ファイルのSHA256を記録する。既存タグ・リリースは上書きしない。
- Windowsが未署名、MacがDeveloper ID署名・Apple公証未対応であることを、起動ガイド、公式サイト、Release本文で明示する。

## 公式サイト

開発者紹介、教育用途、広告なし、Google Search Console確認タグ、構造化データ、開発者写真を維持したまま、1.6.0のダウンロード先と新機能を掲載する。配布物の公開後に `lumastudio-official` Workerを更新する。

PCと390px幅で全ページ・内部リンク・マニュアル検索・404・SEO情報を検証し、1.6.0のEXE、ZIP、OS別起動ガイド、SHA256SUMSへの公開リンクを確認する。
