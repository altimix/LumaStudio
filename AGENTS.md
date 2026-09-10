# Luma Studio development

Windows / macOS用のElectron / React / TypeScript / FFmpeg動画編集アプリです。利用者向けのUIと説明は日本語にします。

## Workflow

- 機能・修正はGitHub Issueの目的と受け入れ条件を起点にする。共通仕様は `docs/specs/` に置き、実装と同じPRで更新する。
- `codex/<issue>-<topic>` ブランチで、小さく独立して検証できる変更を作る。初期実装の取り込みを除き、無関係な機能をまとめない。
- `npm ci`、`npm run verify:demo`、`npm test`、`npm run build` が基本の検証。保存・再生・編集・出力の変更はWindowsで `npm run package` と `npm run verify:packaged` も実行する。
- PR本文にIssue、最終的な動作、検証結果、未確認事項を記載する。`@codex review` を依頼し、指摘への対応を記録する。応答がない場合は合格と判断しない。
- マージするコミットの必須CI、受け入れ条件、レビューを確認してからスカッシュマージする。修正後は影響する検証を再実行する。
- 実行ファイル、キャッシュ、ユーザーのプロジェクトや素材をGitへ追加しない。小さい権利確認済みのテスト素材は例外。配布用EXEはReleases、検証結果はActions artifactsへ置く。

## Code Review Rules

### Editing and persistence

- 元素材を変更しない。保存・書き出しは一時ファイルの完成後に置換し、中止や失敗で既存ファイルを破損させない。
- 時間はシーケンス秒、素材のin点は素材秒として扱う。速度変更・分割・トリミングでプレビューと書き出しの参照区間を一致させる。区間の終了は含めない。
- 保存形式や編集処理の変更では、既存プロジェクトの読込、Undo / Redo、ロックしたトラックの保護を維持する。不正な形式は具体的なエラーで拒否する。

### Desktop boundary

- RendererのNode.jsアクセスを無効に保ち、必要な操作だけをpreloadで公開する。メイン側でも値とファイル操作を検証し、未登録のパスをmediaプロトコルで公開しない。
- シェル文字列の組み立てでFFmpegを実行しない。引数配列を使い、日本語・空白・記号を含むパスを扱えるようにする。

## Architecture

- `src/model.ts` / `src/store.ts`: 編集と履歴
- `src/components/Preview.tsx` / `src/render.ts`: プレビューとテロップ画像
- `src/audio.ts` / `src/audio-plan.ts` / `src/audio-mix.ts` / `electron/audio.cjs`: 正逆の音声時計、区間予約、ミックス、PCMデコード
- `electron/export.cjs`: プロジェクト検証とFFmpeg出力
- `electron/media.cjs`: メタデータ、波形、プロキシ
- `electron/main.cjs` / `electron/preload.cjs`: Windowsとの接続と保存
- `src/components/YouTubeStudio.tsx` / `src/youtube.ts` / `shared/youtube.mjs`: 字幕と投稿素材
- `electron/openai.cjs` / `electron/youtube.cjs` / `electron/audio-render.cjs`: API設定、AIジョブ、MP4と共通の音声処理
