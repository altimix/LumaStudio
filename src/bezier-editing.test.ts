import { describe, expect, it } from 'vitest';
import { constrainBezierVector, editBezierHandle, newBezierPoint, translateBezierPoints } from './bezier-editing';
import { mediaPoint } from './media-transform';
import type { Clip } from './types';
import { MAX_BEZIER_COORD, MIN_BEZIER_COORD, validateVideoMask } from '../shared/video-mask.mjs';

const project = { width: 1920, height: 1080 };
const clip = { x: 0, y: 0, scale: .85, rotation: 0 } as Clip;
describe('Bezier modifier geometry', () => {
  it.each([{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }])('snaps visible angles with source %o, including a rotated clip', source => {
    for (const rotation of [0, 17, -50]) {
      const item = { ...clip, rotation };
      for (const vector of [{ x: .2, y: .19 }, { x: -.1, y: .03 }, { x: .02, y: -.3 }]) {
        const snapped = constrainBezierVector(item, source, project, vector);
        const a = mediaPoint(item, source, project, { x: .5, y: .5 });
        const b = mediaPoint(item, source, project, { x: .5 + snapped.x, y: .5 + snapped.y });
        const angle = Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4);
        expect(angle).toBeCloseTo(Math.round(angle), 8);
      }
    }
  });
  it('translates a group and its handles rigidly at the first boundary', () => {
    const points = [newBezierPoint({ x: .2, y: .3 }), { ...newBezierPoint({ x: .8, y: .4 }), inX: .7, outX: MAX_BEZIER_COORD - .1 }];
    const result = translateBezierPoints(points, [0, 1], { x: .4, y: .2 });
    expect(result[1].outX).toBe(MAX_BEZIER_COORD);
    expect(result[1].x - result[0].x).toBeCloseTo(.6);
    expect(result[1].y - result[0].y).toBeCloseTo(.1);
    expect(result[1].outX - result[1].x).toBeCloseTo(MAX_BEZIER_COORD - .9);
    expect((result[0].x - points[0].x) / (result[0].y - points[0].y)).toBeCloseTo(2);
  });
  it('preserves the opposite handle under Alt and restores symmetry without Alt', () => {
    const original = { ...newBezierPoint({ x: .5, y: .5 }), inX: .2, inY: .4, outX: .8, outY: .6 };
    const moved = editBezierHandle(original, 'out', { x: .1, y: .3 }, true);
    expect(moved.inX).toBe(original.inX); expect(moved.inY).toBe(original.inY);
    expect(moved.outX).toBeCloseTo(.6); expect(moved.outY).toBeCloseTo(.8);
    const mirrored = editBezierHandle(moved, 'in', { x: -.2, y: .1 }, false);
    expect(mirrored.inX + mirrored.outX).toBeCloseTo(1); expect(mirrored.inY + mirrored.outY).toBeCloseTo(1);
  });
  it('keeps constrained handles on their ray at bounds and persists asymmetric points', () => {
    for (const independent of [true, false]) {
      const point = editBezierHandle(newBezierPoint({ x: .9, y: .2 }), 'out', { x: 40, y: 40 }, independent);
      expect(point.outX - point.x).toBeCloseTo(point.outY - point.y);
      expect(() => validateVideoMask({ kind: 'video', videoMask: { type: 'bezier', points: [point], closed: false, feather: 0, inverted: false } })).not.toThrow();
    }
  });
});

it('moves anchors and handles beyond every source edge without clipping the curve', () => {
  for (const x of [-.2, 1.2]) for (const y of [-.1, 1.1]) {
    const original = newBezierPoint({ x: .5, y: .5 });
    const [point] = translateBezierPoints([original], [0], { x: x - .5, y: y - .5 });
    expect(point.x).toBeCloseTo(x); expect(point.y).toBeCloseTo(y);
    const edited = editBezierHandle(point, 'out', { x: .25, y: .1 }, false);
    expect(edited.inX + edited.outX).toBeCloseTo(2 * x);
    expect(() => validateVideoMask({ kind: 'image', videoMask: { type: 'bezier', points: [edited], closed: false, feather: 0, inverted: false } })).not.toThrow();
  }
  for (const x of [MIN_BEZIER_COORD, MAX_BEZIER_COORD]) {
    const point = editBezierHandle(newBezierPoint({ x, y: .5 }), 'out', { x: .08, y: 0 }, false);
    expect(point.inX).toBe(x); expect(point.outX).toBe(x);
  }
});
