const { transcribeWindows } = require('./transcription-windows.cjs');
const { MAX_MEDIA_SECONDS } = require('../shared/time.mjs');
const { serializeProject } = require('./project.cjs');
const { hasClipAudio } = require('../shared/clip-links.mjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { ffmpeg, run, probe } = require('./media.cjs');
const { thumbnailFormat, thumbnailFrames, thumbnailBrief } = require('../shared/youtube-thumbnail.mjs');
const { thumbnailJpeg } = require('./thumbnail-jpeg.cjs');
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
function buildTimelineAudio(p, output, audioPaths = {}, range) {
  validateProject(p); const duration = totalTime(p); const clips = audioClips(p);
  if (!clips.length) throw new Error('文字起こしできる音声がありません。音声トラックのミュート・ソロ・音量を確認してください。');
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_MEDIA_SECONDS) throw new Error('文字起こしの音声の長さが不正です。');
  const from = range?.from ?? 0, to = range?.to ?? duration;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from || to > duration) throw new Error('文字起こしの音声区間が不正です。');
  const span = to - from;
  const args = ['-y', '-v', 'error', '-filter_complex_threads', '1', '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo:d=${number(span)}`];
  const envelopes=audioEnvelopes(p),plans=transitionPlan(p);
  const filters = [], labels = ['[0:a]'];
  clips.forEach((c, i) => {
    const a = p.assets.find(a => a.id === c.assetId);
    const whole=mediaWindow(c,a,plans,'audio');
    const start=Math.max(from,whole.start), end=Math.min(to,whole.start+whole.duration);
    if(end<=start)return;
    if (a.offline) throw new Error('音声素材がオフラインです。再リンクしてください。');
    if (c.audioTreatment && !audioPaths[c.id]) throw new Error('自動調整した音声を準備できませんでした。');
    const window={...whole,start:start-from,duration:end-start,sourceIn:whole.sourceIn+(start-whole.start)*c.speed,sourceDuration:(end-start)*c.speed};
    const sourceTrim=Math.min(1,window.sourceIn);
    args.push('-ss', number(window.sourceIn-sourceTrim), '-t', number(window.sourceDuration+sourceTrim), '-i', c.audioTreatment ? audioPaths[c.id] : a.path);
    const index=labels.length;
    filters.push(clipAudioFilter({...c,start:c.start-from}, index, (envelopes.get(c.id)||[]).map(e=>({...e,start:e.start-from,end:e.end-from})),window,sourceTrim)); labels.push(`[a${index}]`);
  });
  filters.push(mixAudioFilter(labels));
  args.push('-filter_complex', filters.join(';'), '-map', '[afinal]', '-t', number(span), '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-rf64', 'auto', output);
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
function finalizeTranscription(p, cues, transcriptionStats) {
  if (!cues.length) throw new Error('認識できる発話がありませんでした。音声・言語設定を確認してください。');
  const result = { sourceKey: timelineKey(p), cues, transcriptionStats, titles: [], description: '', chapters: [], keywords: [], thumbnailPrompt: '' };
  validateYoutube(result);
  // Use the exact persisted representation, including all other project data,
  // before returning a result that the renderer can commit over existing captions.
  serializeProject({ ...p, youtube: result });
  return result;
}
async function transcribeTimeline(p, vocabulary, client, signal, progress = () => {}, audioPaths = {}) {
  validateProject(p); if (typeof vocabulary !== 'string' || vocabulary.length > 120) throw new Error('用語ヒントは120文字以内にしてください。');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-transcript-'));
  try {
    progress({ progress: 0, message: '短い区間ごとに音声を準備します' });
    const duration = totalTime(p);
    const { cues, transcriptionStats } = await transcribeWindows(duration, async ({ from, to, allowTimingFallback }) => {
      const file = path.join(directory, 'chunk.wav');
      await runAudio(buildTimelineAudio(p, file, audioPaths, { from, to }), signal);
      return client.transcribe(file, vocabulary, signal, { allowTimingFallback });
    }, signal, progress, p.height > p.width ? 15 : 24, p.fps);
    const result = finalizeTranscription(p, cues, transcriptionStats);
    progress({ progress: 1, message: `${cues.length}件の字幕を作成しました` }); return result;
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
  if (typeof prompt !== 'string' || prompt.length > 6000) throw new Error('画像プロンプトは6000文字以内で入力してください。');
  if(!prompt.trim()&&!p.clips.length)throw new Error('動画を配置するか、サムネイルで伝えたい内容を入力してください。');
  const format=thumbnailFormat(p),references=[];
  for(const {asset,sourceTime}of thumbnailFrames(p)){
    signal?.throwIfAborted();
    const args=['-v','error',...(asset.kind==='video'?['-ss',number(sourceTime)]:[]),'-i',asset.path,'-frames:v','1','-vf','scale=1024:1024:force_original_aspect_ratio=decrease','-q:v','3','-f','image2pipe','-c:v','mjpeg','pipe:1'];
    const image=await run(ffmpeg,args,{signal});
    if(!image.length)throw new Error('動画から参考画像を取得できませんでした。素材を確認してください。');
    references.push(image);
  }
  const bytes = await client.image(thumbnailBrief(p,prompt), format.portrait, signal,references);
  signal?.throwIfAborted(); await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, `thumbnail-${randomUUID()}.jpg`),temporary=file+'.tmp.jpg';
  try{
    await fs.writeFile(temporary,bytes,{flag:'wx'});
    const info=await probe(temporary),image=info.streams.find(s=>s.codec_type==='video');
    if(image?.width!==format.width||image?.height!==format.height)throw new Error(`生成画像が${format.ratio}の指定サイズではありません。再生成してください。`);
    await fs.writeFile(temporary,await thumbnailJpeg(temporary,signal));
    signal?.throwIfAborted();await fs.rename(temporary,file);return file;
  }finally{await fs.rm(temporary,{force:true});}
}
module.exports = { finalizeTranscription, totalTime, audioClips, buildTimelineAudio, runAudio, transcribeTimeline, generateMetadata, generateThumbnail };
