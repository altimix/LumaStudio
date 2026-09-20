const fs = require('node:fs/promises');
const { probe, ffmpeg, run } = require('./media.cjs');
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;

async function validateThumbnailReference(file, signal) {
  signal?.throwIfAborted();
  if (typeof file !== 'string' || !/\.(png|jpe?g|webp)$/i.test(file)) throw new Error('参考画像はPNG・JPEG・WebPから選んでください。');
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_REFERENCE_BYTES) throw new Error('参考画像は20MB以下の画像ファイルを選んでください。');
  const info = await probe(file, { signal }), image = info.streams.find(stream => stream.codec_type === 'video');
  if (!image || !['png', 'mjpeg', 'webp'].includes(image.codec_name) || info.streams.some(stream => stream.codec_type === 'audio')) throw new Error('参考画像を読み取れません。PNG・JPEG・WebPの画像を選んでください。');
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width > 32768 || image.height > 32768 || image.width * image.height > 40_000_000) throw new Error('参考画像は4000万画素以下、各辺32768px以下にしてください。');
}

async function thumbnailReferenceJpeg(file, signal) {
  await validateThumbnailReference(file, signal);
  const bytes = await run(ffmpeg, ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', "scale=w='min(1536,iw)':h='min(1536,ih)':force_original_aspect_ratio=decrease", '-map_metadata', '-1', '-q:v', '2', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'], { signal });
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) throw new Error('参考画像を送信できる大きさに変換できませんでした。小さい画像でお試しください。');
  return bytes;
}

module.exports = { MAX_REFERENCE_BYTES, validateThumbnailReference, thumbnailReferenceJpeg };
