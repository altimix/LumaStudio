import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, fitLayout, LAYOUT_LIMITS, parseLayout } from './layout-preferences';

describe('workspace layout preferences', () => {
  it('rejects corrupt or unsupported settings and validates fields independently', () => {
    for (const raw of [null, '{broken', 'null', '[]', '42', '{"version":2,"libraryWidth":400}']) expect(parseLayout(raw)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout(JSON.stringify({ version: 1, libraryWidth: -50, inspectorWidth: '500', timelineHeight: 999999, libraryCollapsed: true, inspectorCollapsed: 'true' }))).toEqual({
      ...DEFAULT_LAYOUT, libraryWidth: 248, timelineHeight: 1200, libraryCollapsed: true,
    });
    expect(parseLayout('{"version":1,"libraryWidth":1e999,"inspectorWidth":344.4}')).toEqual({ ...DEFAULT_LAYOUT, inspectorWidth: 344 });
  });
  it('fits both panels and the timeline while retaining the preferred sizes', () => {
    const preferences = { ...DEFAULT_LAYOUT, libraryWidth: 520, inspectorWidth: 520, timelineHeight: 700 };
    const saved = { ...preferences };
    for (const width of [1050, 1100, 1280, 1600, 2560]) {
      for (const libraryCollapsed of [false, true]) for (const inspectorCollapsed of [false, true]) {
        const view = fitLayout({ ...preferences, libraryCollapsed, inspectorCollapsed }, width, 550);
        expect(view.libraryWidth + view.inspectorWidth + LAYOUT_LIMITS.padding + 2 * LAYOUT_LIMITS.separator + LAYOUT_LIMITS.preview).toBeLessThanOrEqual(width);
        expect(view.libraryWidth).toBeGreaterThanOrEqual(libraryCollapsed ? LAYOUT_LIMITS.rail : LAYOUT_LIMITS.library.min);
        expect(view.inspectorWidth).toBeGreaterThanOrEqual(inspectorCollapsed ? LAYOUT_LIMITS.rail : LAYOUT_LIMITS.inspector.min);
        expect(view.timelineHeight).toBe(262);
      }
    }
    expect(preferences).toEqual(saved);
    expect(fitLayout(preferences, 2560, 1100)).toMatchObject({ libraryWidth: 520, inspectorWidth: 520, timelineHeight: 700 });
  });
  it('keeps the resized edge exact without changing the opposite preference', () => {
    const preferences = { ...DEFAULT_LAYOUT, libraryWidth: 300, inspectorWidth: 520, lastResizedPanel: 'library' as const };
    expect(fitLayout(preferences, 1100, 800)).toMatchObject({ libraryWidth: 300, inspectorWidth: 372 });
    expect(fitLayout(preferences, 1600, 800)).toMatchObject({ libraryWidth: 300, inspectorWidth: 520 });
    const opposite = { ...preferences, libraryWidth: 520, inspectorWidth: 310, lastResizedPanel: 'inspector' as const };
    expect(fitLayout(opposite, 1100, 800)).toMatchObject({ libraryWidth: 362, inspectorWidth: 310 });
    expect(fitLayout(opposite, 1600, 800)).toMatchObject({ libraryWidth: 520, inspectorWidth: 310 });
    expect(parseLayout(JSON.stringify(opposite))).toEqual(opposite);
  });
});
