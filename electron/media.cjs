const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { ensureWaveform, overview } = require('./waveform.cjs');
const { ffmpeg, ffprobe } = require('./media-binaries.cjs');

function run(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    options.signal?.throwIfAborted();
    const child = spawn(binary, args, { windowsHide: true, ...options });
    let failure;
    const chunks = []; let size = 0; let stderr = '';
    child.stdout?.on('data', b => { size += b.length; if (size > 64 * 1024 * 1024) child.kill(); else chunks.push(b); });
    child.stderr?.on('data', b => { stderr = (stderr + b).slice(-12000); });
    child.on('error', error => { failure = error; });
    child.on('close', code => failure || options.signal?.aborted ? reject(failure || options.signal.reason) : code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(stderr || `Media process exited: ${code}`)));
  });
}
async function probe(file, options = {}) {
  return JSON.parse((await run(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], options)).toString());
}
function mediaRevision(file, stat) {
  return createHash('sha256').update(path.resolve(file) + stat.size + stat.mtimeMs).digest('hex').slice(0, 24);
}
async function assertMediaRevision(asset) {
  const stat = await fs.stat(asset.path).catch(() => null);
  if (!stat?.isFile() || mediaRevision(asset.path, stat) !== (asset.revision || asset.id)) throw new Error('素材が変更または削除されています。素材を再リンクしてください。');
}
async function inspectMedia(file, cacheDir, { signal, onStage = () => {}, previewProxy = false, skipCache = false } = {}) {
  signal?.throwIfAborted(); onStage('素材を解析しています');
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error('ファイルを選択してください。');
  const id = mediaRevision(file, stat);
  const info = await probe(file, { signal });
  const video = info.streams.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const sound = info.streams.find(s => s.codec_type === 'audio');
  const kind = /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i.test(file) ? 'image' : video ? 'video' : sound ? 'audio' : null;
  if (!kind) throw new Error('この素材には読み込める映像・音声がありません。');
  if (!skipCache) await fs.mkdir(cacheDir, { recursive: true });
  const duration = kind === 'image' ? 5 : Number(info.format.duration || video?.duration || sound?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('素材の長さを取得できません。');
  let playbackPath = file;
  const compatible = (kind === 'audio' && /\.(mp3|wav|m4a|ogg|aac|flac)$/i.test(file)) || (kind === 'video' && ['h264', 'vp8', 'vp9', 'av1'].includes(video.codec_name) && /\.(mp4|m4v|webm|mov)$/i.test(file) && (!sound || ['aac', 'mp3', 'opus', 'vorbis'].includes(sound.codec_name)));
  if (skipCache && !compatible) throw Error('原本の再生に互換プロキシが必要です。');
  const useProxy = !compatible || (kind === 'video' && previewProxy);
  if (useProxy) {
    playbackPath = path.join(cacheDir, `${id}-proxy${kind === 'video' ? '-v2' : ''}.${kind === 'image' ? 'png' : kind === 'audio' ? 'm4a' : 'mp4'}`);
    try { await fs.access(playbackPath); } catch {
      onStage('再生用の軽量ファイルを作成しています');
      const temp = playbackPath.replace(/(\.[^.]+)$/, '.tmp$1');
      const args = ['-y', '-i', file];
      if (kind === 'video') args.push('-vf', "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p');
      if (kind === 'image') args.push('-frames:v', '1', temp);
      else args.push('-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', temp);
      try { await run(ffmpeg, args, { signal }); signal?.throwIfAborted(); await fs.rename(temp, playbackPath); } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
    }
  }
  let thumbnailPath; let waveform = [];
  if (kind !== 'audio' && !skipCache) {
    thumbnailPath = path.join(cacheDir, `${id}.jpg`);
    try { if (!(await fs.stat(thumbnailPath)).size) throw new Error('Empty thumbnail'); } catch {
      onStage('サムネイルを作成しています');
      // Seeking even to zero can discard a single JPEG frame in FFmpeg.
      const seek = kind === 'image' ? [] : ['-ss', String(Math.min(1, duration / 3))];
      const temporary = thumbnailPath + '.tmp.jpg';
      try {
        await run(ffmpeg, ['-y', ...seek, '-i', playbackPath, '-frames:v', '1', '-vf', 'scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2', temporary], { signal });
        signal?.throwIfAborted(); await fs.rename(temporary, thumbnailPath);
      } finally { await fs.rm(temporary, { force: true }); }
      if (!(await fs.stat(thumbnailPath)).size) throw new Error('素材の縮小画像を作成できませんでした。');
    }
  }
  if (kind !== 'audio' && skipCache) {
    // A failed proxy encoder must not hide a readable thumbnail. Do not write
    // or regenerate cache entries when falling back to the original source.
    const cachedThumbnail = path.join(cacheDir, `${id}.jpg`);
    const cachedStat = await fs.stat(cachedThumbnail).catch(() => null);
    if (cachedStat?.isFile() && cachedStat.size > 0) thumbnailPath = cachedThumbnail;
  }
  if (sound && !skipCache) {
    onStage('音声波形を作成しています');
    const meta = await ensureWaveform(file, cacheDir, id, duration, sound.channels, signal);
    waveform = await overview(cacheDir, id, meta, duration);
  }
  signal?.throwIfAborted();
  const fpsParts = String(video?.avg_frame_rate || '0/1').split('/').map(Number);
  return { id, name: path.basename(file), path: file, playbackPath, thumbnailPath, kind, duration, width: video?.width || 0, height: video?.height || 0, fps: fpsParts[1] ? fpsParts[0] / fpsParts[1] : 0, hasAudio: !!sound, waveform, size: stat.size, codec: video?.codec_name || sound?.codec_name, proxy: useProxy, ...(kind === 'video' && previewProxy ? { previewProxy: true } : {}) };
}
module.exports = { ffmpeg, ffprobe, run, probe, inspectMedia, assertMediaRevision };
