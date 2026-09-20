export type MonitorSize = { width: number; height: number };
export type MonitorView = { scale: number; x: number; y: number; fit: boolean };
export const MIN_MONITOR_ZOOM = .01;
export const MAX_MONITOR_ZOOM = 8;
export const MONITOR_ZOOM_PRESETS = [.25, .5, .75, 1, 2];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function fitMonitor(source: MonitorSize, viewport: MonitorSize): MonitorView {
  const scale = Math.max(.001, Math.min(Math.max(1, viewport.width - 48) / source.width, Math.max(1, viewport.height - 48) / source.height));
  return { scale, x: 0, y: 0, fit: true };
}
export function containMonitor(view: MonitorView, source: MonitorSize, viewport: MonitorSize): MonitorView {
  const limitX = Math.max(0, (source.width * view.scale + viewport.width) / 2 - 32);
  const limitY = Math.max(0, (source.height * view.scale + viewport.height) / 2 - 32);
  return { ...view, x: clamp(view.x, -limitX, limitX), y: clamp(view.y, -limitY, limitY) };
}
/** Anchor is measured from the viewport center, in screen CSS pixels. */
export function zoomMonitor(view: MonitorView, scale: number, anchor: { x: number; y: number }): MonitorView {
  const next = clamp(scale, MIN_MONITOR_ZOOM, MAX_MONITOR_ZOOM), ratio = next / view.scale;
  return { scale: next, x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio, fit: false };
}
export function wheelMonitorScale(scale: number, delta: number, mode: number, pinch: boolean, height: number) {
  const pixels = delta * (mode === 1 ? 16 : mode === 2 ? height : 1);
  return scale * Math.exp(clamp(-pixels * (pinch ? .01 : .002), -1, 1));
}
