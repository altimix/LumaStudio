# 1.10.7の正式配布

Issue: https://github.com/altimix/LumaStudio/issues/138

Issue #132・#133・#134のタイムライン、YouTube制作スタジオ、モニターと数値編集の改善を1.10.7で配布する。各機能の条件は132-timeline-guides.md、055-caption-workspace.md、134-monitor-property-editing.md、043-number-input-scrub.mdに従う。

- アプリ、ロックファイル、README、HTML操作ガイド、Windows / Macの起動ガイド、公式サイトを1.10.7へ揃え、1.10.6までの更新履歴を残す。
- ハサミの切断位置と再生ヘッドのスナップ、48pxを初期値にした1列のトラック操作、Audioへの音声専用配置を案内する。既存プロジェクトの配置は保持する。
- モニターのクリックによる素材・トラック選択、ダブルクリックまたはF2の文字編集、フォーカス中の数値ドラッグとUndo / Redo、YouTubeモニターの拡大と字幕一覧への復帰を案内する。
- 最終ソースで基本検証、Windows / macOSのpackageとverify:packaged、Website CI、CodeQL、Codexレビューを確認する。保存・再読込・ロック・Undo / Redo・MP4画素比較と既存の音声・MP3出力を回帰確認する。
- 最終ソースに一致するCI由来のWindows x64 EXEとMac arm64 ZIPを公開し、内蔵版数、Mac署名、ガイド、ライセンス、メディアツールの対応ソース、SHA256を照合する。既存タグ・リリースは上書きしない。
- GitHub Release公開後に公式サイトへ配備し、PC/390pxの表示、マニュアル検索、SEO、404、Windows/Macの配布リンクとチェックサムをHTTPS本番で確認する。
