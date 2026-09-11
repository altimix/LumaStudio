const { cuesFromTranscription, MAX_SUBTITLE_CUES } = require('../shared/youtube.mjs');
const { MAX_MEDIA_SECONDS } = require('../shared/time.mjs');
const WINDOW_SECONDS = 60, MIN_WINDOW_SECONDS = 8, CONTEXT_SECONDS = 1;
const timeLabel = seconds => [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, Math.floor(seconds) % 60].map(v => String(v).padStart(2, '0')).join(':');
// Sequential bounded windows: recognition memory does not grow with recording length.
async function transcribeWindows(duration, transcribe, signal, progress = () => {}, width = 24, fps = 30, ranges) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_MEDIA_SECONDS) throw new Error('文字起こしの音声の長さが不正です。');
  const cues = []; let retries = 0, timingFallbacks = 0;
  async function window(start, end) {
    signal?.throwIfAborted();
    const from = Math.max(0, start - CONTEXT_SECONDS), to = Math.min(duration, end + CONTEXT_SECONDS);
    progress({ progress: start / duration, message: `文字起こし・時刻照合 ${timeLabel(start)} / ${timeLabel(duration)}${end - start < WINDOW_SECONDS ? '（短い区間で確認）' : ''}` });
    let raw;
    try {
      raw = await transcribe({ start, end, from, to, allowTimingFallback: end - start <= MIN_WINDOW_SECONDS });
      const units = raw?.words?.length ? raw.words : raw?.segments || [];
      if (!Array.isArray(units) || units.some(w => !Number.isFinite(w?.start) || !Number.isFinite(w?.end) || w.start < 0 || w.end < w.start || w.end > to - from + .05)) throw Object.assign(new Error('短い音声の範囲内に字幕時刻を照合できませんでした。既存の字幕は保持されます。'), { code: 'TRANSCRIPT_ALIGNMENT' });
    }
    catch (error) {
      signal?.throwIfAborted();
      if (error?.code !== 'TRANSCRIPT_ALIGNMENT' || end - start <= MIN_WINDOW_SECONDS) throw error;
      retries++;
      const middle = (start + end) / 2;
      await window(start, middle); await window(middle, end); return;
    }
    signal?.throwIfAborted();
    if (raw.alignment?.textModel === 'whisper-1') timingFallbacks++;
    const owns = word => { const middle = from + (word.start + word.end) / 2; return middle >= start && middle < end; };
    const owned = { ...raw, words: Array.isArray(raw.words) ? raw.words.filter(owns) : undefined, segments: Array.isArray(raw.segments) ? raw.segments.filter(owns) : [] };
    for (const cue of cuesFromTranscription(owned, from, to - from, width)) {
      cue.start = Math.max(cues.at(-1)?.end || 0, cue.start); cue.end = Math.min(duration, cue.end);
      if (cue.end - cue.start >= 1 / fps) cues.push(cue);
    }
    if (cues.length > MAX_SUBTITLE_CUES) throw new Error(`字幕が${MAX_SUBTITLE_CUES}件を超えました。`);
    progress({ progress: end / duration, message: `文字起こし ${timeLabel(end)} / ${timeLabel(duration)}・${cues.length}件` });
  }
  // Visit only grid windows containing audible media. Merge interval indices
  // without allocating an entry for every silent minute in a sparse timeline.
  const intervals = (ranges || [{start:0,end:duration}]).map(r => ({
    start: Math.floor(Math.max(0,r.start)/WINDOW_SECONDS),
    end: Math.ceil(Math.min(duration,r.end)/WINDOW_SECONDS)
  })).filter(r=>r.end>r.start).sort((a,b)=>a.start-b.start);
  let nextIndex=0;
  for(const interval of intervals) {
    for(let index=Math.max(nextIndex,interval.start);index<interval.end;index++) {
      const start=index*WINDOW_SECONDS;
      await window(start,Math.min(duration,start+WINDOW_SECONDS));
    }
    nextIndex=Math.max(nextIndex,interval.end);
  }
  return { cues, transcriptionStats: { retries, timingFallbacks } };
}
module.exports = { transcribeWindows, WINDOW_SECONDS, MIN_WINDOW_SECONDS };
