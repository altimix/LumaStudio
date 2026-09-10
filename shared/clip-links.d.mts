import type { Asset, Clip, Project } from '../src/types';
export function sameTiming(a: Clip, b: Clip): boolean;
export function hasClipAudio(clip: Clip, asset?: Asset): boolean;
export function linkedIds(p: Project, ids: string[]): string[];
export function audioTargets(p: Project, ids: string[]): Clip[];
export function clipsLocked(p: Project, ids: string[]): boolean;
export function validateClipLinks(p: Project): void;
export function syncLinkedEdits(before: Project, next: Project, newId: () => string): Project;
export function cloneLinkedClips(clips: Clip[], newId: () => string, offset: number): Clip[];
