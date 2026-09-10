#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$ROOT_DIR/.local/media-build"
PREFIX_DIR="$BUILD_DIR/prefix"
SOURCE_DIR="$ROOT_DIR/.local/media-sources"
JOBS="${LUMA_BUILD_JOBS:-4}"
mkdir -p "$BUILD_DIR" "$PREFIX_DIR" "$SOURCE_DIR"
node "$ROOT_DIR/scripts/fetch-media-sources.cjs"
export PKG_CONFIG_PATH="$PREFIX_DIR/lib/pkgconfig"
export CFLAGS="-O2"
export LDFLAGS="-L$PREFIX_DIR/lib"
export CPPFLAGS="-I$PREFIX_DIR/include"
case "$(uname -s)" in
  Darwin) PLATFORM=darwin-arm64; EXTRA_FLAGS=(--enable-videotoolbox); export MACOSX_DEPLOYMENT_TARGET=13.0 ;;
  MINGW*|MSYS*) PLATFORM=win32-x64; EXTRA_FLAGS=(--extra-ldflags=-static) ;;
  *) echo 'Supported builders: Apple Silicon macOS or MSYS2 MINGW64'; exit 1 ;;
esac
cd "$BUILD_DIR"
if [ ! -f "$PREFIX_DIR/lib/libz.a" ]; then
  tar -xf "$SOURCE_DIR/zlib-1.3.1.tar.gz"
  cd zlib-1.3.1
  if [ "$PLATFORM" = win32-x64 ]; then
    make -f win32/Makefile.gcc -j"$JOBS" libz.a
    mkdir -p "$PREFIX_DIR/lib" "$PREFIX_DIR/include"
    cp libz.a "$PREFIX_DIR/lib/"; cp zlib.h zconf.h "$PREFIX_DIR/include/"
  else
    ./configure --prefix="$PREFIX_DIR" --static
    make -j"$JOBS"; make install
  fi
  cd "$BUILD_DIR"
fi
if [ ! -f "$PREFIX_DIR/lib/libmp3lame.a" ]; then
  tar -xf "$SOURCE_DIR/lame-3.100.tar.gz"
  cd lame-3.100
  ./configure --prefix="$PREFIX_DIR" --disable-shared --enable-static --disable-frontend --disable-decoder
  make -j"$JOBS"; make install
  cd "$BUILD_DIR"
fi
if [ ! -f "$PREFIX_DIR/lib/libx264.a" ]; then
  mkdir -p x264; tar -xf "$SOURCE_DIR/x264.tar.gz" -C x264 --strip-components=1
  cd x264
  ./configure --prefix="$PREFIX_DIR" --enable-static --disable-cli --disable-opencl
  make -j"$JOBS"; make install
  cd "$BUILD_DIR"
fi
tar -xf "$SOURCE_DIR/ffmpeg-6.1.1.tar.xz"
cd ffmpeg-6.1.1
./configure --prefix="$PREFIX_DIR" --disable-autodetect --disable-shared --enable-static --disable-doc --disable-debug --disable-ffplay --enable-gpl --enable-libx264 --enable-libmp3lame --enable-zlib --pkg-config-flags=--static --extra-cflags="-I$PREFIX_DIR/include" --extra-ldflags="-L$PREFIX_DIR/lib" "${EXTRA_FLAGS[@]}"
make -j"$JOBS"
DEST_DIR="$ROOT_DIR/vendor/media/$PLATFORM"
mkdir -p "$DEST_DIR"
EXT=''; [ "$PLATFORM" != win32-x64 ] || EXT='.exe'
cp "ffmpeg$EXT" "ffprobe$EXT" "$DEST_DIR/"
cp COPYING.GPLv2 COPYING.GPLv3 COPYING.LGPLv2.1 "$DEST_DIR/"
cp "$BUILD_DIR/x264/COPYING" "$DEST_DIR/x264-COPYING"
cp "$BUILD_DIR/lame-3.100/COPYING" "$DEST_DIR/lame-COPYING"
cp "$BUILD_DIR/zlib-1.3.1/LICENSE" "$DEST_DIR/zlib-LICENSE"
"$DEST_DIR/ffmpeg$EXT" -version > "$DEST_DIR/BUILD.txt"
"$DEST_DIR/ffmpeg$EXT" -L >> "$DEST_DIR/BUILD.txt" 2>&1
node "$ROOT_DIR/scripts/check-media.cjs"

mkdir -p "$ROOT_DIR/release/media-sources"
cp "$SOURCE_DIR/ffmpeg-6.1.1.tar.xz" "$SOURCE_DIR/x264.tar.gz" "$SOURCE_DIR/lame-3.100.tar.gz" "$SOURCE_DIR/zlib-1.3.1.tar.gz" "$ROOT_DIR/release/media-sources/"
