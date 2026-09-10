import type { Clip, Project, TextBox } from '../src/types';
export function validateTextBox(c: Clip): void;
export function wrapTextBox(text: string, width: number, measure: (text: string) => number): string[];
export function textBoxLayout(c: Clip & { textBox: TextBox }, measure: (text: string) => number): { lines: string[]; lineHeight: number; padding: number; innerWidth: number; requiredHeight: number; overflow: boolean };
export function resizeTextBox(c: Clip, box: TextBox, project: Pick<Project,'width'|'height'>, handle: {x:number;y:number}, dx:number, dy:number): Pick<Clip,'x'|'y'|'textBox'>;
