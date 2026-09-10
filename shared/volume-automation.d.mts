import type { Clip, VolumeKeyframe } from '../src/types';
export const MAX_VOLUME_KEYFRAMES: number;
export function volumeAt(keys: readonly VolumeKeyframe[] | undefined, time: number): number;
export function windowVolume(keys: VolumeKeyframe[] | undefined, offset: number, duration: number): VolumeKeyframe[] | undefined;
export function retimeVolume(clip: Clip, next: Pick<Clip, 'in' | 'speed' | 'duration'>): VolumeKeyframe[] | undefined;
export function validateVolumeKeys(clip: Pick<Clip, 'kind' | 'duration' | 'audioDetached' | 'volumeKeyframes'>): void;
export function volumeExpression(keys: readonly VolumeKeyframe[] | undefined, offset?: number): string;
