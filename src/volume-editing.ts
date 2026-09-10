import { MAX_VOLUME_KEYFRAMES, volumeAt, validateVolumeKeys } from '../shared/volume-automation.mjs';
import { clamp, roundFrame } from './model';
import type { Clip, VolumeKeyframe } from './types';

export function addVolumePoint(clip: Clip, time: number, fps: number): VolumeKeyframe[] {
  time = clamp(roundFrame(time, fps), 0, clip.duration);
  const keys = clip.volumeKeyframes?.length ? clip.volumeKeyframes : [{ time: 0, value: 1 }, { time: clip.duration, value: 1 }];
  if (keys.some(key => Math.abs(key.time - time) < 1e-7)) return keys;
  if (keys.length >= MAX_VOLUME_KEYFRAMES) throw new Error('音量ポイントは最大64個です。不要な点を削除してください。');
  const next = [...keys, { time, value: volumeAt(keys, time) }].sort((a, b) => a.time - b.time);
  validateVolumeKeys({ ...clip, volumeKeyframes: next });
  return next;
}

export function moveVolumePoint(clip: Clip, index: number, time: number, value: number, fps: number): VolumeKeyframe[] {
  const keys = clip.volumeKeyframes || [], key = keys[index];
  if (!key || !Number.isFinite(time) || !Number.isFinite(value)) return keys;
  const low = index ? keys[index-1].time + 1e-7 : 0, high = index+1 < keys.length ? keys[index+1].time - 1e-7 : clip.duration;
  time = low <= high ? clamp(roundFrame(time, fps), low, high) : key.time;
  value = clamp(value, 0, 2);
  if (key.time === time && key.value === value) return keys;
  const next = keys.map((k, i) => i === index ? { time, value } : k);
  validateVolumeKeys({ ...clip, volumeKeyframes: next });
  return next;
}

export function volumeLabel(base: number, value: number): string {
  const gain = base * value;
  return `${Math.round(gain * 100)}% · ${gain > 0 ? (20 * Math.log10(gain)).toFixed(1) + ' dB' : '無音'}`;
}

/** Display/edit absolute gain, retaining the existing base × envelope file format. */
export function effectiveKeys(clip: Clip): VolumeKeyframe[] {
  const keys = clip.volumeKeyframes || [];
  const result = keys.map(k => ({ ...k, value: k.value * clip.volume }));
  if (!result.length || result[0].time > 0) result.unshift({ time: 0, value: clip.volume * volumeAt(keys, 0) });
  if (result.at(-1)!.time < clip.duration) result.push({ time: clip.duration, value: clip.volume * volumeAt(keys, clip.duration) });
  return result;
}

function storedEffectiveKeys(clip:Clip) { return clip.volumeKeyframes?.length?clip.volumeKeyframes.map(k=>({...k,value:k.value*clip.volume})):effectiveKeys(clip); }

export function encodeEffectiveKeys(keys: VolumeKeyframe[], base: number): Pick<Clip, 'volume' | 'volumeKeyframes'> {
  if(keys.length > MAX_VOLUME_KEYFRAMES) throw Error('音量ポイントは最大64個です。不要な点を削除してください。');
  const volume = Math.max(base, ...keys.map(k => k.value / 2));
  return { volume, volumeKeyframes: keys.map(k => ({ ...k, value: volume > 0 ? k.value / volume : 0 })) };
}

export function setEffectiveVolume(clip: Clip, time: number, gain: number, fps: number, selectedPoint = false): Partial<Clip> {
  if(!Number.isFinite(gain)) return {};
  gain=clamp(gain,0,clip.volumeKeyframes?.length||selectedPoint?4:2);
  if(!clip.volumeKeyframes?.length&&!selectedPoint) return {volume:gain};
  const keys=storedEffectiveKeys(clip);
  time=clamp(selectedPoint?time:roundFrame(time,fps),0,clip.duration);
  const index=keys.findIndex(k=>selectedPoint?k.time===time:Math.abs(k.time-time)<1e-9);
  if(index>=0)keys[index]={...keys[index],value:gain};
  else keys.push({time,value:gain});
  return encodeEffectiveKeys(keys.sort((a,b)=>a.time-b.time),clip.volume);
}

export function editEffectivePointResult(clip: Clip, index: number, time: number, gain: number, fps: number) {
  const target=effectiveKeys(clip)[index],keys=storedEffectiveKeys(clip);
  if(!target)throw Error('音量ポイントが見つかりません。');
  let storedIndex=keys.findIndex(k=>k.time===target.time);
  if(storedIndex<0){
    if(keys.length>=MAX_VOLUME_KEYFRAMES)throw Error('音量ポイントは最大64個です。端に点を追加する前に不要な点を削除してください。');
    keys.push(target);keys.sort((a,b)=>a.time-b.time);storedIndex=keys.findIndex(k=>k.time===target.time);
  }
  const normalized={...clip,volumeKeyframes:keys.map(k=>({...k,value:k.value/2}))};
  const moved=moveVolumePoint(normalized,storedIndex,time,gain/2,fps).map(k=>({...k,value:k.value*2}));
  return {patch:encodeEffectiveKeys(moved,clip.volume),point:moved[storedIndex]};
}
export function editEffectivePoint(clip: Clip, index: number, time: number, gain: number, fps: number) {
  return editEffectivePointResult(clip,index,time,gain,fps).patch;
}

export function editEffectiveSegment(clip: Clip, time: number, delta: number): Partial<Clip> {
  if(!clip.volumeKeyframes?.length)return {volume:clamp(clip.volume+delta,0,2)};
  const normalized={...clip,volumeKeyframes:storedEffectiveKeys(clip).map(k=>({...k,value:k.value/2}))};
  return encodeEffectiveKeys(shiftVolumeSegment(normalized,time,delta/2).map(k=>({...k,value:k.value*2})),clip.volume);
}

export function removeVolumePoint(clip: Clip, index: number): Partial<Clip> {
  const keys=clip.volumeKeyframes||[],time=effectiveKeys(clip)[index]?.time;
  index=keys.findIndex(key=>key.time===time);
  if(index<0)return {};
  if(keys.length===1)return {volume:clamp(clip.volume*keys[0].value,0,2),volumeKeyframes:[]};
  return {volumeKeyframes:keys.filter((_,i)=>i!==index)};
}

export function shiftVolumeSegment(clip: Clip, time: number, delta: number): VolumeKeyframe[] {
  const keys = clip.volumeKeyframes?.length ? clip.volumeKeyframes : [{time:0,value:1},{time:clip.duration,value:1}];
  let right=keys.findIndex(key=>key.time>=time);if(right<0)right=keys.length-1;
  const left=right>0&&time<=keys[right].time?right-1:right;
  const indexes=time<=keys[0].time?[0]:time>=keys.at(-1)!.time?[keys.length-1]:[left,right];
  const values=indexes.map(index=>keys[index].value),change=clamp(delta,-Math.min(...values),2-Math.max(...values));
  if(!Number.isFinite(change)||change===0)return keys;
  return keys.map((key,index)=>indexes.includes(index)?{...key,value:key.value+change}:key);
}

/** Synthetic endpoints and base-gain encoding must not create empty edits. */
export function sameEffectiveVolume(a: Clip, b: Clip): boolean {
  const left=effectiveKeys(a),right=effectiveKeys(b);
  return left.length===right.length&&left.every((key,index)=>Math.abs(key.time-right[index].time)<1e-9&&Math.abs(key.value-right[index].value)<1e-9);
}

/** Compare piecewise-linear gain, allowing redundant interpolation points. */
export function sameVolumeCurve(a: Clip, b: Clip): boolean {
  const left=effectiveKeys(a),right=effectiveKeys(b);
  return [...left,...right].every(key=>Math.abs(volumeAt(left,key.time)-volumeAt(right,key.time))<1e-9);
}
