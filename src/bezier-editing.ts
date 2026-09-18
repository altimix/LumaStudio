import type { BezierMaskPoint, Clip, Project } from './types';
import { mediaNormalizedPoint, mediaPoint, type Position, type SourceSize } from './media-transform';

/** Snap in monitor pixels, not normalized coordinates (which distort 45° on wide sources). */
export function constrainBezierVector(clip: Clip, source: SourceSize, project: Pick<Project, 'width' | 'height'>, vector: Position): Position {
  const origin = mediaPoint(clip, source, project, { x: .5, y: .5 });
  const end = mediaPoint(clip, source, project, { x: .5 + vector.x, y: .5 + vector.y });
  const x = end.x - origin.x, y = end.y - origin.y;
  const angle = Math.round(Math.atan2(y, x) / (Math.PI / 4)) * Math.PI / 4;
  const ux = Math.cos(angle), uy = Math.sin(angle), length = x * ux + y * uy;
  const point = mediaNormalizedPoint(clip, source, project, { x: origin.x + ux * length, y: origin.y + uy * length });
  return { x: point.x - .5, y: point.y - .5 };
}

const fraction = (value: number, delta: number, min: number, max: number) => delta > 0 ? (max - value) / delta : delta < 0 ? (min - value) / delta : 1;

/** Stop the entire selection at its first boundary; never squash its shape or change its direction. */
export function translateBezierPoints(points: BezierMaskPoint[], selected: readonly number[], delta: Position): BezierMaskPoint[] {
  const indices = new Set(selected);
  let amount = 1;
  for (const [index, point] of points.entries()) {
    if (!indices.has(index)) continue;
    for (const [x, y, min, max] of [[point.x, point.y, 0, 1], [point.inX, point.inY, -1, 2], [point.outX, point.outY, -1, 2]]) {
      amount = Math.min(amount, fraction(x, delta.x, min, max), fraction(y, delta.y, min, max));
    }
  }
  amount = Math.max(0, amount);
  const dx = delta.x * amount, dy = delta.y * amount;
  return points.map((point, index) => indices.has(index) ? { ...point, x: point.x + dx, y: point.y + dy, inX: point.inX + dx, inY: point.inY + dy, outX: point.outX + dx, outY: point.outY + dy } : point);
}

export function editBezierHandle(point: BezierMaskPoint, part: 'in' | 'out', vector: Position, independent: boolean): BezierMaskPoint {
  let amount = Math.min(1, fraction(point.x, vector.x, -1, 2), fraction(point.y, vector.y, -1, 2));
  if (!independent) amount = Math.min(amount, fraction(point.x, -vector.x, -1, 2), fraction(point.y, -vector.y, -1, 2));
  amount = Math.max(0, amount);
  const dx = vector.x * amount, dy = vector.y * amount;
  const handle = part === 'in' ? { inX: point.x + dx, inY: point.y + dy } : { outX: point.x + dx, outY: point.y + dy };
  const opposite = independent ? {} : part === 'in' ? { outX: point.x - dx, outY: point.y - dy } : { inX: point.x - dx, inY: point.y - dy };
  return { ...point, ...handle, ...opposite, kind: 'curve' };
}

export function newBezierPoint(position: Position): BezierMaskPoint {
  return { ...position, inX: position.x, inY: position.y, outX: position.x, outY: position.y, kind: 'line' };
}
