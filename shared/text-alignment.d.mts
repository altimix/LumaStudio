import type { TextAlignment } from '../src/types';
export const TEXT_ALIGNMENTS: readonly TextAlignment[];
export function textLineLayout(text: string, width: number, alignment: TextAlignment | undefined, measure: (text: string) => number, constrain?: boolean): { align: 'left' | 'center' | 'right'; runs: { text: string; x: number; maxWidth?: number }[] };
