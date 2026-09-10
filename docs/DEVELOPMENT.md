# 開発環境

Node.jsは.node-versionの版を使用します。配布対象はWindows x64とMac Apple Siliconです。

```
npm ci
npm run prepare:media
npm run prepare:bgm
npm run dev
```

prepare:mediaは公開済みの固定メディアツールを取得します。tarが必要です。GitHubへのログインは不要です。
ソースからビルドする場合はnpm run build:mediaを使います。MacはXcode Command Line Tools・pkg-config、WindowsはMSYS2 MINGW64とmake・gcc・pkgconf・nasmが必要です。.github/workflows/のCIにも同じ手順があります。

FFmpeg、x264、LAME、zlibのソースはshared/media-sources.jsonのSHA256で検証します。
FFmpegのnonfree構成は配布しません。利用する音源の権利はBGM-LICENSE.txtを参照してください。

```
npm run verify:demo
npm run verify:readme
npm test
npm run package
npm run verify:packaged
```

配布版は空で起動します。編集テストだけがLUMA_DEMO_FIXTURE=1とLUMA_TEST_FIXTURESで外部テスト素材を読みます。通常の利用者データは変更しません。

FFmpeg等のバージョン変更は保存・再生・書き出しへの影響を検証してください。バイナリと対応ソース、ビルド手順を一緒に公開します。
