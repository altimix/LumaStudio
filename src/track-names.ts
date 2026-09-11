import type { Project } from './types';

// Legacy factory defaults are migrated; other saved names remain user-owned.
const legacyDefaults = ['テロップ・オーバーレイ', 'メイン映像', 'ミュージック', 'ナレーション'];
export function numberTracks(p: Project): Project {
  const legacy = p.tracks.length === 4 && p.tracks.every((t, i) => t.autoName === undefined && t.name === legacyDefaults[i] && t.kind === (i < 2 ? 'video' : 'audio'));
  let video = p.tracks.filter(t => t.kind === 'video').length, audio = 0, changed = false;
  const tracks = p.tracks.map(t => {
    const name = t.kind === 'video' ? `Video${video--}` : `Audio${++audio}`;
    const automatic = t.autoName ?? legacy;
    if (!automatic || (t.name === name && t.autoName === true)) return t;
    changed = true; return { ...t, name, autoName: true };
  });
  return changed ? { ...p, tracks } : p;
}
