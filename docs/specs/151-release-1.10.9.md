# 1.10.9の正式配布

Issue: https://github.com/altimix/LumaStudio/issues/151

Issue #149・PR #150のトリムつまみの表示改善を1.10.9で配布する。波形があるクリップの選択表示は083-waveform-gain.mdに従う。

- アプリ、ロックファイル、README、HTML操作ガイド、Windows / Macの起動ガイド、公式サイトを1.10.9へ揃え、過去の更新履歴を残す。
- 音声や音声付き動画の選択中のトリムつまみを名前欄内の小さな白い括弧形で示し、静かな末尾で波形ピークと見分けやすくしたことを案内する。左右端の全高の操作領域、トリム、レート変更、音量ポイント、ロック、Undo / Redoは維持する。
- この更新では音声デコードや波形ピークを変更しない。元音声に含まれる音の除去を行ったという説明はしない。
- 最終ソースで基本検証、Windows / macOSのpackageとverify:packaged、Website CI、CodeQL、Codexレビューを確認する。保存・再読込・ロック・Undo / Redo、再生、MP4/MP3出力の回帰を確認する。
- 最終ソースに一致するCI由来のWindows x64 EXEとMac arm64 ZIPを公開し、内蔵版数、Mac署名、ガイド、ライセンス、メディアツールの対応ソース、SHA256を照合する。既存タグ・リリースは上書きしない。
- 公開アセットはEXE、ZIP、README.html、両OS起動ガイド、LICENSE、COPYRIGHT、BGM-LICENSE.txt、THIRD_PARTY_NOTICES.md、media-sources.zip、SHA256SUMS.txtの11件とする。SHA256SUMS.txtは自身を除く10件を含め、両OSのソースアーカイブを集約する。
- GitHub Release公開後に公式サイトへ配備し、PC/390pxの表示、マニュアル検索、SEO、404、Windows/Mac配布リンクとチェックサムをHTTPS本番で確認する。

公式サイトの学校で気軽に使う動画編集アプリという位置付けと、1.10.7で撮影した編集画面例の版数表示を保持する。Windowsの未署名、Macのad-hoc署名・未公証の説明を保持する。ユーザー提供の音声やプロジェクト、ローカルの検証画面は公開しない。
