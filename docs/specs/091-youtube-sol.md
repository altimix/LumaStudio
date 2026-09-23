# YouTube投稿文のモデル選択

Issue: #91

「YouTube → タイトル・概要欄」で、投稿文を生成するモデルを `gpt-6-astra` または `gpt-6-sol` から選ぶ。初期値は従来と同じ `gpt-6-astra`。選択はアプリ内のローカル設定として保持し、プロジェクトファイルとUndo履歴には含めない。API設定画面には現在の選択を表示する。

Rendererは選択したモデルを投稿文生成のIPCへ渡す。メインプロセスとAPIクライアントで許可リストを検証し、他のモデル名を拒否する。Responses APIの構造化JSON、`reasoning.effort: low`、`store: false`、出力上限を維持する。403/404などの利用権限エラーで自動的に別モデルへ切り替えない。

文字起こし本文の `gpt-transcribe`、字幕時刻の `whisper-1`、画像生成の `gpt-image-2.5-sunburst` はそのままにする。投稿文の保存形式は変更しない。

公式仕様: https://developers.openai.com/api/docs/models/gpt-6-sol （2026-09-23確認。Responses API、構造化出力、`low` 推論に対応）

テストではAstraの初期動作、Sol指定のAPI要求、許可外モデルの拒否、アプリ画面での選択保持、文字起こし要求のモデルを確認する。実APIキーはテストへ含めない。
