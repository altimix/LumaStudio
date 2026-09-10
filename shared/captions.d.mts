import type { SubtitleCue } from '../src/types';
export function buildCaptionCues(data: unknown, offset: number, duration: number, format: (text:string)=>string): SubtitleCue[];
export function wrapCaption(text:string,width?:number):string;
