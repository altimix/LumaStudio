import { MAX_MEDIA_SECONDS } from './time.mjs';
export const MAX_SUBTITLE_CUES = 100000;
import { buildCaptionCues, wrapCaption } from './captions.mjs';
// A change detector, not an authorization token. Shared by the UI and desktop jobs.
export function timelineKey(p) {
  const solo = p.tracks.some(t => t.solo);
  const data = [p.id, p.fps, Math.max(0, ...p.clips.map(c => c.start + c.duration)), p.clips.filter(c => c.kind === 'audio' || (c.kind === 'video' && !c.audioDetached)).map(c => {
    const a = p.assets.find(a => a.id === c.assetId); const t = p.tracks.find(t => t.id === c.trackId);
    return [c.id, c.assetId, a?.path, a?.revision || a?.id, a?.size, a?.hasAudio, a?.duration, a?.offline || false, c.start, c.in, c.duration, c.speed, c.volume, c.fadeIn, c.fadeOut, !!t?.muted, solo && !t?.solo, ...(c.audioMuted ? ["muted"] : []), ...(c.audioTreatment ? [c.audioTreatment] : []), ...(c.volumeKeyframes?.length ? [c.volumeKeyframes] : [])];
  })];
  const transitions=p.transitions?.filter(t=>t.audio).map(t=>[t.fromId,t.toId,t.audio,...(t.mode==='fixed'?[t.mode,t.duration]:[])]);if(transitions?.length)data.push(transitions);
  let a = 2166136261, b = 5381; const text = JSON.stringify(data);
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
  return `${text.length}:${a >>> 0}:${b >>> 0}`;
}
export function chapterTime(seconds) {
  const n = Math.max(0, Math.floor(seconds));
  return (n >= 3600 ? [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60] : [Math.floor(n / 60), n % 60]).map(v => String(v).padStart(2, '0')).join(':');
}
export function subtitleTime(seconds, vtt = false) {
  const n = Math.max(0, Math.round(seconds * 1000));
  return `${[Math.floor(n / 3600000), Math.floor(n / 60000) % 60, Math.floor(n / 1000) % 60].map(v => String(v).padStart(2, '0')).join(':')}${vtt ? '.' : ','}${String(n % 1000).padStart(3, '0')}`;
}
export function wrapJapanese(text, width = 24) {
  // Manual line breaks survive application to the timeline. Wrap each line
  // independently so a chosen phrase break also appears in the burned-in text.
  return text.trim().split(/\r\n?|\n/).map(line => {
    const chars = [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(line.replace(/\s+/g, ' ').trim())].map(v => v.segment);
    const lines = [];
    while (chars.length) {
      let end = Math.min(width, chars.length);
      // Keep closing punctuation on the preceding line; prefer a nearby phrase break.
      if (chars.length > width) {
        for (let i = end - 1; i >= Math.floor(width * 0.65); i--) if (/[、。！？!?\s]/.test(chars[i])) { end = i + 1; break; }
        while (end < chars.length && /[、。！？!?」』）)]/.test(chars[end])) end++;
      }
      lines.push(chars.splice(0, end).join('').trim());
    }
    return lines.join('\n');
  }).join('\n');
}
export function cuesFromTranscription(data, offset, duration, width = 24) {
  return buildCaptionCues(data,offset,duration,text=>wrapCaption(text,width));
}
export function validateCues(cues) {
  if (!Array.isArray(cues) || cues.length > MAX_SUBTITLE_CUES) throw new Error(`字幕は${MAX_SUBTITLE_CUES}件以内にしてください。`);
  let end = 0;
  for (const c of cues) {
    if (!c || !Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < end - 0.001 || c.start < 0 || c.end <= c.start || c.end > MAX_MEDIA_SECONDS || typeof c.text !== 'string' || !c.text.trim() || c.text.length > 4000) throw new Error('字幕の時刻・本文が不正です。時刻は昇順で重ならないようにしてください。');
    if (c.text.split(/\r\n?|\n/).some(line => !line.trim())) throw new Error('字幕の本文に空行は入れられません。先頭・末尾や連続した改行を削除してください。');
    end = c.end;
  }
  return cues;
}
export function subtitleFile(cues, format = 'srt') {
  validateCues(cues); const vtt = format === 'vtt';
  return (vtt ? 'WEBVTT\n\n' : '') + cues.map((c, i) => `${vtt ? '' : `${i + 1}\n`}${subtitleTime(c.start, vtt)} --> ${subtitleTime(c.end, vtt)}\n${c.text.replace(/-->/g, '→').replace(/[<>]/g, '')}\n`).join('\n');
}
export function validateYoutube(y) {
  if (y === undefined) return;
  if (!y || typeof y !== 'object' || typeof y.sourceKey !== 'string' || y.sourceKey.length > 100) throw new Error('YouTube制作データが不正です。');
  if (new TextEncoder().encode(JSON.stringify(y)).byteLength > 12 * 1024 * 1024) throw new Error('YouTube制作データが大きすぎます。シーケンスを分けてください。');
  validateCues(y.cues);
  if (y.transcriptionStats !== undefined && (!y.transcriptionStats || !['retries', 'timingFallbacks'].every(key => Number.isSafeInteger(y.transcriptionStats[key]) && y.transcriptionStats[key] >= 0))) throw new Error('文字起こしの処理結果が不正です。');
  if (!Array.isArray(y.titles) || y.titles.length > 3 || y.titles.some(t => typeof t !== 'string' || t.length > 100)) throw new Error('タイトルは100文字以内で3案までです。');
  if (typeof y.description !== 'string' || y.description.length > 5000 || typeof y.thumbnailPrompt !== 'string' || y.thumbnailPrompt.length > 6000) throw new Error('概要欄または画像プロンプトが長すぎます。');
  if (!Array.isArray(y.keywords) || y.keywords.length > 10 || y.keywords.some(k => typeof k !== 'string' || k.length > 80 || /[,，\n]/.test(k))) throw new Error('検索ワードはカンマを含まない10個以内の語句にしてください。');
  if (y.hashtags !== undefined && (!Array.isArray(y.hashtags) || y.hashtags.length > 3 || y.hashtags.some(tag => typeof tag !== 'string' || tag.length > 81 || !/^#[\p{L}\p{M}\p{N}_]+$/u.test(tag)) || new Set(y.hashtags.map(tag => tag.normalize('NFKC').toLowerCase())).size !== y.hashtags.length)) throw new Error('ハッシュタグは重複なしで3個以内、#に続く文字・数字・_で入力してください。1個80文字以内で、タグ内に空白や記号は使えません。');
  if (!Array.isArray(y.chapters) || y.chapters.length > 100 || y.chapters.some(c => !c || !Number.isInteger(c.time) || c.time < 0 || c.time > 86400 || typeof c.label !== 'string' || c.label.length > 100 || /\n/.test(c.label))) throw new Error('チャプターが不正です。');
  if (composeDescription(y, y.chapters.length > 0).length > 5000) throw new Error('チャプターとハッシュタグを含む概要欄は5000文字以内にしてください。');
  if (y.thumbnailAssetId !== undefined && typeof y.thumbnailAssetId !== 'string') throw new Error('サムネイルが不正です。');
}
export function validChapters(chapters, duration) {
  return chapters.length >= 3 && chapters[0].time === 0 && chapters.every((c, i) => (chapters[i + 1]?.time ?? duration) - c.time >= 10);
}
export function descriptionWithChapters(y, duration) {
  return composeDescription(y, validChapters(y.chapters, duration));
}
function composeDescription(y, includeChapters) {
  return [y.description.trim(), includeChapters ? '【チャプター】\n' + y.chapters.map(c => `${chapterTime(c.time)} ${c.label}`).join('\n') : '', (y.hashtags || []).join(' ')].filter(Boolean).join('\n\n');
}
export function parseHashtags(value) {
  return value.normalize('NFKC').split(/[\s,、]+/u).filter(Boolean).map(tag => tag.startsWith('#') ? tag : `#${tag}`);
}
export function youtubeText(y, duration) {
  return `【タイトル案】\n${y.titles.join('\n')}\n\n【概要欄】\n${descriptionWithChapters(y, duration)}\n\n【検索ワード】\n${y.keywords.join(',')}\n\n【サムネイル用プロンプト】\n${y.thumbnailPrompt}\n`;
}
