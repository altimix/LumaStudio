import { describe, it, expect } from 'vitest';
import { opacityAt, windowOpacity, validateOpacityKeys } from '../shared/opacity.mjs';
import { emptyProject, makeClip, splitClip, trimClip, applySequenceSettings } from './model';
import { fadeAt } from './render';
import { useEditor } from './store';

function fixture() {
  const p = emptyProject();
  p.clips = [{ ...makeClip(p.tracks[0].id, 5), duration: 4, opacity: 0.7, opacityKeyframes: [{ time: 0, value: 0 }, { time: 1, value: 1 }, { time: 3, value: 0.2 }] }];
  return p;
}

describe('opacity animation preserves the visible curve', () => {
  it('interpolates linearly, holds endpoints and preserves legacy opacity', () => {
    const keys = fixture().clips[0].opacityKeyframes;
    expect(opacityAt(keys, -1)).toBe(0); expect(opacityAt(keys, 0.5)).toBe(0.5);
    expect(opacityAt(keys, 2)).toBeCloseTo(0.6); expect(opacityAt(keys, 10)).toBe(0.2);
    expect(opacityAt(undefined, 2, 0.7)).toBe(0.7); expect(opacityAt([], 2, 0.7)).toBe(0.7);
  });
  it('multiplies animation by the existing clip fade', () => {
    const clip = { ...fixture().clips[0], fadeIn: 1 };
    expect(opacityAt(clip.opacityKeyframes, 0.5, clip.opacity) * fadeAt(clip, 5.5)).toBe(0.25);
  });
  it('preserves both sides of a split at an interpolated position', () => {
    const p = fixture(); const original = p.clips[0]; const pair = splitClip(original, 6.5, p.fps)!;
    for (const c of pair) {
      validateOpacityKeys(c);
      for (let t = 0; t < c.duration; t += 0.07) expect(opacityAt(c.opacityKeyframes, t)).toBeCloseTo(opacityAt(original.opacityKeyframes, c.start - original.start + t), 10);
    }
  });
  it('preserves left and right trims and holds values when extending either edge', () => {
    const p = fixture(); const original = p.clips[0];
    for (const [edge, delta] of [['left', 0.5], ['left', -2], ['right', -2], ['right', 2]] as const) {
      const c = trimClip(original, edge, delta, p); validateOpacityKeys(c);
      for (let t = 0; t < c.duration; t += 0.07) expect(opacityAt(c.opacityKeyframes, t)).toBeCloseTo(opacityAt(original.opacityKeyframes, c.start - original.start + t), 10);
    }
  });
  it('does not exceed capacity when windowing an already full curve', () => {
    const keys = Array.from({ length: 64 }, (_, i) => ({ time: i + 1, value: i % 2 }));
    for (const [offset, duration] of [[-2, 70], [0, 65], [2.5, 60], [4, 0.4]]) {
      const clipped = windowOpacity(keys, offset, duration)!;
      expect(clipped.length).toBeLessThanOrEqual(64);
      validateOpacityKeys({ kind: 'title', duration, opacityKeyframes: clipped });
    }
  });
  it('normalizes key boundaries when sequence FPS shortens the clip', () => {
    const p = fixture(); p.clips[0].duration = 1.03; p.clips[0].opacityKeyframes = [{ time: 0, value: 0 }, { time: 1.03, value: 1 }];
    const next = applySequenceSettings(p, { name: p.name, width: p.width, height: p.height, fps: 24 });
    validateOpacityKeys(next.clips[0]);
    expect(opacityAt(next.clips[0].opacityKeyframes, 0.5)).toBeCloseTo(0.5 / 1.03);
  });
});

describe('keyframe edits respect history, duration and locks', () => {
  it('updates, deletes and restores keys with undo and redo', () => {
    const p = fixture(); const s = useEditor.getState(); s.load(p);
    s.updateClip(p.clips[0].id, { opacityKeyframes: [{ time: 0, value: 0.5 }] });
    expect(useEditor.getState().project.clips[0].opacityKeyframes).toHaveLength(1);
    s.undo(); expect(useEditor.getState().project.clips[0].opacityKeyframes).toEqual(p.clips[0].opacityKeyframes);
    s.redo(); s.updateClip(p.clips[0].id, { opacityKeyframes: [] });
    expect(opacityAt(useEditor.getState().project.clips[0].opacityKeyframes, 0, 0.7)).toBe(0.7);
  });
  it('protects locked titles and rejects invalid keys without making an undo step', () => {
    const p = fixture(); p.tracks[0].locked = true; const s = useEditor.getState(); s.load(p);
    s.updateClip(p.clips[0].id, { opacityKeyframes: [] }); expect(useEditor.getState().project).toBe(p);
    p.tracks[0].locked = false;
    s.updateClip(p.clips[0].id, { opacityKeyframes: [{ time: 5, value: 0 }] });
    expect(useEditor.getState().project).toBe(p); expect(useEditor.getState().history).toHaveLength(0);
  });
  it('keeps a duration edit savable and retains the visible interpolation', () => {
    const p = fixture(); const s = useEditor.getState(); s.load(p); s.updateClip(p.clips[0].id, { duration: 1.51 });
    const next = useEditor.getState().project.clips[0]; validateOpacityKeys(next);
    expect(next.duration).toBe(1.5); expect(opacityAt(next.opacityKeyframes, 1.4)).toBeCloseTo(opacityAt(p.clips[0].opacityKeyframes, 1.4));
  });
});
