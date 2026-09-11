# 開発環境

Node.jsは.node-versionの版を使用します。配布対象はWindows x64とMac Apple Siliconです。

```
npm ci
npm run prepare:media
npm run prepare:bgm
npm run dev
```

prepare:mediaは公開済みの固定メディアツールを取得します。tarが必要です。GitHubへのログインは不要です。
ソースからビルドする場合はnpm run build:mediaを使います。MacはXcode Command Line Tools・pkg-configが必要です。WindowsはMSYS2のMINGW64シェルで以下のツールを準備します。diffutilsは依存ライブラリの構成判定で使うdiff・cmp、CMakeとMinGW makeはoneVPLの構築に必要です。

```bash
pacman -S --needed make diffutils mingw-w64-x86_64-make mingw-w64-x86_64-gcc mingw-w64-x86_64-pkgconf mingw-w64-x86_64-nasm mingw-w64-x86_64-cmake
bash scripts/build-media.sh
```

Node.jsを同じシェルから実行できるようにします。Windows CIのMSYS2設定は`path-type: inherit`を使用します。GPU対応版の検証ではこのソースビルドを使ってください。`prepare:media`が取得する`media-tools-v1`はCPU用で、NVENC・Quick Sync・AMFの実機検証には使えません（Issue #3）。

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
