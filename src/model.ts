import type { Asset, Clip, Project, Track } from './types';
import { windowOpacity } from '../shared/opacity.mjs';
import { retimeVolume, windowVolume } from '../shared/volume-automation.mjs';
import { MAX_MEDIA_SECONDS } from '../shared/time.mjs';
import { captionBottomY } from './caption-style';
import { maxTransitionDuration, validateTransitions } from '../shared/transitions.mjs';
export const uid = () => crypto.randomUUID();
export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
export const roundFrame = (v: number, fps: number) => Math.round(v * fps) / fps;
export const endTime = (p: Project) => Math.max(0, ...p.clips.map(c => c.start + c.duration));
export function timecode(seconds: number, fps = 30) {
  const frames = Math.max(0, Math.round(seconds * fps)); const sec = Math.floor(frames / fps);
  return [Math.floor(sec / 3600), Math.floor(sec / 60) % 60, sec % 60, frames % fps].map(n => String(n).padStart(2, '0')).join(':');
}
export function shortTime(seconds: number) { return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`; }
export function makeTrack(kind: Track['kind'], name: string): Track { return { id: uid(), name, kind, muted: false, hidden: false, locked: false, solo: false }; }
export function emptyProject(): Project {
  return { version: 1, id: uid(), name: '新しいプロジェクト', width: 1920, height: 1080, fps: 30, assets: [], clips: [], markers: [], tracks: [makeTrack('video', 'テロップ・オーバーレイ'), makeTrack('video', 'メイン映像'), makeTrack('audio', 'ミュージック'), makeTrack('audio', 'ナレーション')] };
}
export function makeClip(trackId: string, start: number, asset?: Asset): Clip {
  return { id: uid(), assetId: asset?.id, trackId, start, in: 0, duration: asset?.duration ?? 5, speed: 1,
    kind: asset?.kind || 'title', name: asset?.name || '新しいテロップ', x: 0, y: 0, scale: 1, rotation: 0, opacity: 1,
    exposure: 0, contrast: 1, saturation: 1, volume: 1, fadeIn: 0, fadeOut: 0, text: '物語は、ここから。', fontSize: 94, color: '#ffffff', textStyle: 'hero', fontFamily: 'Noto Sans JP', fontWeight: 700, textShadow: false, shadowColor: '#000000', shadowBlur: 12, shadowDistance: 4, textStroke: true, strokeColor: '#0064ff', strokeWidth: 4 };
}
export function demoProject(assets: Asset[]): Project {
  if (assets.some(a => a.name === 'movie05.mp4')) return openingProject(assets);
  const p = emptyProject(); p.name = 'Sintel — A new beginning'; p.assets = assets;
  const videos = assets.filter(a => a.kind === 'video').reverse();
  videos.forEach((a, i) => p.clips.push({ ...makeClip(p.tracks[1].id, i * 8, a), duration: Math.min(8, a.duration), volume: 0.7, fadeIn: i === 0 ? 0.6 : 0, fadeOut: i === 2 ? 0.8 : 0 }));
  if (videos.length) p.clips.push({ ...makeClip(p.tracks[0].id, 1.2), name: 'A NEW BEGINNING', duration: 5.6, text: 'A NEW\nBEGINNING', textStyle: 'hero', fontSize: 122, fadeIn: 0.5, fadeOut: 0.5, y: 7 });
  const music = assets.find(a => a.kind === 'audio');
  if (music) p.clips.push({ ...makeClip(p.tracks[2].id, 0, music), duration: Math.min(24, music.duration), volume: 0.38, fadeIn: 1, fadeOut: 2 });
  p.markers = [{ id: uid(), time: 0, label: 'INTRO' }, { id: uid(), time: 8, label: 'ENCOUNTER' }, { id: uid(), time: 16, label: 'BEYOND' }];
  return p;
}
/** Keep the complete source interval in the personal opening sequence. */
export function openingProject(assets: Asset[]): Project {
  const p = emptyProject(); p.name = '英雄が残したもの'; p.assets = assets;
  const video = assets.find(a => a.kind === 'video' && a.name === 'movie05.mp4');
  if (!video) return p;
  p.width = 1080; p.height = 1920;
  const duration = Math.floor(video.duration * p.fps + 1e-7) / p.fps;
  const main = { ...makeClip(p.tracks[1].id, 0, video), duration };
  if (video.hasAudio) {
    const track = makeTrack('audio', 'メイン音声'); p.tracks.splice(2, 0, track);
    const linkId = uid();
    p.clips.push({ ...main, audioDetached: true, linkId });
    p.clips.push({ ...makeClip(track.id, 0, video), kind: 'audio', name: video.name + '（音声）', duration, linkId });
  } else p.clips.push(main);
  const titleDuration = Math.min(5, duration);
  p.clips.push({ ...makeClip(p.tracks[0].id, 0), name: p.name, text: p.name, textStyle: 'minimal', fontSize: 76, duration: titleDuration, fadeIn: Math.min(.4, titleDuration / 2), fadeOut: Math.min(.5, titleDuration / 2) });
  const music = assets.find(a => a.kind === 'audio' && a.name === '英雄の奪っていったもの.mp3');
  if (music) {
    const length = Math.min(duration, Math.floor(music.duration * p.fps) / p.fps);
    p.clips.push({ ...makeClip(p.tracks.find(t => t.name === 'ミュージック')!.id, 0, music), duration: length, volume: .1, fadeIn: Math.min(1, length / 3), fadeOut: Math.min(2, length / 3) });
  }
  return p;
}
export function normalizeClip(c: Clip, p: Project): Clip {
  const asset = p.assets.find(a => a.id === c.assetId);
  const speed = clamp(c.speed, 0.25, 4);
  const min = 1 / p.fps;
  const inPoint = asset && asset.kind !== 'image' ? clamp(c.in, 0, Math.max(0, asset.duration - min * speed)) : 0;
  const maxDuration = asset && asset.kind !== 'image' ? Math.max(min, Math.floor((asset.duration - inPoint) / speed * p.fps + 0.00001) / p.fps) : MAX_MEDIA_SECONDS;
  const duration = clamp(roundFrame(c.duration, p.fps), min, maxDuration);
  const fadeIn = clamp(c.fadeIn, 0, duration); const fadeOut = clamp(c.fadeOut, 0, duration - fadeIn);
  const opacityKeyframes = c.kind === 'title' && duration !== c.duration ? windowOpacity(c.opacityKeyframes, 0, duration) : c.opacityKeyframes;
  const volumeKeyframes = retimeVolume(c, { in: inPoint, duration, speed });
  return { ...c, start: Math.max(0, roundFrame(c.start, p.fps)), in: inPoint, duration, speed, fadeIn, fadeOut, ...(opacityKeyframes ? { opacityKeyframes } : {}), ...(volumeKeyframes ? { volumeKeyframes } : {}) };
}
export function applySequenceSettings(p: Project, settings: Pick<Project, 'name' | 'width' | 'height' | 'fps'>): Project {
  const changingFps = settings.fps !== p.fps;
  if (changingFps && p.clips.some(c => p.tracks.find(t => t.id === c.trackId)?.locked)) {
    throw new Error('FPSを変更するには、クリップのあるトラックのロックを解除してください。');
  }
  const next = { ...p, ...settings, name: settings.name.trim() || '新しいプロジェクト' };
  let clips=changingFps ? p.clips.map(c => normalizeClip(c, next)) : p.clips;
  if(changingFps&&p.transitions?.some(t=>t.mode==='fixed')){
    const current=new Map(clips.map(c=>[c.id,c]));
    const patchTiming=(clip:Clip,patch:Partial<Clip>)=>{
      for(const c of current.values())if(c.id===clip.id||(clip.linkId&&c.linkId===clip.linkId))current.set(c.id,normalizeClip({...c,...patch},next));
    };
    const joins=p.transitions.filter(t=>t.mode==='fixed').sort((a,b)=>(current.get(a.toId)?.start||0)-(current.get(b.toId)?.start||0));
    for(const join of joins){
      const from=current.get(join.fromId),to=current.get(join.toId);if(!from||!to)continue;
      // Prefer keeping the rounded cut in place. If the outgoing source cannot
      // reach that frame, align the incoming start to its last usable frame.
      const desired=roundFrame(to.start-from.start,next.fps),fitted=normalizeClip({...from,duration:desired},next);
      if(desired>=1/next.fps-1e-7&&Math.abs(fitted.duration-desired)<1e-7)patchTiming(from,{duration:desired});
      else patchTiming(to,{start:from.start+from.duration});
    }
    clips=clips.map(c=>current.get(c.id)!);
    next.transitions=p.transitions.map(t=>{
      if(t.mode!=='fixed')return t;const from=current.get(t.fromId),to=current.get(t.toId);if(!from||!to)return t;
      return {...t,duration:Math.max(1/next.fps,Math.min(maxTransitionDuration(from,to,next.fps),roundFrame(t.duration!,next.fps)))};
    });
    try{validateTransitions({...next,clips});}catch{throw new Error('このFPSではつなぎ目の接続を保持できません。クリップの長さを調整するか、別のFPSを選んでください。');}
  }
  const reposition=(settings.width!==p.width||settings.height!==p.height)&&clips.some(c=>c.captionAutoPosition&&!p.tracks.find(t=>t.id===c.trackId)?.locked);
  return { ...next, clips: reposition ? clips.map(c=>c.captionAutoPosition&&!p.tracks.find(t=>t.id===c.trackId)?.locked?{...c,y:captionBottomY(next,c.text,c.fontSize)}:c) : clips };
}
export function splitClip(c: Clip, at: number, fps: number): [Clip, Clip] | null {
  const left = roundFrame(at - c.start, fps); const right = c.duration - left;
  if (left < 1 / fps - 0.000001 || right < 1 / fps - 0.000001) return null;
  return [
    { ...c, duration: left, fadeIn: Math.min(c.fadeIn, left), fadeOut: 0, ...(c.opacityKeyframes ? { opacityKeyframes: windowOpacity(c.opacityKeyframes, 0, left) } : {}), ...(c.volumeKeyframes ? { volumeKeyframes: windowVolume(c.volumeKeyframes, 0, left) } : {}) },
    { ...c, id: uid(), start: c.start + left, in: c.kind === 'title' || c.kind === 'image' ? 0 : c.in + left * c.speed, duration: right, fadeIn: 0, fadeOut: Math.min(c.fadeOut, right), ...(c.opacityKeyframes ? { opacityKeyframes: windowOpacity(c.opacityKeyframes, left, right) } : {}), ...(c.volumeKeyframes ? { volumeKeyframes: windowVolume(c.volumeKeyframes, left, right) } : {}) }
  ];
}
export function trimClip(c: Clip, edge: 'left' | 'right', delta: number, p: Project): Clip {
  const min = 1 / p.fps; delta = roundFrame(delta, p.fps);
  if (edge === 'right') {
    const next = normalizeClip({ ...c, duration: c.duration + delta }, p);
    return { ...next, ...(c.opacityKeyframes ? { opacityKeyframes: windowOpacity(c.opacityKeyframes, 0, next.duration) } : {}), ...(c.volumeKeyframes ? { volumeKeyframes: retimeVolume(c, next) } : {}) };
  }
  const sourceLimited = c.kind !== 'title' && c.kind !== 'image';
  delta = clamp(delta, Math.max(-c.start, sourceLimited ? -c.in / c.speed : -c.start), c.duration - min);
  const next = normalizeClip({ ...c, start: c.start + delta, in: sourceLimited ? c.in + delta * c.speed : 0, duration: c.duration - delta }, p);
  return { ...next, ...(c.opacityKeyframes ? { opacityKeyframes: windowOpacity(c.opacityKeyframes, next.start - c.start, next.duration) } : {}), ...(c.volumeKeyframes ? { volumeKeyframes: retimeVolume(c, next) } : {}) };
}
/** Stretch the same source interval to a new sequence length; keep the other edge fixed. */
export function rateStretchClip(c: Clip, edge: 'left' | 'right', delta: number, p: Project): Clip {
  if (!Number.isFinite(delta) || !['video', 'audio'].includes(c.kind) || p.tracks.find(t => t.id === c.trackId)?.locked) return c;
  const span = c.duration * c.speed, end = c.start + c.duration;
  const min = Math.max(1, Math.ceil(span / 4 * p.fps - 1e-7)) / p.fps;
  const max = Math.min(Math.floor(span / 0.25 * p.fps + 1e-7) / p.fps, edge === 'left' ? end : MAX_MEDIA_SECONDS - c.start);
  if (max < min) return c;
  const duration = clamp(roundFrame(c.duration + (edge === 'right' ? delta : -delta), p.fps), min, max);
  if (duration === c.duration) return c;
  const ratio = duration / c.duration;
  return { ...c, start: edge === 'left' ? roundFrame(end - duration, p.fps) : c.start, duration, speed: Math.min(4,Math.max(.25,span / duration)), fadeIn: Math.min(duration,c.fadeIn * ratio), fadeOut: Math.min(Math.max(0,duration-Math.min(duration,c.fadeIn * ratio)),c.fadeOut * ratio), ...(c.volumeKeyframes ? { volumeKeyframes: c.volumeKeyframes.map(key => ({...key,time:Math.min(duration,key.time*ratio)})) } : {}) };
}
export function snapTime(time: number, p: Project, excludeIds: string[], threshold: number, playhead: number): number {
  const points = [0, playhead, ...p.markers.map(m => m.time), ...p.clips.filter(c => !excludeIds.includes(c.id)).flatMap(c => [c.start, c.start + c.duration])];
  let closest = time; let distance = threshold;
  for (const point of points) if (Math.abs(point - time) < distance) { closest = point; distance = Math.abs(point - time); }
  return Math.max(0, roundFrame(closest, p.fps));
}

/** Remove a sequence interval on every track, preserving source time and title curves. */
export function rippleTrim(p: Project, playhead: number, direction: 'previous' | 'next'): { project: Project; playhead: number } | null {
  const at = roundFrame(playhead, p.fps); const total = endTime(p); const epsilon = 0.000001;
  if (!p.clips.length || at < 0 || at > total + epsilon) return null;
  const edits = [0, total, ...p.clips.flatMap(c => [c.start, c.start + c.duration])].map(t => roundFrame(t, p.fps));
  const previous = Math.max(0, ...edits.filter(t => t < at - epsilon));
  const next = Math.min(total, ...edits.filter(t => t > at + epsilon));
  const from = direction === 'previous' ? previous : at; const to = direction === 'next' ? next : at;
  const amount = roundFrame(to - from, p.fps);
  if (amount < 1 / p.fps - epsilon) return null;
  if (p.clips.some(c => c.start + c.duration > from + epsilon && p.tracks.find(t => t.id === c.trackId)?.locked)) {
    throw new Error('リップルトリミングで動く素材があります。該当トラックのロックを解除してください。');
  }
  const clips = p.clips.flatMap(c => {
    const end = c.start + c.duration;
    if (end <= from + epsilon) return [c];
    if (c.start >= to - epsilon) return [{ ...c, start: roundFrame(c.start - amount, p.fps) }];
    const kept: Clip[] = [];
    if (from - c.start >= 1 / p.fps - epsilon) kept.push(trimClip({ ...c, fadeOut: 0 }, 'right', from - end, p));
    if (end - to >= 1 / p.fps - epsilon) {
      const right = trimClip({ ...c, fadeIn: 0 }, 'left', to - c.start, p);
      kept.push({ ...right, id: kept.length ? uid() : c.id, start: roundFrame(right.start - amount, p.fps) });
    }
    return kept;
  });
  if (clips.length > 2000) throw new Error('クリップは最大2000個です。先に不要なクリップを削除してください。');
  const markers = p.markers.map(m => ({ ...m, time: m.time < from ? m.time : roundFrame(Math.max(from, m.time - amount), p.fps) }));
  return { project: { ...p, clips, markers }, playhead: from };
}
