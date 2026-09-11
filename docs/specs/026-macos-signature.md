# Mac配布ZIPの署名整合性

Issue: #26。1.3.0のMac版は署名を無効にしていたため、Electronのリンカ署名だけが残り、バンドルの署名検証に失敗した。

electron-builder 26の `mac.identity: "-"` で内側の実行コードからアプリ全体までad-hoc署名する。証明書の自動探索には依存しない。Developer IDのない配布ではライブラリ検証との衝突を避けるため `hardenedRuntime: false` を明示する。これはMac全体のセキュリティ設定を変えない。Developer ID署名・Apple公証を取得したことを意味しない。

PRのMac CIでも `CSC_FOR_PULL_REQUEST=true` でad-hoc署名を実行する。証明書の自動探索を無効にし、署名・公証の秘密鍵や認証情報は渡さない。パッケージ作成は常に `--publish never` とし、PRから公開する設定は有効にしない。公開は検証・レビュー後の別工程で行う。

`npm run package` はZIP作成後、一時フォルダへ解凍し、すべてのMach-O（FFmpeg / FFprobeを含む）とバンドル全体の `codesign --verify --deep --strict` を確認する。リソース署名の存在と、解凍したテスト用コピーのapp.asarを改変した際に拒否されることも確認する。失敗時は配布工程を失敗させる。ユーザーのアプリや素材、隔離属性は変更しない。

受け入れ条件: 基本テスト、Mac ZIP署名検証、署名済み配布アプリの起動・編集・出力テスト、Windows CIの回帰確認。隔離属性付きでの「このまま開く」による起動は、署名の整合性検証と別に結果を記録し、未確認なら保証しない。署名検証成功を公証済み・Gatekeeper自動許可と表現しない。
