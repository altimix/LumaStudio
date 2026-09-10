const { ffmpeg, run } = require('./media.cjs');
const { validateTreatment } = require('../shared/audio-treatment.mjs');

const SAMPLE_RATE = 48000;
const CHUNK_SECONDS = 8;
const CHANNELS = 2;

// Decode a bounded window of the original audio, independent of the video proxy.
async function decodeAudioChunk(file, index, signal) {
  // Compressed audio needs decoder pre-roll; discard it rather than playing the
  // decoder's startup transient at every 8-second boundary (and in reverse).
  const seek = Math.max(0, index * CHUNK_SECONDS - 1); const trim = index * CHUNK_SECONDS - seek;
  const data = await run(ffmpeg, ['-v', 'error', '-ss', String(seek), '-i', file,
    '-map', '0:a:0', '-vn', '-af', `aresample=${SAMPLE_RATE}:async=1:first_pts=0,apad,atrim=start=${trim}:duration=${CHUNK_SECONDS},asetpts=PTS-STARTPTS`,
    '-t', String(CHUNK_SECONDS), '-ac', String(CHANNELS), '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1'], { signal });
  if (data.length !== SAMPLE_RATE * CHUNK_SECONDS * CHANNELS * 4) throw new Error('音声データの長さが不正です。');
  return new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
}

function createAudioReader(decode = decodeAudioChunk) {
  const assets = new Map(); const pending = new Map(); const queue = [];
  const controllers = new Set(); let active = 0; let closed = false;
  function pump() {
    while (!closed && active < 2 && queue.length) {
      const job = queue.shift(); const controller = new AbortController(); controllers.add(controller); active++;
      const timeout = job.treatment ? undefined : setTimeout(() => controller.abort(), 30000);
      Promise.resolve().then(() => decode(job.file, job.index, controller.signal, job.treatment)).then(job.resolve, job.reject).finally(() => {
        clearTimeout(timeout); controllers.delete(controller); active--; pending.delete(job.key); pump();
      });
    }
  }
  return {
    register(url, asset) { assets.set(url, { file: asset.path, duration: asset.duration, hasAudio: asset.hasAudio }); },
    read(url, index, treatment) {
      try { validateTreatment(treatment); } catch (error) { return Promise.reject(error); }
      const asset = typeof url === 'string' && assets.get(url);
      if (closed || !asset || !asset.hasAudio || !Number.isSafeInteger(index) || index < 0 || index * CHUNK_SECONDS >= asset.duration) {
        return Promise.reject(new Error('音声の読み込み範囲または素材が不正です。'));
      }
      const key = `${url}:${index}:${treatment || 'original'}`;
      if (pending.has(key)) return pending.get(key);
      if (pending.size >= 32) return Promise.reject(new Error('音声の読み込みが混雑しています。停止してから再生してください。'));
      const result = new Promise((resolve, reject) => { queue.push({ key, file: asset.file, index, treatment, resolve, reject }); });
      pending.set(key, result); pump(); return result;
    },
    close() {
      closed = true; for (const controller of controllers) controller.abort();
      for (const job of queue.splice(0)) job.reject(new Error('音声の読み込みを終了しました。'));
      assets.clear(); pending.clear();
    },
  };
}
module.exports = { SAMPLE_RATE, CHUNK_SECONDS, CHANNELS, decodeAudioChunk, createAudioReader };
