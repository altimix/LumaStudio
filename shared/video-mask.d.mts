import type { Clip, Crop, VideoMask } from '../src/types';
export const EMPTY_CROP: Readonly<Crop>;
export const DEFAULT_VIDEO_MASK: Readonly<VideoMask>;
export function effectiveCrop(clip: Partial<Clip> | undefined): Readonly<Crop>;
export function hasCrop(clip: Partial<Clip> | undefined): boolean;
export function hasVideoMask(clip: Partial<Clip> | undefined): boolean;
export function validateVideoMask(clip: Partial<Clip> | undefined): void;
export function maskAlphaAt(clip: Partial<Clip> | undefined, u: number, v: number): number;
export function ffmpegMaskExpression(clip: Partial<Clip> | undefined): string;
