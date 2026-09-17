const finite = (value, min, max, label) => {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label}が範囲外です。`);
  return value;
};

export const EMPTY_CROP = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
export const DEFAULT_VIDEO_MASK = Object.freeze({ type: 'rectangle', x: .5, y: .5, width: .7, height: .7, feather: 0, inverted: false });

export function effectiveCrop(clip) { return clip?.crop || EMPTY_CROP; }
export function hasCrop(clip) {
  const crop = clip?.crop;
  return !!crop && (crop.top > 0 || crop.right > 0 || crop.bottom > 0 || crop.left > 0);
}
export function hasVideoMask(clip) { return hasCrop(clip) || !!clip?.videoMask; }

const OPPOSITE_CROP_EDGE = Object.freeze({ top: 'bottom', right: 'left', bottom: 'top', left: 'right' });
export function clampCropEdge(crop, edge, requested) {
  const opposite = crop[OPPOSITE_CROP_EDGE[edge]];
  return Math.max(0, Math.min(.99 - opposite, requested));
}

export function validateVideoMask(clip) {
  const visual = clip?.kind === 'video' || clip?.kind === 'image';
  if (clip?.crop !== undefined) {
    if (!visual || !clip.crop || typeof clip.crop !== 'object' || Array.isArray(clip.crop)) throw new Error('クロップ設定が不正です。');
    for (const [key, label] of [['top', '上'], ['right', '右'], ['bottom', '下'], ['left', '左']]) finite(clip.crop[key], 0, .99, `クロップ（${label}）`);
    if (clip.crop.left + clip.crop.right > .99 || clip.crop.top + clip.crop.bottom > .99) throw new Error('クロップ後の表示範囲を1%以上残してください。');
  }
  if (clip?.videoMask !== undefined) {
    const mask = clip.videoMask;
    if (!visual || !mask || typeof mask !== 'object' || Array.isArray(mask) || !['rectangle', 'ellipse'].includes(mask.type)) throw new Error('映像マスクが不正です。');
    finite(mask.x, 0, 1, 'マスクのX座標'); finite(mask.y, 0, 1, 'マスクのY座標');
    finite(mask.width, .01, 1, 'マスクの幅'); finite(mask.height, .01, 1, 'マスクの高さ');
    finite(mask.feather, 0, .5, 'マスクの境界ぼかし');
    if (typeof mask.inverted !== 'boolean') throw new Error('マスクの反転設定が不正です。');
  }
}

const clamp01 = value => Math.max(0, Math.min(1, value));
export function resizeMaskAxis(opposite, desired, direction) {
  const positive = direction > 0;
  const maximum = Math.min(1, positive ? 2 * (1 - opposite) : 2 * opposite);
  const minimum = Math.min(maximum, Math.max(.01, positive ? -2 * opposite : 2 * (opposite - 1)));
  const distance = Math.max(minimum, Math.min(maximum, (positive ? 1 : -1) * (desired - opposite)));
  return { center: clamp01(opposite + (positive ? 1 : -1) * distance / 2), size: Math.max(.01, Math.min(1, distance)) };
}
export function maskAlphaAt(clip, u, v) {
  const crop = effectiveCrop(clip);
  if (u < crop.left || u > 1 - crop.right || v < crop.top || v > 1 - crop.bottom) return 0;
  const mask = clip?.videoMask;
  if (!mask) return 1;
  const nx = Math.abs((u - mask.x) / (mask.width / 2));
  const ny = Math.abs((v - mask.y) / (mask.height / 2));
  const distance = mask.type === 'ellipse' ? Math.sqrt(nx * nx + ny * ny) : Math.max(nx, ny);
  const inside = mask.feather > 0 ? clamp01((1 - distance) / mask.feather) : distance <= 1 ? 1 : 0;
  return mask.inverted ? 1 - inside : inside;
}

const number = value => Number(value.toFixed(8));
export function ffmpegMaskExpression(clip) {
  if (!hasVideoMask(clip)) return '1';
  const crop = effectiveCrop(clip);
  const u = '(X/W)', v = '(Y/H)';
  const cropExpression = `between(${u},${number(crop.left)},${number(1 - crop.right)})*between(${v},${number(crop.top)},${number(1 - crop.bottom)})`;
  const mask = clip.videoMask;
  if (!mask) return cropExpression;
  const nx = `abs((${u}-${number(mask.x)})/${number(mask.width / 2)})`;
  const ny = `abs((${v}-${number(mask.y)})/${number(mask.height / 2)})`;
  const distance = mask.type === 'ellipse' ? `sqrt(pow(${nx},2)+pow(${ny},2))` : `max(${nx},${ny})`;
  let shape = mask.feather > 0 ? `clip((1-${distance})/${number(mask.feather)},0,1)` : `lte(${distance},1)`;
  if (mask.inverted) shape = `(1-${shape})`;
  return `${cropExpression}*${shape}`;
}
