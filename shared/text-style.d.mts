import type { Clip } from '../src/types';
export const DEFAULT_FONT: string;
export const fonts: { family: string; label: string; weights: number[]; variable: boolean }[];
export function fontEntry(family: string): typeof fonts[number] | undefined;
export function fontStyle(c: Clip): { family: string; weight: number };
export function validateTextStyle(c: Clip): void;
