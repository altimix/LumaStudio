import type { Clip } from './types';

const EPS = 1e-7;
export const overlaps = (a: Clip, b: Clip) => a.start < b.start + b.duration - EPS && b.start < a.start + a.duration - EPS;
export const TRACK_SPACE_MESSAGE = '重ならないように配置するには新しいトラックが必要です。トラックは最大24本のため、不要なトラックを削除するか空き区間へ配置してください。';

/** Return the minimum extra lanes for one destination, keeping its existing clips fixed. */
export function extraTrackPartitions(group: Clip[], stationary: Clip[], available: number): Clip[][] {
  const events = new Map<number, { placed: number; fixed: number }>();
  for (const [clips, key] of [[group, 'placed'], [stationary, 'fixed']] as const) for (const c of clips) {
    for (const [time, delta] of [[c.start, 1], [c.start + c.duration, -1]]) {
      const event = events.get(time) || { placed: 0, fixed: 0 }; event[key] += delta; events.set(time, event);
    }
  }
  const spans: { start: number; end: number; count: number; blocked: boolean }[] = [];
  let previous = 0, placed = 0, fixed = 0, peak = 0, blockedPeak = 0;
  for (const [time, event] of [...events].sort(([a], [b]) => a - b)) {
    if (time > previous + EPS && placed > 0) {
      spans.push({ start: previous, end: time, count: placed, blocked: fixed > 0 });
      peak = Math.max(peak, placed); if (fixed > 0) blockedPeak = Math.max(blockedPeak, placed);
    }
    previous = time; placed += event.placed; fixed += event.fixed;
  }
  if (!peak) return [];
  const lower = Math.max(peak - 1, blockedPeak);
  if (lower > available) throw Error(TRACK_SPACE_MESSAGE);
  let original = new Set<string>();
  if (lower < peak) {
    // Using the original lane can save at most one extra lane. To do so, choose
    // non-overlapping eligible clips covering every span with peak concurrency.
    const critical = spans.filter(s => s.count === peak);
    const eligible = group.filter(c => stationary.every(other => !overlaps(c, other)));
    const choices = new Map<number, Clip | null>();
    const ends = [...new Set(eligible.map(c => c.start + c.duration))].sort((a,b) => b-a);
    for (const after of [...ends, -Infinity]) {
      let lo = 0, hi = critical.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (critical[mid].end <= after + EPS) lo = mid + 1; else hi = mid; }
      if (lo === critical.length) { choices.set(after, null); continue; }
      const point = Math.max(after, critical[lo].start);
      const clip = eligible.find(c => c.start >= after - EPS && c.start <= point + EPS && c.start + c.duration > point + EPS && choices.has(c.start + c.duration));
      if (clip) choices.set(after, clip);
    }
    if (choices.has(-Infinity)) {
      let clip = choices.get(-Infinity);
      while (clip) { original.add(clip.id); clip = choices.get(clip.start + clip.duration); }
    } else if (peak > available) throw Error(TRACK_SPACE_MESSAGE);
  }
  const partitions: Clip[][] = [];
  for (const clip of [...group].sort((a,b) => a.start-b.start)) if (!original.has(clip.id)) {
    let partition = partitions.find(items => !overlaps(clip, items[items.length-1]));
    if (!partition) { partition = []; partitions.push(partition); } partition.push(clip);
  }
  if (partitions.length > available) throw Error(TRACK_SPACE_MESSAGE);
  return partitions;
}
