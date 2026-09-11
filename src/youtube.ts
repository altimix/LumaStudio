import { separateOverlappingClips } from './track-placement';
import { captionStyle } from './caption-style';
import { endTime, makeClip, makeTrack, roundFrame } from './model';
import type { Project, YoutubeData } from './types';
import { timelineKey, validateCues } from '../shared/youtube.mjs';
export const emptyYoutube = (p: Project): YoutubeData => ({ sourceKey: timelineKey(p), cues: [], titles: [], description: '', chapters: [], keywords: [], thumbnailPrompt: '' });
export function applySubtitles(p: Project): Project {
  const y = p.youtube; if (!y?.cues.length) throw new Error('先に文字起こしを実行してください。');
  if (y.sourceKey !== timelineKey(p)) throw new Error('音声の編集後に文字起こしを再実行してください。');
  validateCues(y.cues);
  const prior = p.clips.filter(c => c.subtitle);
  if (prior.some(c => p.tracks.find(t => t.id === c.trackId)?.locked)) throw new Error('字幕トラックのロックを解除してください。');
  const remaining = p.clips.filter(c => !c.subtitle);
  if (remaining.length + y.cues.length > 2000) throw new Error('字幕を含めて2000クリップを超えます。シーケンスを分けてください。');
  const priorTracks = new Set(prior.map(c => c.trackId));
  let track = p.tracks.find(t => t.id === prior[0]?.trackId && !t.locked)
    || p.tracks.find(t => priorTracks.has(t.id) && !t.locked)
    || p.tracks.find(t => t.kind === 'video' && t.name === '日本語字幕' && !t.locked);
  const added = !track;
  if (!track) { if (p.tracks.length >= 24) throw new Error('字幕用のトラックを追加するには、不要なトラックを減らしてください。'); track = makeTrack('video'); }
  const limit = endTime(p);
  let clips = y.cues.map(c => {
    const start = roundFrame(c.start, p.fps), end = Math.min(limit, roundFrame(c.end, p.fps));
    if (end - start < 1 / p.fps - 0.000001) throw new Error('1フレーム未満の字幕があります。時刻を修正してください。');
    return { ...makeClip(track.id, start), name: c.text.replace(/\n/g, ' ').slice(0, 60), subtitle: true, duration: end - start, ...captionStyle(p,c.text), textStyle: 'subtitle' as const };
  });
  if (prior.length === clips.length && clips.every((c,i) => c.start === prior[i].start && c.duration === prior[i].duration)) {
    clips = clips.map((c,i) => ({ ...c, trackId: prior[i].trackId }));
  }
  return separateOverlappingClips({ ...p, tracks: added ? [track, ...p.tracks] : p.tracks, clips: [...remaining, ...clips] }, clips.map(c => c.id), undefined, [...priorTracks]);
}
