import { useCallback, useEffect, useRef, useState } from 'react';

export const LAYOUT_STORAGE_KEY = 'luma.workspace-layout.v1';
export const LAYOUT_LIMITS = {
  library: { min: 248, max: 520 },
  inspector: { min: 264, max: 520 },
  timeline: { min: 238, max: 1200 },
  rail: 36, separator: 8, preview: 400, workspace: 280, padding: 12,
} as const;
export type LayoutPreferences = {
  version: 1;
  libraryWidth: number;
  inspectorWidth: number;
  timelineHeight: number;
  libraryCollapsed: boolean;
  inspectorCollapsed: boolean;
};
export const DEFAULT_LAYOUT: LayoutPreferences = {
  version: 1, libraryWidth: 288, inspectorWidth: 286, timelineHeight: 354,
  libraryCollapsed: false, inspectorCollapsed: false,
};
export const clampSize = (value: number, min: number, max: number) => Math.round(Math.max(min, Math.min(max, value)));

export function parseLayout(raw: string | null): LayoutPreferences {
  try {
    const data: unknown = raw ? JSON.parse(raw) : null;
    if (!data || typeof data !== 'object' || !('version' in data) || data.version !== 1) return { ...DEFAULT_LAYOUT };
    const saved = data as Record<string, unknown>;
    const size = (key: 'libraryWidth' | 'inspectorWidth' | 'timelineHeight', range: { min: number; max: number }) =>
      typeof saved[key] === 'number' && Number.isFinite(saved[key]) ? clampSize(saved[key], range.min, range.max) : DEFAULT_LAYOUT[key];
    return {
      version: 1,
      libraryWidth: size('libraryWidth', LAYOUT_LIMITS.library),
      inspectorWidth: size('inspectorWidth', LAYOUT_LIMITS.inspector),
      timelineHeight: size('timelineHeight', LAYOUT_LIMITS.timeline),
      libraryCollapsed: saved.libraryCollapsed === true,
      inspectorCollapsed: saved.inspectorCollapsed === true,
    };
  } catch { return { ...DEFAULT_LAYOUT }; }
}

/** Fit the view, retaining the user's preferred sizes for a larger window. */
export function fitLayout(preferences: LayoutPreferences, width: number, height: number) {
  const limits = LAYOUT_LIMITS;
  const libraryMin = preferences.libraryCollapsed ? limits.rail : limits.library.min;
  const inspectorMin = preferences.inspectorCollapsed ? limits.rail : limits.inspector.min;
  const budget = Math.max(libraryMin + inspectorMin, width - limits.padding - 2 * limits.separator - limits.preview);
  const libraryExtra = preferences.libraryCollapsed ? 0 : Math.max(0, preferences.libraryWidth - libraryMin);
  const inspectorExtra = preferences.inspectorCollapsed ? 0 : Math.max(0, preferences.inspectorWidth - inspectorMin);
  const extra = libraryExtra + inspectorExtra;
  const ratio = extra ? Math.min(1, (budget - libraryMin - inspectorMin) / extra) : 1;
  const libraryWidth = libraryMin + Math.floor(libraryExtra * ratio);
  const inspectorWidth = inspectorMin + Math.floor(inspectorExtra * ratio);
  const timelineMax = Math.max(limits.timeline.min, Math.min(limits.timeline.max, height - limits.workspace - limits.separator));
  return {
    libraryWidth, inspectorWidth,
    libraryMax: Math.max(limits.library.min, Math.min(limits.library.max, budget - inspectorWidth)),
    inspectorMax: Math.max(limits.inspector.min, Math.min(limits.inspector.max, budget - libraryWidth)),
    timelineHeight: clampSize(preferences.timelineHeight, limits.timeline.min, timelineMax), timelineMax,
  };
}

export function useLayoutPreferences() {
  const [preferences, setPreferences] = useState<LayoutPreferences>(() => {
    try { return parseLayout(window.localStorage.getItem(LAYOUT_STORAGE_KEY)); }
    catch { return { ...DEFAULT_LAYOUT }; }
  });
  const latest = useRef(preferences);
  latest.current = preferences;
  const persist = useCallback(() => {
    try { window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(latest.current)); }
    catch { /* Layout remains usable when browser storage is unavailable. */ }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(persist, 150);
    return () => window.clearTimeout(timer);
  }, [preferences, persist]);
  useEffect(() => {
    window.addEventListener('pagehide', persist);
    return () => { window.removeEventListener('pagehide', persist); persist(); };
  }, [persist]);
  const resetLayout = () => setPreferences({ ...DEFAULT_LAYOUT });
  return { preferences, setPreferences, resetLayout };
}
