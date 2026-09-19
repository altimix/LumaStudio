import { describe, it, expect } from 'vitest';
import { shortcutLabel } from './shortcut-label';
describe('OS shortcut labels', () => {
  it('uses Mac modifier and delete names without changing Japanese labels', () => {
    expect(shortcutLabel('元に戻す (Ctrl+Z) / Alt+クリック / Delete', true)).toBe('元に戻す (⌘+Z) / Option+クリック / delete');
    expect(shortcutLabel('Ctrl / ⌘ と Alt / Option', true)).toBe('⌘ と Option');
    expect(shortcutLabel('Alternative・CtrlRoom・DeleteMe ロック', true)).toBe('Alternative・CtrlRoom・DeleteMe ロック');
  });
  it('uses Windows labels in explicit Windows help even on a Mac', () => {
    expect(shortcutLabel('Ctrl（Macは⌘）+Z / Ctrl / ⌘ / Alt / Option', false)).toBe('Ctrl+Z / Ctrl / Alt');
  });
});
