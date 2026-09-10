import type { Project } from './types';
import { makeTrack, uid } from './model';
import { audioTargets, clipsLocked, sameTiming, validateClipLinks } from '../shared/clip-links.mjs';

export function separateAudio(p: Project, ids: string[], link = true, reuseAvailable = false): Project {
  const targets = p.clips.filter(c => ids.includes(c.id) && c.kind === 'video' && !c.audioDetached && p.assets.find(a => a.id === c.assetId)?.hasAudio);
  if (!targets.length) throw Error('音声付きの未分離の動画を選択してください。');
  if (clipsLocked(p, targets.map(c => c.id))) throw Error('映像トラックのロックを解除してください。');
  if (p.clips.length + targets.length > 2000) throw Error('クリップは最大2000個です。');
  const tracks = [...p.tracks], replacements = new Map(), audioIds = new Map<string, string>();
  const reserved: { trackId: string; start: number; duration: number }[] = [];
  const audio = targets.map(c => {
    const sourceTrack = p.tracks.find(t => t.id === c.trackId)!;
    const name = `${sourceTrack.name}の音声`;
    const available = (trackId: string) => ![...p.clips, ...reserved].some(other => other.trackId === trackId && Math.min(other.start + other.duration, c.start + c.duration) - Math.max(other.start, c.start) > 1e-7);
    const compatible = (t: Project['tracks'][number]) => t.kind === 'audio' && !t.locked && t.muted === sourceTrack.muted && t.solo === sourceTrack.solo;
    let track = tracks.find(t => compatible(t) && t.name === name && (!reuseAvailable || available(t.id)));
    if (!track && reuseAvailable) track = tracks.find(t => compatible(t) && available(t.id));
    if (!track) {
      if (tracks.length >= 24) throw Error('音声用トラックを追加する空きがありません（最大24本）。');
      track = { ...makeTrack('audio', name), muted: sourceTrack.muted, solo: sourceTrack.solo };
      const firstAudio = tracks.findIndex(t => t.kind === 'audio'); tracks.splice(firstAudio < 0 ? tracks.length : firstAudio, 0, track);
    }
    const id = uid(), linkId = link ? uid() : undefined;
    reserved.push({ trackId: track.id, start: c.start, duration: c.duration });
    audioIds.set(c.id, id); replacements.set(c.id, { ...c, linkId, audioDetached: true, audioTreatment: undefined, volumeKeyframes: undefined });
    const {audioDetached: _videoOnly, ...audioSource}=c;
    return { ...audioSource, id, linkId, kind: 'audio' as const, trackId: track.id, name: `${c.name}（音声）` };
  });
  // Preserve existing crossfades on the new audio sources, including partial separation of a join.
  const transitions = p.transitions?.flatMap(t => {
    if (!t.audio || (!audioIds.has(t.fromId) && !audioIds.has(t.toId))) return [t];
    return [...(t.video ? [{ ...t, audio: undefined }] : []), { ...t, video: undefined, id: t.video ? uid() : t.id, fromId: audioIds.get(t.fromId) || t.fromId, toId: audioIds.get(t.toId) || t.toId, audio: t.audio }];
  });
  if (transitions && transitions.length > 1999) throw Error('トランジション数の上限です。効果を減らしてから分離してください。');
  return { ...p, tracks, clips: [...p.clips.map(c => replacements.get(c.id) || c), ...audio], ...(transitions ? { transitions } : {}) };
}

export function relinkAudio(p: Project, ids: string[]): Project {
  const clips = p.clips.filter(c => ids.includes(c.id));
  const video = clips.find(c => c.kind === 'video'), audio = clips.find(c => c.kind === 'audio');
  if (clips.length !== 2 || !video || !audio || video.linkId || audio.linkId || video.assetId !== audio.assetId || !sameTiming(video, audio)) throw Error('同じ素材・開始時間・素材の開始位置・長さ・速度の映像と音声を2つ選択してください。');
  if (clipsLocked(p, ids)) throw Error('映像と音声のトラックのロックを解除してください。');
  const linkId = uid();
  const next = { ...p, clips: p.clips.map(c => c.id === video.id ? { ...c, linkId, audioDetached: true, audioTreatment: undefined, volumeKeyframes: undefined } : c.id === audio.id ? { ...c, linkId } : c) };
  validateClipLinks(next); return next;
}

export function patchAudio(p: Project, ids: string[], patch: { audioTreatment?: 'normalize' | 'speech'; audioMuted?: boolean }): Project {
  const targets = audioTargets(p, ids).map(c => c.id);
  if (!targets.length) throw Error('音声のあるクリップを選択してください。');
  if (clipsLocked(p, targets)) throw Error('音声トラックのロックを解除してください。');
  return { ...p, clips: p.clips.map(c => targets.includes(c.id) ? { ...c, ...patch } : c) };
}
