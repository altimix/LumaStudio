export const MAX_SUBTITLE_CUES: number;
import type { Project, SubtitleCue, YoutubeData, Chapter } from '../src/types';
export function timelineKey(p: Project): string;
export function chapterTime(seconds: number): string;
export function subtitleTime(seconds: number, vtt?: boolean): string;
export function wrapJapanese(text: string, width?: number): string;
export function cuesFromTranscription(data: unknown, offset: number, duration: number, width?: number): SubtitleCue[];
export function validateCues(cues: SubtitleCue[]): SubtitleCue[];
export function subtitleFile(cues: SubtitleCue[], format?: 'srt' | 'vtt'): string;
export function validateYoutube(y?: YoutubeData): void;
export function validChapters(chapters: Chapter[], duration: number): boolean;
export function descriptionWithChapters(y: YoutubeData, duration: number): string;
export function parseHashtags(value: string): string[];
export function youtubeText(y: YoutubeData, duration: number): string;

export function validateYoutubeProject(project: import("../src/types").Project): void;
