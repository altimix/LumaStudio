import type { Clip } from '../src/types';
export const DEFAULT_GAUSSIAN_BLUR: Readonly<NonNullable<Clip['gaussianBlur']>>;
export function hasGaussianBlur(clip: Clip | null | undefined): boolean;
export function validateGaussianBlur(clip: Clip): void;
export function gaussianBlurBounds(blur: NonNullable<Clip['gaussianBlur']>, width: number, height: number): {left:number;top:number;right:number;bottom:number;sigma:number};
export function ffmpegGaussianBlend(clip: Clip): string;
