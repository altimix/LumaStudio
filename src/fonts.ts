import type { Clip, Project } from './types';
import { DEFAULT_FONT, fontEntry, fontStyle } from '../shared/text-style.mjs';
import './fonts.css';
const loaded = new Set<string>(), pending = new Map<string, Promise<void>>();
let revision = 0;
const fontKey = (family: string, weight: number) => `${family}:${fontEntry(family)?.variable ? 'variable' : weight}`;
export const fontRevision = () => revision;
export function isFontReady(c: Clip) { if(c.graphic)return true; const f = fontStyle(c); return loaded.has(fontKey(f.family, f.weight)); }
export async function ensureFont(family: string, weight: number) {
  const entry = fontEntry(family); if (!entry) throw new Error('日本語フォントを選び直してください。');
  const key = fontKey(family, weight); if (loaded.has(key)) return;
  let task = pending.get(key);
  if (!task) {
    task = (async () => {
      if (family === DEFAULT_FONT) {
        const faces = await document.fonts.load(`${weight} 32px "${DEFAULT_FONT}"`, '日本語');
        if (!faces.length) throw new Error('同梱フォントを読み込めませんでした。アプリを再起動してください。');
      } else {
        if (!window.luma) throw new Error('日本語フォントの追加はデスクトップ版で利用できます。');
        const data = await window.luma.loadFont(family, weight);
        const face = new FontFace(family, `url("${data.url}")`, { weight: data.weight, style: 'normal' });
        await face.load(); document.fonts.add(face);
      }
      loaded.add(key); revision++;
    })().finally(() => pending.delete(key)); pending.set(key, task);
  }
  return task;
}
export function ensureProjectFonts(p: Project) {
  const required = new Map(p.clips.filter(c => c.kind === 'title' && !c.graphic && !p.tracks.find(t => t.id === c.trackId)?.hidden).map(c => { const f = fontStyle(c); return [fontKey(f.family, f.weight), f]; }));
  return Promise.all([...required.values()].map(f => ensureFont(f.family, f.weight)));
}
