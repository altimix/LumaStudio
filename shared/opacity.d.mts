export interface OpacityKeyframe { time: number; value: number }
export const MAX_OPACITY_KEYFRAMES: number;
export function opacityAt(keys: readonly OpacityKeyframe[] | undefined, time: number, fallback?: number): number;
export function windowOpacity(keys: OpacityKeyframe[] | undefined, offset: number, duration: number): OpacityKeyframe[] | undefined;
export function validateOpacityKeys(clip: { kind: string; duration: number; opacityKeyframes?: OpacityKeyframe[] }): void;
export function opacityExpression(keys: readonly OpacityKeyframe[] | undefined, fallback?: number): string;
