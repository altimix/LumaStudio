// Numeric precision guard (milliseconds), not an editing duration limit.
export const MAX_MEDIA_SECONDS = Number.MAX_SAFE_INTEGER / 1000;
export const MAX_TIMELINE_PIXELS = 10_000_000;
export function timelineLength(duration) { return Math.max(30, Math.ceil((duration + 5) / 5) * 5); }
export function timelineZoomBounds(duration) {
  const max = Math.min(200, MAX_TIMELINE_PIXELS / timelineLength(duration));
  return { min: Math.min(8, 600 / Math.max(10, duration), max), max };
}
export function boundedZoom(zoom, duration) {
  const bounds = timelineZoomBounds(duration);
  return Math.max(bounds.min, Math.min(bounds.max, zoom));
}
export function rulerStep(zoom) {
  const raw = Math.max(1, 80 / zoom), power = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].find(n => n * power >= raw) * power;
}
