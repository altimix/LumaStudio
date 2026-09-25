# 1.10.5の正式配布

Issue: https://github.com/altimix/LumaStudio/issues/126

Issue #124 のタイムライン音声MP3書き出しを1.10.5で配布する。操作、音声処理、保存と中止の条件は `124-mp3-audio-export.md` に従う。

- アプリ、ロックファイル、HTMLマニュアル、Windows / Macの起動ガイド、公式サイトを1.10.5へ揃え、1.10.4までの更新履歴を残す。
- MP3は動画内の音声、分離した音声、BGMを48 kHz・ステレオ・192 kbpsで保存し、映像ストリームを含めない。音声だけのプロジェクトを扱い、音声のないプロジェクトは保存先を尋ねる前に拒否する。
- 最終コミットでWindows / macOS CI、配布アプリのMP3書き出し・再取り込み・音声再生、Website CI、Codexレビューを確認する。既存のMP4経路も回帰確認する。
- 最終ソースに一致するCI由来のWindows x64 EXEとMac arm64 ZIPを使い、内蔵版数、Mac署名、ガイド、ライセンス、メディアツール、SHA256を照合する。既存タグやリリースは上書きしない。
- GitHub Release公開後に公式サイトを配備し、マニュアル、SEO、404、Windows/Macの配布リンクとチェックサムをHTTPS本番で確認する。
