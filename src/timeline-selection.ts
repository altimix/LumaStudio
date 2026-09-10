export interface SelectionPoint { x: number; y: number }
export interface SelectionRect { left: number; top: number; width: number; height: number }
export interface SelectionCandidate extends SelectionRect { id: string; locked: boolean }

export function selectionRect(a: SelectionPoint, b: SelectionPoint): SelectionRect {
  return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export function clipsInSelection(rect: SelectionRect, candidates: SelectionCandidate[], previous: string[] = []): string[] {
  const ids = new Set(previous);
  for (const clip of candidates) {
    if (!clip.locked && clip.left <= rect.left + rect.width && clip.left + clip.width >= rect.left &&
      clip.top <= rect.top + rect.height && clip.top + clip.height >= rect.top) ids.add(clip.id);
  }
  return [...ids];
}

export function selectionScrollSpeed(position: number, start: number, end: number): number {
  const edge = Math.min(32, (end - start) / 4);
  if (edge <= 0) return 0;
  const strength = position < start + edge ? (position - start - edge) / edge : position > end - edge ? (position - end + edge) / edge : 0;
  return Math.max(-1, Math.min(1, strength)) * 900;
}
