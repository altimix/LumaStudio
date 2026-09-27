# 1.10.6の正式配布

Issue: https://github.com/altimix/LumaStudio/issues/130

Issue #128 の文字揃えとコンパクトなテキストプロパティを1.10.6で配布する。文字の配置、保存、キーフレーム、描画の条件は `128-text-alignment-properties.md` に従う。

- アプリ、ロックファイル、README、HTML操作ガイド、Windows / Macの起動ガイド、公式サイトを1.10.6へ揃え、1.10.5までの更新履歴を残す。
- 左・中央・右揃え・均等割付と、影・縁取りの常時表示、説明文を省いたコンパクトなプロパティを案内する。既存プロジェクトは中央揃えを維持する。
- 最終コミットで基本検証、Windows / macOSのpackageとverify:packaged、Website CI、CodeQL、Codexレビューを確認する。文字揃えの保存・再読込・キーフレーム・MP4出力と、既存の編集・音声・出力処理を回帰確認する。
- 最終ソースに一致するCI由来のWindows x64 EXEとMac arm64 ZIPを使い、内蔵版数、Mac署名、ガイド、ライセンス、メディアツールの対応ソース、SHA256を照合する。既存タグやリリースは上書きしない。
- GitHub Release公開後に公式サイトを配備し、マニュアル、SEO、404、Windows/Macの配布リンクとチェックサムをHTTPS本番で確認する。
