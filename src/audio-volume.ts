import type { Project } from './types';
import { audioTargets, clipsLocked } from '../shared/clip-links.mjs';

export const BGM_VOLUME_PRESETS = [
  { db: -20, volume: 10 ** (-20 / 20), label: '−20 dB（10%）' },
  { db: -15, volume: 10 ** (-15 / 20), label: '−15 dB（約17.8%）' },
] as const;

export const DEFAULT_BGM_VOLUME = BGM_VOLUME_PRESETS[0].volume;

export function applyBgmVolume(p: Project, ids: string[], db: number): Project {
  const preset = BGM_VOLUME_PRESETS.find(value => value.db === db);
  if (!preset) throw new Error('BGMの音量は−20 dBまたは−15 dBを選択してください。');
  const targets = audioTargets(p, ids);
  if (!targets.length) throw new Error('音声のあるクリップを選択してください。');
  if (clipsLocked(p, targets.map(c => c.id))) throw new Error('音声トラックのロックを解除してください。');
  const changed = new Set(targets.filter(c => c.volume !== preset.volume).map(c => c.id));
  if (!changed.size) return p;
  return { ...p, clips: p.clips.map(c => changed.has(c.id) ? { ...c, volume: preset.volume } : c) };
}
