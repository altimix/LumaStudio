import { fontStyle, validateTextStyle } from './text-style.mjs';
import { opacityAt } from './opacity.mjs';
import { validateVideoMask } from './video-mask.mjs';
import { validateChromaKey } from './chroma-key.mjs';
import { validateGraphic } from './graphics.mjs';
import { validateTextBox } from './text-box.mjs';

export const MAX_VISUAL_KEYFRAMES = 64;
export const TRANSFORM_FIELDS = ['x', 'y', 'scale', 'rotation', 'opacity'];
export const TEXT_FIELDS = ['fontSize', 'color', 'fontFamily', 'fontWeight', 'textStyle', 'textShadow', 'shadowColor', 'shadowBlur', 'shadowDistance', 'textStroke', 'strokeColor', 'strokeWidth', 'captionBackgroundOpacity', 'textBox'];
export const VIDEO_FIELDS = ['exposure', 'contrast', 'saturation', 'crop', 'videoMask', 'chromaKey'];
export const VISUAL_RANGES = { x: [-200, 200], y: [-200, 200], scale: [.1, 3], rotation: [-180, 180], opacity: [0, 1], fontSize: [16, 240], shadowBlur: [0, 100], shadowDistance: [0, 100], strokeWidth: [0, 20], captionBackgroundOpacity: [0, 1], exposure: [-2, 2], contrast: [0, 2], saturation: [0, 2] };
const colors = ['color', 'shadowColor', 'strokeColor'];
const epsilon = 1e-7;
const nullable = ['crop', 'videoMask', 'chromaKey', 'textBox'];
export const visualFields = clip => [...TRANSFORM_FIELDS, ...(clip.kind === 'title' ? clip.graphic ? ['color', 'graphic'] : TEXT_FIELDS : VIDEO_FIELDS)];
export const hasVisualKeys = clip => !!(clip.visualKeyframes?.length || clip.opacityKeyframes?.length);

export function visualSnapshot(clip) {
  const values = Object.fromEntries(TRANSFORM_FIELDS.map(field => [field, clip[field]]));
  if (clip.kind === 'title' && !clip.graphic) Object.assign(values, {
    fontSize: clip.fontSize, color: clip.color, textStyle: clip.textStyle,
    fontFamily: fontStyle(clip).family, fontWeight: fontStyle(clip).weight,
    textShadow: clip.textShadow !== false, shadowColor: clip.shadowColor ?? '#000000',
    shadowBlur: clip.shadowBlur ?? clip.fontSize * .22, shadowDistance: clip.shadowDistance ?? clip.fontSize * .035,
    textStroke: !!clip.textStroke, strokeColor: clip.strokeColor ?? '#000000', strokeWidth: clip.strokeWidth ?? 3,
    captionBackgroundOpacity: clip.captionBackgroundOpacity ?? .65, textBox: clip.textBox ?? null,
  });
  else if (clip.graphic) Object.assign(values, { color: clip.color, graphic: clip.graphic });
  else if (clip.kind !== 'audio') Object.assign(values, { exposure: clip.exposure, contrast: clip.contrast, saturation: clip.saturation, crop: clip.crop ?? null, videoMask: clip.videoMask ?? null, chromaKey: clip.chromaKey ?? null });
  return values;
}

function interpolate(a, b, ratio, field) {
  if (typeof a === 'number' && typeof b === 'number') return field === 'fontWeight' ? a : a + (b - a) * ratio;
  if (typeof a === 'string' && /^#[\da-f]{6}$/i.test(a) && typeof b === 'string' && /^#[\da-f]{6}$/i.test(b)) return '#' + [1, 3, 5].map(offset => {
    const start = parseInt(a.slice(offset, offset + 2), 16), end = parseInt(b.slice(offset, offset + 2), 16);
    return Math.round(start + (end - start) * ratio).toString(16).padStart(2, '0');
  }).join('');
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return a;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length ? a.map((value, index) => interpolate(value, b[index], ratio, String(index))) : a;
  if (a.type !== b.type || a.shape !== b.shape || (a.points && a.points.length !== b.points?.length)) return a;
  return Object.fromEntries(Object.keys(a).map(key => [key, interpolate(a[key], b[key], ratio, key)]));
}

function clipWithValues(clip, values) {
  return { ...clip, ...Object.fromEntries(Object.entries(values).map(([field, value]) => [field, nullable.includes(field) && value === null ? undefined : value])) };
}

/** Legacy opacity curves become the same points without changing their values. */
export function visualKeys(clip) {
  if (clip.visualKeyframes !== undefined) return clip.visualKeyframes;
  const base = visualSnapshot(clip);
  return (clip.opacityKeyframes || []).map(key => ({ time: key.time, values: { ...base, opacity: key.value } }));
}

export function visualValuesAt(clip, time) {
  const base = visualSnapshot(clip), keys = visualKeys(clip);
  if (!keys.length) return { ...base, opacity: opacityAt(clip.opacityKeyframes, time, clip.opacity) };
  if (time <= keys[0].time) return { ...base, ...keys[0].values };
  for (let index = 1; index < keys.length; index++) {
    const right = keys[index], left = keys[index - 1];
    if (time >= right.time) continue;
    const start = { ...base, ...left.values }, end = { ...base, ...right.values }, ratio = (time - left.time) / (right.time - left.time), values = { ...start };
    for (const field of visualFields(clip)) {
      values[field] = interpolate(start[field], end[field], ratio, field);
    }
    return values;
  }
  return { ...base, ...keys.at(-1).values };
}

export function visualClipAt(clip, time) {
  return hasVisualKeys(clip) ? clipWithValues(clip, visualValuesAt(clip, time)) : clip;
}

export function setVisualKey(clip, time, patch = {}) {
  const at = Math.max(0, Math.min(clip.duration, time));
  let keys = visualKeys(clip);
  if (!keys.length && at > epsilon) keys = [{ time: 0, values: visualSnapshot(clip) }];
  const values = { ...visualValuesAt(clip, at), ...Object.fromEntries(Object.entries(patch).filter(([field]) => visualFields(clip).includes(field)).map(([field, value]) => [field, nullable.includes(field) && value === undefined ? null : value])) };
  const next = [...keys.filter(key => Math.abs(key.time - at) > epsilon), { time: at, values }].sort((a, b) => a.time - b.time);
  const result = { ...clip, opacityKeyframes: undefined, visualKeyframes: next };
  validateVisualKeys(result);
  return result;
}

export function patchVisualClip(clip, patch, time) {
  if (!hasVisualKeys(clip) || Object.hasOwn(patch, 'visualKeyframes') || Object.hasOwn(patch, 'opacityKeyframes')) return { ...clip, ...patch };
  const fields = visualFields(clip), keyed = Object.fromEntries(Object.entries(patch).filter(([field]) => fields.includes(field)));
  if (!Object.keys(keyed).length) return { ...clip, ...patch };
  return { ...setVisualKey(clip, time, keyed), ...Object.fromEntries(Object.entries(patch).filter(([field]) => !fields.includes(field))) };
}

export function windowVisualKeys(clip, offset, duration) {
  if (!clip.visualKeyframes?.length) return clip.visualKeyframes;
  const end = offset + duration, inside = clip.visualKeyframes.filter(key => key.time > offset && key.time < end).map(key => ({ ...key, time: key.time - offset }));
  const result = [{ time: 0, values: visualValuesAt(clip, offset) }, ...inside, { time: duration, values: visualValuesAt(clip, end) }];
  const base=visualSnapshot(clip);
  const same = (a, b) => {
    const left={...base,...a.values},right={...base,...b.values};
    return visualFields(clip).every(field => JSON.stringify(left[field]) === JSON.stringify(right[field]));
  };
  if (result.length > 1 && same(result[0], result[1])) result.shift();
  if (result.length > 1 && same(result.at(-1), result.at(-2))) result.pop();
  return result.length === 1 ? [{ ...result[0], time: 0 }] : result;
}

export function validateVisualKeys(clip) {
  const keys = clip.visualKeyframes;
  if (keys === undefined) return;
  if (clip.kind === 'audio' || !Array.isArray(keys) || keys.length > MAX_VISUAL_KEYFRAMES) throw new Error('映像のキーフレームは動画・画像・テキストに最大64個まで設定できます。');
  if (clip.opacityKeyframes?.length) throw new Error('不透明度は共通のキーフレームにまとめてください。');
  const allowed = visualFields(clip); let previous = -1;
  for (const key of keys) {
    if (!key || !Number.isFinite(key.time) || key.time < 0 || key.time > clip.duration || key.time <= previous || !key.values || typeof key.values !== 'object' || Array.isArray(key.values) || Object.keys(key.values).some(field => !allowed.includes(field))) throw new Error('キーフレームの時刻・設定が不正です。クリップ内で重複なく昇順にしてください。');
    const values = { ...visualSnapshot(clip), ...key.values };
    for (const field of allowed) {
      if (VISUAL_RANGES[field]) {
        const [min, max] = VISUAL_RANGES[field];
        if (!Number.isFinite(values[field]) || values[field] < min || values[field] > max) throw new Error(`キーフレームの ${field} が範囲外です。`);
      } else if (colors.includes(field) && (typeof values[field] !== 'string' || !/^#[\da-f]{6}$/i.test(values[field]))) throw new Error('キーフレームの色が不正です。');
    }
    if (clip.kind === 'title' && !clip.graphic) {
      if (!['hero', 'minimal', 'subtitle'].includes(values.textStyle)) throw new Error('キーフレームのテキストスタイルが不正です。');
    }
    const resolved = clipWithValues(clip, values);
    if (clip.kind === 'title') validateTextStyle(resolved);
    validateVideoMask(resolved); validateChromaKey(resolved); validateGraphic(resolved); validateTextBox(resolved);
    previous = key.time;
  }
}

/** Only validated numeric values enter FFmpeg expressions. */
export function visualExpression(clip, field, variable = 't', offset = 0, fallback = 0) {
  const read = values => {
    let value=values;
    for(const part of field.split('.')) {
      if(part==='enabled'){value=value?1:0;continue;}
      if(typeof value==='string'&&/^#[\da-f]{6}$/i.test(value)&&['r','g','b'].includes(part)) value=parseInt(value.slice(1+['r','g','b'].indexOf(part)*2,3+['r','g','b'].indexOf(part)*2),16);
      else value=value?.[part];
    }
    return typeof value==='boolean'?Number(value):Number.isFinite(value)?value:fallback;
  };
  const keys=visualKeys(clip),time=offset?`(${variable}-${offset})`:variable;
  if(!keys.length)return String(read(visualSnapshot(clip)));
  const values=keys.map(key=>read({...visualSnapshot(clip),...key.values}));
  let expression=String(values.at(-1));
  for(let index=keys.length-2;index>=0;index--){
    const left=keys[index],right=keys[index+1],a=values[index],b=values[index+1];
    // The same interpolation decides whether parent type/on-off changes hold.
    // Colors round to bytes in the renderer; allow that one-byte quantization.
    const midpoint=read(visualValuesAt(clip,(left.time+right.time)/2));
    const smooth=Math.abs(midpoint-(a+b)/2)<(/\.color\.[rgb]$/.test(field) ? .51 : 1e-7)&&!field.endsWith('.enabled')&&field!=='fontWeight';
    const segment=smooth&&a!==b?`${a}+(${b-a})*clip((${time}-${left.time})/${right.time-left.time},0,1)`:String(a);
    expression=segment===expression?expression:`if(lt(${time},${right.time}),${segment},${expression})`;
  }
  return expression;
}

export function needsTitleFrames(clip) {
  if (clip.kind !== 'title' || !clip.visualKeyframes?.length) return false;
  const fields = clip.graphic ? ['x', 'y', 'scale', 'rotation', 'color', 'graphic'] : TEXT_FIELDS, first = visualValuesAt(clip, 0);
  return clip.visualKeyframes.some(key => fields.some(field => JSON.stringify(Object.hasOwn(key.values, field) ? key.values[field] : visualSnapshot(clip)[field]) !== JSON.stringify(first[field])));
}
