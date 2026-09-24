import type { Clip } from '../src/types';
export const DEFAULT_MOSAIC: Readonly<NonNullable<Clip['mosaic']>>;
export function hasMosaic(clip: Partial<Clip> | undefined): boolean;
export function validateMosaic(clip: Partial<Clip>): void;
export function mosaicBounds(mosaic: NonNullable<Clip['mosaic']>, width: number, height: number): {left:number;top:number;right:number;bottom:number;block:number};
export function ffmpegMosaicFilter(clip: Clip): string;
export function ffmpegMosaicRegionFilter(clip: Clip, width: number, height: number): {area:number;crop:string;sample:string;trim:string;x:number;y:number} | null;
