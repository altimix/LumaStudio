import { retimeVolume } from './volume-automation.mjs';
const timing = ['start', 'in', 'duration', 'speed'];
export const sameTiming = (a, b) => timing.every(key => Math.abs(a[key] - b[key]) < 1e-7);
export const hasClipAudio = (clip, asset) => !!asset?.hasAudio && ['video', 'audio'].includes(clip.kind) && !clip.audioDetached;
export function linkedIds(p, ids) {
  const selected = new Set(ids), links = new Set(p.clips.filter(c => selected.has(c.id) && c.linkId).map(c => c.linkId));
  return p.clips.filter(c => selected.has(c.id) || (c.linkId && links.has(c.linkId))).map(c => c.id);
}
export function audioTargets(p, ids) {
  const expanded = new Set(linkedIds(p, ids));
  return p.clips.filter(c => expanded.has(c.id) && hasClipAudio(c, p.assets.find(a => a.id === c.assetId)));
}
export const clipsLocked = (p, ids) => p.clips.some(c => ids.includes(c.id) && p.tracks.find(t => t.id === c.trackId)?.locked);
export function validateClipLinks(p) {
  const groups = new Map();
  for (const c of p.clips) {
    if (c.audioDetached !== undefined && (typeof c.audioDetached !== 'boolean' || c.kind !== 'video')) throw Error('映像の音声分離設定が不正です。');
    if (c.audioMuted !== undefined && (typeof c.audioMuted !== 'boolean' || !['video','audio'].includes(c.kind))) throw Error('クリップのミュート設定が不正です。');
    if (c.linkId !== undefined) {
      if (typeof c.linkId !== 'string' || !c.linkId.length || c.linkId.length > 128) throw Error('リンクIDが不正です。');
      const group = groups.get(c.linkId) || []; group.push(c); groups.set(c.linkId, group);
    }
  }
  for (const group of groups.values()) {
    const video = group.find(c => c.kind === 'video'), audio = group.find(c => c.kind === 'audio');
    if (group.length !== 2 || !video || !audio || !video.audioDetached || audio.assetId !== video.assetId || !sameTiming(video, audio) || !p.assets.find(a => a.id === video.assetId)?.hasAudio) throw Error('映像と音声のリンクが不正です。同じ素材区間の映像と音声を指定してください。');
  }
}
// A timing edit follows the partner; trims and rate changes retain each member's own fades.
function followTiming(partner, next) {
  const ratio = partner.speed / next.speed;
  const fadeIn = Math.min(next.duration, partner.fadeIn * ratio);
  const fadeOut = Math.min(next.duration - fadeIn, partner.fadeOut * ratio);
  return { ...partner, ...Object.fromEntries(timing.map(key => [key, next[key]])), fadeIn, fadeOut, ...(partner.volumeKeyframes ? { volumeKeyframes: retimeVolume(partner, next) } : {}) };
}
export function syncLinkedEdits(before, next, newId) {
  const groups = new Map(), old = new Map(before.clips.map(c => [c.id, c]));
  for (const c of next.clips) if (c.linkId) { const group = groups.get(c.linkId) || []; group.push(c); groups.set(c.linkId, group); }
  const updates = new Map();
  for (const [linkId, group] of groups) {
    if (group.length === 2) {
      const changed = group.filter(c => old.get(c.id)?.linkId === linkId && !sameTiming(c, old.get(c.id)));
      if (changed.length === 1) {
        const partner = group.find(c => c !== changed[0]); updates.set(partner.id, followTiming(partner, changed[0]));
      }
    } else {
      // Splitting a linked pair creates two independent pairs. Removing one member drops the dangling link.
      const remaining = [...group]; let first = true;
      while (remaining.length) {
        const c = remaining.shift(), index = remaining.findIndex(other => other.kind !== c.kind && other.assetId === c.assetId && sameTiming(c, other));
        const id = index >= 0 ? (first ? linkId : newId()) : undefined; first = false;
        updates.set(c.id, { ...c, linkId: id });
        if (index >= 0) { const partner = remaining.splice(index, 1)[0]; updates.set(partner.id, { ...partner, linkId: id }); }
      }
    }
  }
  const result = updates.size ? { ...next, clips: next.clips.map(c => updates.get(c.id) || c) } : next;
  const current = new Map(result.clips.map(c => [c.id, c]));
  for (const c of before.clips) if (before.tracks.find(t => t.id === c.trackId)?.locked && JSON.stringify(current.get(c.id)) !== JSON.stringify(c)) throw Error('リンク相手を含むトラックのロックを解除してください。');
  validateClipLinks(result); return result;
}
export function cloneLinkedClips(clips, newId, offset) {
  const links = new Map();
  return clips.map(c => {
    if (c.linkId && !links.has(c.linkId)) links.set(c.linkId, newId());
    return { ...c, id: newId(), start: c.start + offset, ...(c.linkId ? { linkId: links.get(c.linkId) } : {}) };
  });
}
