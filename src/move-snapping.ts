import type { Project } from './types';
import { roundFrame } from './model';

// Return an explicit match: frame rounding is not evidence of a snap.
export function snapMove(project: Project, ids: string[], delta: number, threshold: number, playhead: number) {
  const selected = new Set(ids), moving = project.clips.filter(c => selected.has(c.id));
  const minimum = -Math.min(...moving.map(c => roundFrame(c.start,project.fps)));
  delta = Math.max(minimum, delta);
  const targets = [0, playhead, ...project.markers.map(m => m.time), ...project.clips.filter(c => !selected.has(c.id)).flatMap(c => [c.start, c.start + c.duration])].map(time=>roundFrame(time,project.fps)).sort((a,b)=>a-b);
  let distance = threshold, point: number | null = null, result = delta;
  for (const clip of moving) for (const offset of [0,clip.duration]) {
    const start=roundFrame(clip.start,project.fps),edge=start+offset;
    const proposed = edge + delta;
    let low = 0, high = targets.length;
    while (low < high) { const mid = (low + high) >>> 1; if (targets[mid] < proposed) low = mid + 1; else high = mid; }
    for (const target of [targets[low-1], targets[low]]) {
      const correction = target - proposed;
      const candidate=roundFrame(roundFrame(target-offset,project.fps)-start,project.fps);
      if (Number.isFinite(target) && Math.abs(correction) <= distance && candidate >= minimum) {
        distance = Math.abs(correction); result = candidate;
        // The guide follows the actual placed edge, including a fractional source duration.
        point = roundFrame(clip.start+candidate,project.fps)+offset;
      }
    }
  }
  return { delta: result, point };
}
