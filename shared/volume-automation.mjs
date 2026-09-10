export const MAX_VOLUME_KEYFRAMES = 64;

// Values multiply the clip's base volume. Outside the keyed interval, hold the endpoint.
export function volumeAt(keys, time) {
  if (!keys?.length) return 1;
  if (time <= keys[0].time) return keys[0].value;
  if (time >= keys.at(-1).time) return keys.at(-1).value;
  let low = 0, high = keys.length - 1;
  while (high - low > 1) { const middle = (low + high) >> 1; if (keys[middle].time <= time) low = middle; else high = middle; }
  const left = keys[low], right = keys[high];
  return left.value + (right.value - left.value) * (time - left.time) / (right.time - left.time);
}

export function windowVolume(keys, offset, duration) {
  if (!keys?.length) return keys;
  const end = offset + duration;
  const result = [{ time: 0, value: volumeAt(keys, offset) }, ...keys.filter(k => k.time > offset && k.time < end).map(k => ({ time: k.time - offset, value: k.value })), { time: duration, value: volumeAt(keys, end) }];
  if (result.length > 1 && result[0].value === result[1].value) result.shift();
  if (result.length > 1 && result.at(-1).value === result.at(-2).value) result.pop();
  return result.length === 1 ? [{ time: 0, value: result[0].value }] : result;
}

// Preserve the volume at each source sample through trims, rate changes, and linked edits.
export function retimeVolume(clip, next) {
  const keys = clip.volumeKeyframes;
  if (!keys?.length || clip.in === next.in && clip.speed === next.speed && clip.duration === next.duration) return keys;
  const ratio = next.speed / clip.speed, offset = (next.in - clip.in) / clip.speed;
  return windowVolume(keys, offset, next.duration * ratio).map(key => ({ time: Math.min(next.duration, key.time / ratio), value: key.value }));
}

export function validateVolumeKeys(clip) {
  const keys = clip.volumeKeyframes;
  if (keys === undefined) return;
  if (!['audio', 'video'].includes(clip.kind) || clip.audioDetached || !Array.isArray(keys) || keys.length > MAX_VOLUME_KEYFRAMES) throw new Error('音量ポイントは音声のあるクリップに最大64個まで設定できます。');
  let previous = -1;
  for (const key of keys) {
    if (!key || !Number.isFinite(key.time) || key.time < 0 || key.time > clip.duration || key.time <= previous || !Number.isFinite(key.value) || key.value < 0 || key.value > 2) throw new Error('音量ポイントの時刻・値が不正です。時刻はクリップ内で昇順、音量は基本音量の0〜200%にしてください。');
    previous = key.time;
  }
}

// Numeric-only, sample-time FFmpeg expression. A sum avoids deeply nested conditionals.
export function volumeExpression(keys, offset = 0) {
  if (!keys?.length) return '1';
  return [String(keys[0].value), ...keys.slice(1).map((right, i) => {
    const left = keys[i];
    return `(${right.value-left.value})*clip((t-${offset+left.time})/${right.time-left.time},0,1)`;
  })].join('+');
}
