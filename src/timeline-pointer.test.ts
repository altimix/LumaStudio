import { expect, it } from 'vitest';
import { emptyProject, makeClip, splitClip } from './model';
import { canSplitAt, timelinePointerTime } from './timeline-pointer';

function fixture() {
  const p = emptyProject();
  p.clips = [{ ...makeClip(p.tracks[0].id, 0), duration: 6 }, { ...makeClip(p.tracks[1].id, 2), duration: 1 }];
  return p;
}
it('snaps pointer seeks to both clip edges only inside a fixed screen-pixel range', () => {
  const p = fixture();
  expect(timelinePointerTime(p, 2.05, 100, true)).toEqual({ time: 2, snapped: true });
  expect(timelinePointerTime(p, 2.95, 100, true)).toEqual({ time: 3, snapped: true });
  expect(timelinePointerTime(p, 2.05, 200, true).snapped).toBe(false);
  expect(timelinePointerTime(p, 2.06, 100, false)).toEqual({ time: 62 / 30, snapped: false });
  expect(timelinePointerTime(p, 1.9, 100, true).snapped).toBe(false);
  expect(timelinePointerTime(p, -.02, 100, true)).toEqual({ time: 0, snapped: true });
});
it('does not stick to the moving playhead or equate frame rounding with snapping', () => {
  const p = fixture();
  expect(timelinePointerTime(p, 1.21, 100, true)).toEqual({ time: 36 / 30, snapped: false });
  p.markers = [{ id: 'm', label: '合図', time: 1.5 }];
  expect(timelinePointerTime(p, 1.55, 100, true)).toEqual({ time: 1.5, snapped: true });
});
it('uses the actual split rounding for fractional legacy starts and rejects empty edge cuts', () => {
  const p = fixture(), clip = { ...p.clips[0], start: .015 };
  p.clips[0] = clip;
  const guide = timelinePointerTime(p, 2.05, 100, true, clip);
  const pair = splitClip(clip, guide.time, p.fps)!;
  expect(pair[1].start).toBe(guide.time);
  expect(canSplitAt(clip, guide.time, p.fps)).toBe(true);
  for (const raw of [clip.start + .01, clip.start + clip.duration - .01]) {
    const edge = timelinePointerTime(p, raw, 100, true, clip);
    expect(edge.snapped).toBe(true);
    expect(canSplitAt(clip, edge.time, p.fps)).toBe(false);
    expect(splitClip(clip, edge.time, p.fps)).toBeNull();
  }
});
