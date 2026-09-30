# 1.10.8の正式配布

Issue: https://github.com/altimix/LumaStudio/issues/145

Issue #139・#140・#141の音声境界、再生ヘッドの秒数表示、素材追加のトラック配置を1.10.8で配布する。各機能の条件は139-audio-edges.md、140-playhead-seconds.md、141-outer-tracks.mdに従う。

- アプリ、ロックファイル、README、HTML操作ガイド、Windows / Macの起動ガイド、公式サイトを1.10.8へ揃え、過去の更新履歴を残す。
- 新しい素材を追加すると、映像・画像は字幕やテロップの下の新規Video、音声・BGMは最下部の新規Audioへ再生ヘッドの位置から配置する。既存クリップへ割り込まない。リンクAV、複数素材、Undo / Redoと上限時の原子的拒否を案内する。
- 現在位置の秒数表示と、MP3のゼロ秒シーク・実音声終端・短い境界ランプの修正を案内する。元音声自体に含まれる音の除去を保証する説明はしない。
- 最終ソースで基本検証、Windows / macOSのpackageとverify:packaged、Website CI、CodeQL、Codexレビューを確認する。保存・再読込・ロック・Undo / Redo、再生、MP4/MP3出力の回帰を確認する。
- 最終ソースに一致するCI由来のWindows x64 EXEとMac arm64 ZIPを公開し、内蔵版数、Mac署名、ガイド、ライセンス、メディアツールの対応ソース、SHA256を照合する。既存タグ・リリースは上書きしない。
- 公開アセットはEXE、ZIP、README.html、両OS起動ガイド、LICENSE、COPYRIGHT、BGM-LICENSE.txt、THIRD_PARTY_NOTICES.md、media-sources.zip、SHA256SUMS.txtの11件とする。SHA256SUMS.txtは自身を除く10件を含め、両OSのソースアーカイブを集約する。
- GitHub Release公開後に公式サイトへ配備し、PC/390pxの表示、マニュアル検索、SEO、404、Windows/Mac配布リンクとチェックサムをHTTPS本番で確認する。

公式サイトの編集画面例は1.10.7の実アプリ撮影と明示し、撮影バージョンを保持する。Windowsの未署名、Macのad-hoc署名・未公証の説明を保持する。ユーザー提供の音声やプロジェクト、ローカルの録音・補正コピーは公開しない。
