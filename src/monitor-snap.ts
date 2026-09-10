import type { Clip, Project } from './types';

type Size = { width: number; height: number };
type Point = { x: number; y: number };
export type SnapAnchor = 'start' | 'center' | 'end';
export type SnapGuides = { x: SnapAnchor | null; y: SnapAnchor | null };
export const NO_SNAP: SnapGuides = { x: null, y: null };

// Capture only on contact. Once captured, tolerate hand jitter on either side;
// Alt still supplies the raw position for deliberate sub-pixel placement.
const OVERSHOOT = 4;
const RELEASE_DISTANCE = 8;
function snapAxis(center: number, before: number, half: number, extent: number, pixels: number, previous: SnapAnchor | null) {
  const candidates = [
    { anchor: 'center' as const, value: extent / 2 },
    { anchor: 'start' as const, value: half },
    { anchor: 'end' as const, value: extent - half },
  ].filter(c => Math.abs((c.value / extent - .5) * 100) <= 200);
  const distance = (value: number) => Math.abs(value - center) / extent * pixels;
  const touching = (value: number) => Math.abs(center - value) <= Number.EPSILON * extent * 16;
  const eligible = (c: (typeof candidates)[number]) => {
    if (touching(c.value)) return true;
    if (distance(c.value) > OVERSHOOT) return false;
    const from = before - c.value, to = center - c.value;
    if (c.anchor === 'start') return to < 0 && (from > 0 || previous === c.anchor);
    if (c.anchor === 'end') return to > 0 && (from < 0 || previous === c.anchor);
    return from * to < 0 || (previous === c.anchor && from * to > 0);
  };
  const held = candidates.find(c => c.anchor === previous && distance(c.value) <= RELEASE_DISTANCE);
  const nearest = candidates.reduce<(typeof candidates)[number] | undefined>((best, c) =>
    eligible(c) && (!best || distance(c.value) < distance(best.value)) ? c : best, undefined);
  const match = pixels <= 0 ? undefined : held || nearest;
  return { value: Math.max(-200, Math.min(200, ((match?.value ?? center) / extent - .5) * 100)), anchor: match?.anchor ?? null };
}

/** Size is the scaled, unrotated selection box in sequence pixels. */
export function snapMonitorPosition(clip: Pick<Clip, 'x' | 'y' | 'rotation'>, size: Size, project: Pick<Project, 'width' | 'height'>,
  delta: Point, viewport: Size, previous: SnapGuides = NO_SNAP, previousDelta: Point = { x: 0, y: 0 }) {
  const angle = clip.rotation * Math.PI / 180, cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle));
  const halfWidth = (size.width * cos + size.height * sin) / 2;
  const halfHeight = (size.width * sin + size.height * cos) / 2;
  const x = snapAxis(project.width * (.5 + clip.x / 100) + delta.x, project.width * (.5 + clip.x / 100) + previousDelta.x, halfWidth, project.width, viewport.width, previous.x);
  const y = snapAxis(project.height * (.5 + clip.y / 100) + delta.y, project.height * (.5 + clip.y / 100) + previousDelta.y, halfHeight, project.height, viewport.height, previous.y);
  return { x: x.value, y: y.value, guides: { x: x.anchor, y: y.anchor } };
}

export const sameSnapGuides = (a: SnapGuides, b: SnapGuides) => a.x === b.x && a.y === b.y;
