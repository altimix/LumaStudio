export const MAX_MEDIA_SECONDS: number;
export const MAX_MARKERS: number;
export const MAX_TIMELINE_PIXELS: number;
export function timelineLength(duration: number): number;
export function timelineZoomBounds(duration: number): { min: number; max: number };
export function boundedZoom(zoom: number, duration: number): number;
export function rulerStep(zoom: number): number;
