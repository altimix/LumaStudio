const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { MAX_MEDIA_SECONDS } = require('../shared/time.mjs');
const { hasClipAudio } = require('../shared/clip-links.mjs');
const { audioEnvelopes, transitionPlan, mediaWindow } = require('../shared/transitions.mjs');
const { number, clipAudioFilter, mixAudioFilter } = require('./audio-render.cjs');
const { writeFilterScript } = require('./filter-script.cjs');
const { ffmpeg } = require('./media.cjs');
const { mediaSpawnError } = require('./media-binaries.cjs');
const { validateProject } = require('./export.cjs');

const totalTime = p => Math.max(0, ...p.clips.map(c => c.start + c.duration));
function audioClips(p) {
  const solo = p.tracks.some(t => t.solo);
  return p.clips.filter(c => {
    const a = p.assets.find(a => a.id === c.assetId), t = p.tracks.find(t => t.id === c.trackId);
    return hasClipAudio(c, a) && !c.audioMuted && c.volume > 0 && !t.muted && (!solo || t.solo);
  });
}

function buildAudioGraph(p, output, audioPaths, range, mp3) {
  validateProject(p);
  const duration = totalTime(p), clips = audioClips(p);
  if (!clips.length) throw new Error(mp3
    ? '書き出せる音声がありません。音声トラックのミュート・ソロ・音量を確認してください。'
    : '文字起こしできる音声がありません。音声トラックのミュート・ソロ・音量を確認してください。');
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_MEDIA_SECONDS) throw new Error(mp3
    ? '書き出す音声の長さが不正です。' : '文字起こしの音声の長さが不正です。');
  const from = range?.from ?? 0, to = range?.to ?? duration;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from || to > duration) throw new Error('文字起こしの音声区間が不正です。');
  const span = to - from;
  const args = ['-y', '-v', 'error', '-filter_complex_threads', '1', '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo:d=${number(span)}`];
  const envelopes = audioEnvelopes(p), plans = transitionPlan(p);
  const filters = [], labels = ['[0:a]'];
  clips.forEach(c => {
    const a = p.assets.find(asset => asset.id === c.assetId);
    const whole = mediaWindow(c, a, plans, 'audio');
    const start = Math.max(from, whole.start), end = Math.min(to, whole.start + whole.duration);
    if (end <= start) return;
    if (a.offline) throw new Error('音声素材がオフラインです。再リンクしてください。');
    if (c.audioTreatment && !audioPaths[c.id]) throw new Error('自動調整した音声を準備できませんでした。');
    const window = { ...whole, start: start - from, duration: end - start, sourceIn: whole.sourceIn + (start - whole.start) * c.speed, sourceDuration: (end - start) * c.speed };
    const sourceTrim = Math.min(1, window.sourceIn);
    args.push('-ss', number(window.sourceIn - sourceTrim), '-t', number(window.sourceDuration + sourceTrim), '-i', c.audioTreatment ? audioPaths[c.id] : a.path);
    const index = labels.length;
    filters.push(clipAudioFilter({ ...c, start: c.start - from }, index, (envelopes.get(c.id) || []).map(e => ({ ...e, start: e.start - from, end: e.end - from })), window, sourceTrim));
    labels.push(`[a${index}]`);
  });
  filters.push(mixAudioFilter(labels));
  args.push('-filter_complex', filters.join(';'), '-map', '[afinal]', '-t', number(span), '-vn');
  if (mp3) args.push('-ac', '2', '-ar', '48000', '-c:a', 'libmp3lame', '-b:a', '192k', '-id3v2_version', '3', '-progress', 'pipe:1', '-nostats');
  else args.push('-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-rf64', 'auto');
  args.push(output);
  return args;
}
function buildTimelineAudio(p, output, audioPaths = {}, range) {
  return buildAudioGraph(p, output, audioPaths, range, false);
}
function buildMp3Audio(p, output, audioPaths = {}) {
  return buildAudioGraph(p, output, audioPaths, undefined, true);
}

async function runAudio(args, signal, { onProgress, duration, cancelMessage = 'AI処理を中止しました。', failureMessage = '音声の準備に失敗しました' } = {}) {
  signal?.throwIfAborted();
  const directory = args.includes('-filter_complex') ? await fs.mkdtemp(path.join(os.tmpdir(), 'luma-audio-filter-')) : null;
  try {
    const processArgs = directory ? await writeFilterScript(args, directory) : args;
    signal?.throwIfAborted();
    return await new Promise((resolve, reject) => {
      const child = spawn(ffmpeg, processArgs, { windowsHide: true }); let error = '', pending = '';
      const cancel = () => child.kill(); signal?.addEventListener('abort', cancel, { once: true });
      if (onProgress) child.stdout.on('data', bytes => {
        pending += bytes.toString();
        const lines = pending.split('\n'); pending = lines.pop();
        for (const line of lines) if (line.startsWith('out_time_us=')) {
          const seconds = Number(line.slice(12)) / 1e6;
          if (Number.isFinite(seconds) && duration > 0) onProgress(Math.min(.99, seconds / duration));
        }
      });
      else child.stdout.resume();
      child.stderr.on('data', bytes => { error = (error + bytes).slice(-2000); });
      child.on('error', cause => { signal?.removeEventListener('abort', cancel); reject(mediaSpawnError(ffmpeg, cause)); });
      child.on('close', code => {
        signal?.removeEventListener('abort', cancel);
        if (signal?.aborted) reject(new Error(cancelMessage));
        else if (code) reject(new Error(`${failureMessage}: ${error}`)); else resolve();
      });
    });
  } finally { if (directory) await fs.rm(directory, { recursive: true, force: true }); }
}

module.exports = { totalTime, audioClips, buildTimelineAudio, buildMp3Audio, runAudio };
