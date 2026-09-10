export const MAX_OPACITY_KEYFRAMES = 64;

/** Linear interpolation with constant values outside the keyed interval. */
export function opacityAt(keys, time, fallback = 1) {
  if (!keys?.length) return fallback;
  if (time <= keys[0].time) return keys[0].value;
  for (let i = 1; i < keys.length; i++) {
    const left = keys[i - 1]; const right = keys[i];
    if (time <= right.time) return left.value + (right.value - left.value) * (time - left.time) / (right.time - left.time);
  }
  return keys[keys.length - 1].value;
}

/** Keep the visible curve when a clip is split or trimmed, including extensions. */
export function windowOpacity(keys, offset, duration) {
  if (!keys?.length) return keys;
  const end = offset + duration;
  const inside = keys.filter(k => k.time > offset && k.time < end).map(k => ({ time: k.time - offset, value: k.value }));
  const result = [{ time: 0, value: opacityAt(keys, offset) }, ...inside, { time: duration, value: opacityAt(keys, end) }];
  // Constant extrapolation needs no extra keys. This also preserves the 64-key cap.
  if (result.length > 1 && result[0].value === result[1].value) result.shift();
  if (result.length > 1 && result.at(-1).value === result.at(-2).value) result.pop();
  return result.length === 1 ? [{ time: 0, value: result[0].value }] : result;
}

export function validateOpacityKeys(clip) {
  const keys = clip.opacityKeyframes;
  if (keys === undefined) return;
  if (clip.kind !== 'title' || !Array.isArray(keys) || keys.length > MAX_OPACITY_KEYFRAMES) throw new Error('不透明度キーフレームはテロップに最大64個まで設定できます。');
  let previous = -1;
  for (const key of keys) {
    if (!key || !Number.isFinite(key.time) || key.time < 0 || key.time > clip.duration || key.time <= previous || !Number.isFinite(key.value) || key.value < 0 || key.value > 1) {
      throw new Error('不透明度キーフレームの時刻・値が不正です。時刻はクリップ内で重複なく昇順にしてください。');
    }
    previous = key.time;
  }
}

/** Numeric-only FFmpeg expression; T is clip-local time before start offset. */
export function opacityExpression(keys, fallback = 1) {
  if (!keys?.length) return String(fallback);
  // A sum of clamped ramps avoids deep nesting at the 64-key limit.
  return [String(keys[0].value), ...keys.slice(1).map((right, i) => {
    const left = keys[i];
    return `(${right.value - left.value})*clip((T-${left.time})/${right.time - left.time},0,1)`;
  })].join('+');
}
