> 公開版1.0.0のメディアツール構成は[公開初版仕様](100-public-release.md)が優先します。以下の旧依存パッケージの記述は導入時の技術的背景です。

# Mac版

Issue: #99。Apple SiliconのこのMacでの動作を優先する。

## 目的と互換性

既存の編集・音声・日本語テロップ・MP4出力をmacOSでも利用する。保存形式はversion 1を維持し、元素材と既存の保存先を保護する。Windowsとの受け渡しでは絶対パスが異なるため、素材をコピーした後に再リンクする。Mac上のローカル絶対パスを使用し、ネットワークURLを素材として許可しない。

## 操作

- Mac標準のタイトルバーを使用し、閉じる・しまう・拡大ボタンをアプリ内メニューと重ねない。
- アプリメニューとウィンドウメニューを日本語で提供する。
- Ctrl系の編集ショートカットはCommandでも操作できる。アプリ内の既存Ctrl表記はCommandと読み替える。通常のDeleteはMacのdelete（Backspace）、リップル削除はShift+deleteでも操作する。
- 入力欄のコピー・貼り付けとIME変換中の編集保護を維持する。
- 最後のウィンドウを閉じたらアプリを終了する。Command+Qも既存の保存確認を通す。終了を取り消したとき、音声処理を終了させない。
- CPUのH.264/AAC出力を基本とする。VideoToolboxの追加は別Issueとする。

## ビルドと受け入れ条件

- ビルドするMac自身のアーキテクチャ向けにZIP内の.appを作る。Windows x64のportable EXE作成は維持する。
- npm依存のFFmpegとFFprobeを同梱する。1.0.0以降は[クリーン配布仕様](101-clean-distribution.md)に従い、初期素材を同梱せず、`npm run prepare:opening` も不要とする。
- `npm ci`、`npm run verify:demo`、`npm test`、`npm run build`、`npm run package`、`npm run verify:packaged` をMac上で実行する。
- パッケージの実ウィンドウで起動、保存・再読込、再生、MP4出力、復元・再リンク、終了確認を検証する。追加のMac検証ではCommand操作と入力欄の貼り付けを確認する。
- Intel向けのビルド設定は用意するが、Intel Macでの実行結果がない限り検証済みとはしない。Windowsの回帰検証もWindows CI結果を必要とする。

## 配布範囲

開発用の未署名ZIP。Apple Developer署名、公証、一般公開、自動更新は対象外。Gatekeeperを無効化する手順は提供しない。一般利用者への配布前に署名・公証を行う。

## 同梱ツールの注意点

`ffprobe-static` 3.1.0の `darwin/arm64/ffprobe` は検査するとx86_64だったため、Apple Silicon版に限り `@ffprobe-installer/darwin-arm64` 5.0.1を固定して使用する。パッケージ前にFFmpegとFFprobeのMach-Oヘッダーを検査し、ビルド対象と異なるCPUなら失敗させる。パッケージ後も実際のメディア処理を検証する。

Mac CIは `macos-15` のarm64ランナーを使用する（[GitHubのランナー仕様](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)）。ローカルの実行結果とCI・レビュー結果を区別して記録する。
