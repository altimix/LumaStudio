# Luma Studio

altimixが開発する、Windows・macOS向けの日本語動画編集ソフトです。
ソースコードをGPL-3.0-onlyで公開し、研究・教育・個人・商用で利用できます。

[公式サイト](https://lumastudio.altimix.jp/) · [ダウンロード](https://github.com/altimix/LumaStudio/releases/latest) · [操作ガイド](README.html) · [開発手順](docs/DEVELOPMENT.md) · [開発に参加](CONTRIBUTING.md)

## 1.3.0

- 中央から上へVideo1、Video2…、下へAudio1、Audio2…と番号順に表示。どの段でも映像・音声・画像・テロップを配置・編集できます。

- カット境界と図形の重ね合わせで映像が黒くなる問題、音声のつなぎ目のノイズを修正。
- 動画の代表フレーム・字幕などを使うサムネイル生成。横16:9・縦9:16を編集から自動選択し、2MB未満のJPEGで保存。

- Windows x64 / macOS Apple Silicon（M1以降）に対応。
- 素材・タイムラインは空で起動。BGMタブから初期BGM5曲を試聴・追加できます。
- 動画・画像・音声の読込、複数トラック、分割・トリミング、Undo/Redo。
- 日本語テロップ、トランジション、描画、タイムライン上の音量調整、MP4書き出し。
- MacのVideoToolbox、WindowsのNVENC・Quick Sync・AMFに対応。利用できる方式はGPU・ドライバーによって異なり、自動選択では利用可能なGPUを優先します。
- 単一無加工映像などで不要な合成を省き、書き出し処理を軽量化。
- ヘルプのキーボード図と、起動時の更新確認・ダウンロードと手動入れ替えの案内。
- プロジェクト保存、自動保存からの明示的な復元。
- AI字幕・投稿素材の生成は利用者自身のAPI設定が必要です。

## インストール

Releasesから自分のOS用のファイルを取得してください。Node.jsやFFmpegを
別途インストールする必要はありません。

Windows: EXEを開きます。署名されていないため警告が表示される場合があります。
Mac: ZIPを解凍し、Luma Studio.appを「アプリケーション」へ移動します。
Developer ID署名・公証は未対応です。初回の開発元確認で止まる場合は、
同梱の起動説明書を参照してください。Intel Mac・Linux用の配布版はありません。

## ライセンスと参加

Copyright (C) 2026 altimix。アプリケーションは[GPL-3.0-only](LICENSE)。
他の人による利用・改変・再配布・販売もライセンス条件に従って認められます。
第三者の権利は[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)に記載しています。
BGMの動画利用は[BGM-LICENSE.txt](BGM-LICENSE.txt)をご覧ください。

不具合・提案はIssue、改善はPRでお寄せください。1.0.0から公開開発を開始し、
過去の非公開開発のIssue・PR・Git履歴は引き継いでいません。
