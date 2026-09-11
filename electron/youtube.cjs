const { hasClipAudio } = require('../shared/clip-links.mjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { ffmpeg } = require('./media.cjs');
const { validateProject } = require('./export.cjs');
const { number, clipAudioFilter, mixAudioFilter } = require('./audio-render.cjs');
const { writeFilterScript } = require('./filter-script.cjs');
const { timelineKey, cuesFromTranscription, validateYoutube, validChapters } = require('../shared/youtube.mjs');
const { audioEnvelopes, transitionPlan, mediaWindow } = require('../shared/transitions.mjs');
const totalTime = p => Math.max(0, ...p.clips.map(c => c.start + c.duration));
function audioClips(p) {
  const solo = p.tracks.some(t => t.solo);
  return p.clips.filter(c => {
    const a = p.assets.find(a => a.id === c.assetId), t = p.tracks.find(t => t.id === c.trackId);
    return hasClipAudio(c,a) && !c.audioMuted && c.volume > 0 && !t.muted && (!solo || t.solo);
  });
}
function buildTimelineAudio(p, output, audioPaths = {}) {
  validateProject(p); const duration = totalTime(p); const clips = audioClips(p);
  if (!clips.length) throw new Error('文字起こしできる音声がありません。音声トラックのミュート・ソロ・音量を確認してください。');
  if (duration <= 0 || duration > 43200) throw new Error('文字起こしは12時間以内のシーケンスで利用できます。');
  const args = ['-y', '-v', 'error', '-filter_complex_threads', '1', '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo:d=${number(duration)}`];
  const envelopes=audioEnvelopes(p),plans=transitionPlan(p);
  const filters = [], labels = ['[0:a]'];
  clips.forEach((c, i) => {
    const a = p.assets.find(a => a.id === c.assetId); if (a.offline) throw new Error('音声素材がオフラインです。再リンクしてください。');
    if (c.audioTreatment && !audioPaths[c.id]) throw new Error('自動調整した音声を準備できませんでした。');
    const window=mediaWindow(c,a,plans,'audio');
    const sourceTrim=Math.min(1,window.sourceIn);
    args.push('-ss', number(window.sourceIn-sourceTrim), '-t', number(window.sourceDuration+sourceTrim), '-i', c.audioTreatment ? audioPaths[c.id] : a.path);
    filters.push(clipAudioFilter(c, i + 1, envelopes.get(c.id),window,sourceTrim)); labels.push(`[a${i + 1}]`);
  });
  filters.push(mixAudioFilter(labels));
  args.push('-filter_complex', filters.join(';'), '-map', '[afinal]', '-t', number(duration), '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', output);
  return args;
}
async function runAudio(args, signal) {
  signal?.throwIfAborted();
  const directory = args.includes('-filter_complex') ? await fs.mkdtemp(path.join(os.tmpdir(), 'luma-audio-filter-')) : null;
  try {
  const processArgs = directory ? await writeFilterScript(args, directory) : args;
  signal?.throwIfAborted();
  return await new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, processArgs, { windowsHide: true }); let error = '';
    const cancel = () => child.kill(); signal?.addEventListener('abort', cancel, { once: true });
    child.stdout.resume(); child.stderr.on('data', b => { error = (error + b).slice(-2000); });
    child.on('error', e => { signal?.removeEventListener('abort', cancel); reject(e); });
    child.on('close', code => { signal?.removeEventListener('abort', cancel); if (signal?.aborted) reject(new Error('AI処理を中止しました。')); else if (code) reject(new Error(`音声の準備に失敗しました: ${error}`)); else resolve(); });
  });
  } finally { if (directory) await fs.rm(directory, { recursive: true, force: true }); }
}
async function transcribeTimeline(p, vocabulary, client, signal, progress = () => {}, audioPaths = {}) {
  validateProject(p); if (typeof vocabulary !== 'string' || vocabulary.length > 120) throw new Error('用語ヒントは120文字以内にしてください。');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-transcript-'));
  try {
    const audio = path.join(directory, 'timeline.wav'); progress({ progress: 0, message: '編集済みタイムラインの音声を準備中' });
    await runAudio(buildTimelineAudio(p, audio, audioPaths), signal);
    const duration = totalTime(p), cues = [];
    for (let start = 0; start < duration; start += 300) {
      signal?.throwIfAborted(); const end = Math.min(start + 300, duration), from = Math.max(0, start - 1), to = Math.min(duration, end + 1); const file = path.join(directory, 'chunk.wav');
      progress({ progress: start / duration, message: `gpt-transcribeで認識・字幕時刻を照合中 ${Math.floor(start / 300) + 1} / ${Math.ceil(duration / 300)}` });
      await runAudio(['-y', '-v', 'error', '-ss', number(from), '-i', audio, '-t', number(to - from), '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', file], signal);
      const raw = await client.transcribe(file, vocabulary, signal);
      // Overlap provides context, while midpoint ownership avoids duplicate words at the seam.
      const owns = w => { const midpoint = from + (w.start + w.end) / 2; return midpoint >= start && midpoint < end; };
      const owned = { ...raw, words: Array.isArray(raw.words) ? raw.words.filter(owns) : undefined, segments: Array.isArray(raw.segments) ? raw.segments.filter(owns) : [] };
      for (const cue of cuesFromTranscription(owned, from, to - from, p.height > p.width ? 15 : 24)) {
        cue.start = Math.max(cues.at(-1)?.end || 0, cue.start); cue.end = Math.min(duration, cue.end);
        if (cue.end - cue.start >= 1 / p.fps) cues.push(cue);
      }
      if (cues.length > 6000) throw new Error('字幕が6000件を超えました。シーケンスを分けてください。');
    }
    if (!cues.length) throw new Error('認識できる発話がありませんでした。音声・言語設定を確認してください。');
    const result = { sourceKey: timelineKey(p), cues, titles: [], description: '', chapters: [], keywords: [], thumbnailPrompt: '' };
    validateYoutube(result); progress({ progress: 1, message: `${cues.length}件の字幕を作成しました` }); return result;
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
async function generateMetadata(p, client, signal) {
  validateProject(p); const y = p.youtube;
  if (!y?.cues.length) throw new Error('先に文字起こしを実行してください。');
  if (y.sourceKey !== timelineKey(p)) throw new Error('音声の編集後に文字起こしを再実行してください。');
  const input = { project: p.name, duration: totalTime(p), format: p.height > p.width ? 'Shorts・縦型' : 'YouTube・横型', transcript: y.cues };
  if (JSON.stringify(input).length > 160000) throw new Error('投稿文生成の入力が長すぎます。シーケンスを分けてください。');
  const raw = await client.metadata(input, signal);
  if (!Array.isArray(raw.hashtags) || raw.hashtags.length !== 3) throw new Error('投稿文のハッシュタグは3個必要です。再生成してください。');
  const next = { ...y, titles: raw.titles, description: raw.description, chapters: raw.chapters, keywords: raw.keywords, hashtags: raw.hashtags, thumbnailPrompt: raw.thumbnailPrompt };
  validateYoutube(next);
  const requiredText = [...next.titles, next.description, next.thumbnailPrompt, ...next.chapters.map(c => c.label), ...next.keywords];
  if (next.titles.length !== 3 || requiredText.some(text => !text.trim()) || next.keywords.length !== 10 || new Set(next.keywords.map(k => k.trim().toLowerCase())).size !== 10) throw new Error('投稿文の形式が不正でした。再生成してください。');
  if (next.chapters.length && !validChapters(next.chapters, totalTime(p))) throw new Error('チャプターの時刻が条件を満たしませんでした。再生成してください。');
  return next;
}
async function generateThumbnail(p, prompt, client, signal, directory) {
  validateProject(p);
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 6000) throw new Error('画像プロンプトを1〜6000文字で入力してください。');
  const portrait = p.height > p.width;
  const bytes = await client.image(`YouTube用の${portrait ? '縦9:16' : '横16:9'}サムネイル。日本語の見出しは短く大きく、端から余白を取って読みやすくしてください。\n${prompt}`, portrait, signal);
  signal?.throwIfAborted(); await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, `thumbnail-${randomUUID()}.jpg`); await fs.writeFile(file, bytes, { flag: 'wx' }); return file;
}
module.exports = { totalTime, audioClips, buildTimelineAudio, runAudio, transcribeTimeline, generateMetadata, generateThumbnail };
