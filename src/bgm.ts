import type { Asset, Project } from './types';
import { makeClip, makeTrack, normalizeClip, roundFrame } from './model';
import { MAX_MEDIA_SECONDS } from '../shared/time.mjs';

export function insertBgm(p: Project, asset: Asset, at: number, fit: boolean, volume: number) {
  if (asset.kind !== 'audio' || asset.offline || !Number.isFinite(asset.duration) || asset.duration <= 0) throw new Error('再生できる音楽を選択してください。');
  if (!Number.isFinite(at) || at < 0 || at >= MAX_MEDIA_SECONDS || !Number.isFinite(volume) || volume < 0 || volume > 1) throw new Error('挿入位置と音量を確認してください。');
  const start = roundFrame(at, p.fps), frames = Math.floor(asset.duration * p.fps + 1e-7);
  if (frames < 1) throw new Error('この音楽は1フレームより短いため追加できません。');
  const visualEnd = Math.max(0, ...p.clips.filter(c => c.kind !== 'audio').map(c => c.start + c.duration));
  const totalFrames = fit && visualEnd > start ? Math.round((visualEnd-start)*p.fps) : frames;
  const end = start + totalFrames / p.fps, count = Math.ceil(totalFrames/frames);
  if (end > MAX_MEDIA_SECONDS || count < 1 || p.clips.length + count > 2000) throw new Error('繰り返しを含めてクリップは最大2000個です。追加する範囲を短くしてください。');
  const existing = p.assets.find(a => a.id === asset.id);
  if (!existing && p.assets.length >= 2000) throw new Error('素材は最大2000個です。不要な素材を削除してください。');
  let tracks = p.tracks;
  let track = tracks.find(t => t.kind === 'audio' && /^(BGM|ミュージック)(\s|$)/i.test(t.name) && !t.locked && !t.muted && !t.hidden && !p.clips.some(c => c.trackId === t.id && c.start < end-1e-7 && c.start+c.duration > start+1e-7));
  if (!track) { if (tracks.length >= 24) throw new Error('BGMを置く空きトラックがありません。音楽トラックの空き区間を選ぶか、トラックを減らしてください。'); track = makeTrack('audio','BGM'); tracks = [...tracks,track]; }
  const assets = existing?.offline ? p.assets.map(a => a.id === asset.id ? asset : a) : existing ? p.assets : [...p.assets,asset], base = {...p,tracks,assets};
  const added = Array.from({length:count},(_,i) => {
    const duration = Math.min(frames,totalFrames-i*frames)/p.fps;
    return normalizeClip({...makeClip(track.id,start+i*frames/p.fps,asset),duration,volume,fadeIn:i===0?Math.min(.5,duration/3):0,fadeOut:i===count-1?Math.min(1,duration/3):0},base);
  });
  return { project:{...base,clips:[...p.clips,...added]}, ids:added.map(c=>c.id), repeats:count };
}
