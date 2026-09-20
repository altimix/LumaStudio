import { describe, expect, it } from 'vitest';
import { containMonitor, fitMonitor, MAX_MONITOR_ZOOM, MIN_MONITOR_ZOOM, MONITOR_ZOOM_PRESETS, wheelMonitorScale, zoomMonitor } from './preview-viewport';

describe('program monitor viewport', () => {
  const source = { width: 1920, height: 1080 }, viewport = { width: 800, height: 500 };
  it('fits landscape and portrait frames with room for off-frame handles', () => {
    for (const size of [source, { width: 1080, height: 1920 }]) {
      const fitted = fitMonitor(size, viewport);
      expect(fitted.x).toBe(0); expect(fitted.y).toBe(0); expect(fitted.fit).toBe(true);
      expect(size.width * fitted.scale).toBeLessThanOrEqual(viewport.width - 48);
      expect(size.height * fitted.scale).toBeLessThanOrEqual(viewport.height - 48);
    }
  });
  it('keeps the source pixel under the zoom anchor fixed for every preset and repeated wheel input', () => {
    const anchor = { x: 190, y: -85 }, before = { ...fitMonitor(source, viewport), x: 70, y: -20 };
    for (const scale of [...MONITOR_ZOOM_PRESETS, wheelMonitorScale(before.scale, -25, 0, false, viewport.height)]) {
      const after = zoomMonitor(before, scale, anchor);
      expect(after.scale).toBeCloseTo(scale); expect(after.fit).toBe(false);
      expect((anchor.x - after.x) / after.scale).toBeCloseTo((anchor.x - before.x) / before.scale);
      expect((anchor.y - after.y) / after.scale).toBeCloseTo((anchor.y - before.y) / before.scale);
    }
  });
  it('bounds wheel/pinch zoom and accounts for pixel, line and page deltas', () => {
    const view = { scale: 1, x: 0, y: 0, fit: false };
    expect(zoomMonitor(view, 1e20, { x: 0, y: 0 }).scale).toBe(MAX_MONITOR_ZOOM);
    expect(zoomMonitor(view, 0, { x: 0, y: 0 }).scale).toBe(MIN_MONITOR_ZOOM);
    expect(wheelMonitorScale(1, 1, 1, false, 500)).toBe(wheelMonitorScale(1, 16, 0, false, 500));
    expect(wheelMonitorScale(1, 1, 2, false, 500)).toBe(wheelMonitorScale(1, 500, 0, false, 500));
    expect(wheelMonitorScale(1, -20, 0, true, 500)).toBeGreaterThan(1);
    expect(wheelMonitorScale(1, 20, 0, true, 500)).toBeLessThan(1);
  });
  it('keeps a visible strip of the frame when panning to either extreme', () => {
    for (const scale of [.25, 1, 2]) for (const direction of [-1, 1]) {
      const view = containMonitor({ scale, x: direction * 1e6, y: direction * 1e6, fit: false }, source, viewport);
      const left = viewport.width / 2 + view.x - source.width * scale / 2;
      const top = viewport.height / 2 + view.y - source.height * scale / 2;
      expect(left).toBeLessThanOrEqual(viewport.width - 32); expect(left + source.width * scale).toBeGreaterThanOrEqual(32);
      expect(top).toBeLessThanOrEqual(viewport.height - 32); expect(top + source.height * scale).toBeGreaterThanOrEqual(32);
    }
  });
});
