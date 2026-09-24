# 1.10.2の正式配布

Issue: https://github.com/altimix/LumaStudio/issues/105

PR #104で実装したCPU書き出しのスレッド自動選択と、Issue #108 / PR #109のWindowsポータブル版の音声再生修正を配布する。機能の受け入れ条件と測定条件は `cpu-export-performance.md`、音声再生修正は `108-portable-media-tools.md` に従う。倍率をすべてのPCや素材に保証する表現は使わない。モザイクの粒の輪郭、ガウスぼかし、文字起こしのモデル、プロジェクト保存形式は変更しない。

- アプリ、ロックファイル、HTMLマニュアル、Windows / Macガイド、公式サイトを1.10.2へ揃え、1.10.1までの更新履歴を残す。
- リリースPRの同一コミットでWindows / macOS CI、パッケージ版操作検証、Website CI、Codexレビューを確認する。
- Windows CIでは配布EXE内のFFmpeg/FFprobe、展開元を削除した後のMP4書き出し・再取り込み・音声再生を確認する。
- 最終ソースに一致するCI由来のWindows x64 EXEとMac arm64 ZIPを使い、内蔵版数、ガイド、Macの署名、SHA256を照合する。
- 起動ガイド、HTMLマニュアル、ライセンス、メディアツールの対応ソースとビルド手順、SHA256をv1.10.2のGitHub Releaseに添付する。既存タグとリリースは上書きしない。
- リリース後に公式サイトを更新し、PC / 390px幅、マニュアル検索、SEO、404、配布リンクとチェックサムを本番で確認する。
- 公開と確認が完了してからIssue #105を閉じる。
