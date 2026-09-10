import type { Clip, Project } from './types';
import { roundFrame, trimClip, uid } from './model';

export type TimelineGap = { from: number; to: number };

/** Find the bounded empty interval on the clicked lane, in sequence seconds. */
export function findTimelineGap(p: Project, trackId: string, time: number): TimelineGap | null {
  if (!Number.isFinite(time) || time < 0 || !p.tracks.some(t => t.id === trackId)) return null;
  const at = Math.floor(time * p.fps + 1e-7) / p.fps;
  let from = 0, to = Infinity;
  for (const clip of p.clips) {
    if (clip.trackId !== trackId) continue;
    const start = roundFrame(clip.start, p.fps), end = roundFrame(clip.start + clip.duration, p.fps);
    if (start <= at && end > at) return null;
    if (end <= at) from = Math.max(from, end);
    if (start > at) to = Math.min(to, start);
  }
  return Number.isFinite(to) && to - from >= 1 / p.fps - 1e-7 ? { from, to } : null;
}

export function gapRippleBlockReason(p: Project, gap: TimelineGap): string | null {
  const affected = new Set(p.clips.filter(c => c.start + c.duration > gap.from + 1e-7).map(c => c.trackId));
  const locked = p.tracks.filter(t => t.locked && affected.has(t.id));
  return locked.length ? `「${locked.map(t => t.name).join('」「')}」のロックを解除してください。` : null;
}

export function rippleGapTime(time: number, gap: TimelineGap, fps: number): number {
  return time < gap.from ? time : roundFrame(Math.max(gap.from, time - (gap.to - gap.from)), fps);
}

/** Delete the same sequence interval from every track, including spanning media. */
export function deleteTimelineGap(p: Project, trackId: string, time: number): { project: Project; gap: TimelineGap } | null {
  const gap = findTimelineGap(p, trackId, time);
  if (!gap) return null;
  const blocked = gapRippleBlockReason(p, gap);
  if (blocked) throw Error(blocked);
  const { from, to } = gap, amount = roundFrame(to - from, p.fps), epsilon = 1e-7;
  const incoming = new Map<string, string>(), outgoing = new Map<string, string>();
  const clips = p.clips.flatMap(c => {
    const end = c.start + c.duration;
    if (end <= from + epsilon) return [c];
    if (c.start >= to - epsilon) return [{ ...c, start: roundFrame(c.start - amount, p.fps) }];
    const kept: Clip[] = [];
    if (from - c.start >= 1 / p.fps - epsilon) kept.push(trimClip({ ...c, fadeOut: 0 }, 'right', from - end, p));
    if (end - to >= 1 / p.fps - epsilon) {
      const right = trimClip({ ...c, fadeIn: 0 }, 'left', to - c.start, p);
      kept.push({ ...right, id: kept.length ? uid() : c.id, start: roundFrame(right.start - amount, p.fps) });
    }
    if (kept.length) { incoming.set(c.id, kept[0].id); outgoing.set(c.id, kept.at(-1)!.id); }
    return kept;
  });
  if (clips.length > 2000) throw Error('クリップは最大2000個です。先に不要なクリップを削除してください。');
  // A middle cut keeps the old outer joins attached to the appropriate fragment.
  const transitions = p.transitions?.map(t => ({ ...t, fromId: outgoing.get(t.fromId) || t.fromId, toId: incoming.get(t.toId) || t.toId }));
  const markers = p.markers.map(m => ({ ...m, time: rippleGapTime(m.time, gap, p.fps) }));
  return { project: { ...p, clips, markers, ...(transitions ? { transitions } : {}) }, gap };
}
