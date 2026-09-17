export const DEFAULT_CHROMA_KEY = Object.freeze({ color: '#00ff00', tolerance: .12, softness: .08, greenSpill: .7, blueSpill: .7, matte: false });

const HEX_COLOR = /^#[\da-f]{6}$/i;
const clamp01 = value => Math.max(0, Math.min(1, value));
const bounded = (value, min, max, label) => {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label}が不正です。`);
};

export function hasChromaKey(clip) { return clip?.chromaKey !== undefined; }

export function validateChromaKey(clip) {
  const key = clip?.chromaKey;
  if (key === undefined) return;
  if (!key || !['video', 'image'].includes(clip.kind)) throw new Error('クロマキーは映像または画像だけに設定できます。');
  if (typeof key.color !== 'string' || !HEX_COLOR.test(key.color) || typeof key.matte !== 'boolean') throw new Error('クロマキーの色または表示設定が不正です。');
  bounded(key.tolerance, 0, .5, 'クロマキーの許容範囲');
  bounded(key.softness, 0, .5, 'クロマキーの境界のなめらかさ');
  bounded(key.greenSpill, 0, 1, '緑の色かぶり除去');
  bounded(key.blueSpill, 0, 1, '青の色かぶり除去');
}

export function parseChromaColor(color) {
  if (typeof color !== 'string' || !HEX_COLOR.test(color)) throw new Error('クロマキーの色が不正です。');
  return [Number.parseInt(color.slice(1, 3), 16), Number.parseInt(color.slice(3, 5), 16), Number.parseInt(color.slice(5, 7), 16)];
}

export function rgbHex(red, green, blue) {
  const byte = value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${byte(red)}${byte(green)}${byte(blue)}`;
}

export function averageSampleColor(pixels) {
  if (!(pixels instanceof Uint8ClampedArray) || !pixels.length || pixels.length % 4) throw new Error('スポイトの画素データが不正です。');
  let red = 0, green = 0, blue = 0, weight = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] / 255;
    red += pixels[index] * alpha; green += pixels[index + 1] * alpha; blue += pixels[index + 2] * alpha; weight += alpha;
  }
  if (weight < 1 / 255) throw new Error('透明な部分からは背景色を取得できません。');
  return rgbHex(red / weight, green / weight, blue / weight);
}

export function chromaCoordinates(red, green, blue) {
  return { cb: (-.168736 * red - .331264 * green + .5 * blue) / 255, cr: (.5 * red - .418688 * green - .081312 * blue) / 255 };
}

export function chromaUniforms(key) {
  const [red, green, blue] = parseChromaColor(key.color), coordinates = chromaCoordinates(red, green, blue);
  return { ...coordinates, tolerance: key.tolerance, softness: key.softness, greenSpill: key.greenSpill, blueSpill: key.blueSpill, matte: key.matte };
}

export function applyChromaPixel(red, green, blue, alpha, key) {
  const target = chromaUniforms(key), current = chromaCoordinates(red, green, blue);
  const distance = Math.hypot(current.cb - target.cb, current.cr - target.cr);
  const linear = key.softness > 1e-8 ? clamp01((distance - key.tolerance) / key.softness) : distance > key.tolerance ? 1 : 0;
  const matte = linear * linear * (3 - 2 * linear), proximity = 1 - clamp01(distance / Math.max(.01, key.tolerance + key.softness + .15));
  const greenExcess = Math.max(0, green - Math.max(red, blue)), blueExcess = Math.max(0, blue - Math.max(red, green));
  return {
    red: Math.round(red),
    green: Math.round(green - greenExcess * key.greenSpill * proximity),
    blue: Math.round(blue - blueExcess * key.blueSpill * proximity),
    alpha: Math.round(alpha * matte),
    matte,
  };
}

const number = value => Number(value.toFixed(8));
export function ffmpegChromaFilter(clip) {
  const key = clip?.chromaKey;
  if (!key) return '';
  const target = chromaUniforms(key), red = 'r(X,Y)', green = 'g(X,Y)', blue = 'b(X,Y)';
  const cb = `(-0.168736*${red}-0.331264*${green}+0.5*${blue})/255`;
  const cr = `(0.5*${red}-0.418688*${green}-0.081312*${blue})/255`;
  const distance = `sqrt(pow((${cb})-${number(target.cb)},2)+pow((${cr})-${number(target.cr)},2))`;
  const linear = key.softness > 1e-8 ? `clip(((${distance})-${number(key.tolerance)})/${number(key.softness)},0,1)` : `gt(${distance},${number(key.tolerance)})`;
  const matte = `((${linear})*(${linear})*(3-2*(${linear})))`;
  const proximity = `(1-clip((${distance})/${number(Math.max(.01, key.tolerance + key.softness + .15))},0,1))`;
  const greenOut = `clip(${green}-max(0,${green}-max(${red},${blue}))*${number(key.greenSpill)}*${proximity},0,255)`;
  const blueOut = `clip(${blue}-max(0,${blue}-max(${red},${green}))*${number(key.blueSpill)}*${proximity},0,255)`;
  return `geq=r='${red}':g='${greenOut}':b='${blueOut}':a='alpha(X,Y)*${matte}'`;
}
