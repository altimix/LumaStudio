import { describe, expect, it } from 'vitest';
import { emptyProject, makeClip } from './model';
import { mediaBounds, mediaCorner, moveMedia, resizeMedia, visualOrder, type Corner } from './media-transform';

const landscape = { width: 1920, height: 1080 }, portrait = { width: 1080, height: 1920 }, square = { width: 800, height: 800 };
const clip = { ...makeClip('video', 0), kind: 'video' as const };
describe('program monitor media transforms', () => {
  it('fits source aspect ratios inside landscape and portrait sequences', () => {
    expect(mediaBounds(clip, square, landscape)).toEqual({ x: 960, y: 540, width: 1080, height: 1080 });
    expect(mediaBounds(clip, landscape, portrait)).toEqual({ x: 540, y: 960, width: 1080, height: 607.5 });
    expect(mediaBounds({ ...clip, scale: .5, x: 10, y: -25 }, portrait, landscape)).toEqual({ x: 1152, y: 270, width: 303.75, height: 540 });
  });
  it('uses source dimensions supplied by the rendered frame, including rotated media', () => {
    expect(mediaBounds(clip, { width: 1080, height: 1920 }, landscape).width).toBe(607.5);
    expect(mediaBounds(clip, { width: 0, height: 0 }, landscape).width).toBe(1920);
  });
  it('converts movement into project percentages with bounded position and optional center snapping', () => {
    expect(moveMedia(clip, landscape, { x: 192, y: -108 })).toEqual({ x: 10, y: -10 });
    expect(moveMedia({ ...clip, x: 199, y: -199 }, landscape, { x: 300, y: -300 })).toEqual({ x: 200, y: -200 });
    expect(moveMedia(clip, portrait, { x: 4, y: -4 }, { x: 5, y: 5 })).toEqual({ x: 0, y: 0 });
  });
  for (const rotation of [0, 33, 90, -140]) it(`keeps the opposite corner fixed with uniform scaling at ${rotation} degrees`, () => {
    for (const project of [landscape, portrait]) for (const x of [-1, 1] as const) for (const y of [-1, 1] as const) {
      const initial = { ...clip, x: 5, y: -8, scale: .6, rotation }, corner: Corner = { x, y };
      const moving = mediaCorner(initial, square, project, corner), opposite = mediaCorner(initial, square, project, { x: -x as -1 | 1, y: -y as -1 | 1 });
      const result = resizeMedia(initial, square, project, corner, { x: (moving.x - opposite.x) * .4, y: (moving.y - opposite.y) * .4 });
      expect(result.scale).toBeCloseTo(.84, 8);
      const fixed = mediaCorner({ ...initial, ...result }, square, project, { x: -x as -1 | 1, y: -y as -1 | 1 });
      expect(fixed.x).toBeCloseTo(opposite.x, 8); expect(fixed.y).toBeCloseTo(opposite.y, 8);
      const bounds = mediaBounds({ ...initial, ...result }, square, project); expect(bounds.width / bounds.height).toBeCloseTo(1, 8);
    }
  });
  it('clamps resizing without flipping the source or moving outside position limits', () => {
    const small = resizeMedia(clip, landscape, landscape, { x: 1, y: 1 }, { x: -100000, y: -100000 });
    const large = resizeMedia(clip, landscape, landscape, { x: 1, y: 1 }, { x: 100000, y: 100000 });
    expect(small.scale).toBe(.1); expect(large.scale).toBe(3);
    expect(Math.abs(large.x)).toBeLessThanOrEqual(200); expect(Math.abs(large.y)).toBeLessThanOrEqual(200);
  });
  it('orders media and text together by track, start time and stable insertion order', () => {
    const project = emptyProject(), upper = project.tracks[0].id, lower = project.tracks[1].id;
    project.clips = [{ ...clip, id: 'upper-video', trackId: upper, start: 2 }, { ...clip, id: 'lower', trackId: lower }, { ...clip, id: 'upper-text', kind: 'title', trackId: upper, start: 1 }, { ...clip, id: 'upper-image', kind: 'image', trackId: upper, start: 2 }, { ...clip, id: 'audio', kind: 'audio', trackId: lower }];
    expect([...visualOrder(project).keys()]).toEqual(['lower', 'upper-text', 'upper-video', 'upper-image']);
  });
});
