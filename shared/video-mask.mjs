const finite = (value, min, max, label) => {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label}が範囲外です。`);
  return value;
};

export const EMPTY_CROP = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
export const DEFAULT_VIDEO_MASK = Object.freeze({ type: 'rectangle', x: .5, y: .5, width: .7, height: .7, feather: 0, inverted: false });
export const MAX_BEZIER_MASK_POINTS = 32;
export const DEFAULT_BEZIER_MASK = Object.freeze({ type: 'bezier', points: Object.freeze([]), closed: false, feather: 0, inverted: false });

export function effectiveCrop(clip) { return clip?.crop || EMPTY_CROP; }
export function hasCrop(clip) {
  const crop = clip?.crop;
  return !!crop && (crop.top > 0 || crop.right > 0 || crop.bottom > 0 || crop.left > 0);
}
export function hasVideoMask(clip) { return hasCrop(clip) || !!clip?.videoMask; }
export function hasBezierMask(clip) { return clip?.videoMask?.type === 'bezier'; }

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
    if (!visual || !mask || typeof mask !== 'object' || Array.isArray(mask) || !['rectangle', 'ellipse', 'bezier'].includes(mask.type)) throw new Error('映像マスクが不正です。');
    finite(mask.feather, 0, .5, 'マスクの境界ぼかし');
    if (typeof mask.inverted !== 'boolean') throw new Error('マスクの反転設定が不正です。');
    if (mask.type === 'bezier') {
      if (!Array.isArray(mask.points) || mask.points.length > MAX_BEZIER_MASK_POINTS || typeof mask.closed !== 'boolean' || (mask.closed && mask.points.length < 3)) throw new Error('ベジェマスクの点列が不正です。');
      for (const [index, point] of mask.points.entries()) {
        if (!point || typeof point !== 'object' || Array.isArray(point) || !['line', 'curve'].includes(point.kind)) throw new Error(`ベジェマスクの点${index + 1}が不正です。`);
        finite(point.x, 0, 1, `ベジェマスクの点${index + 1}のX座標`); finite(point.y, 0, 1, `ベジェマスクの点${index + 1}のY座標`);
        finite(point.inX, -1, 2, `ベジェマスクの点${index + 1}の入力ハンドルX`); finite(point.inY, -1, 2, `ベジェマスクの点${index + 1}の入力ハンドルY`);
        finite(point.outX, -1, 2, `ベジェマスクの点${index + 1}の出力ハンドルX`); finite(point.outY, -1, 2, `ベジェマスクの点${index + 1}の出力ハンドルY`);
      }
    } else {
      finite(mask.x, 0, 1, 'マスクのX座標'); finite(mask.y, 0, 1, 'マスクのY座標');
      finite(mask.width, .01, 1, 'マスクの幅'); finite(mask.height, .01, 1, 'マスクの高さ');
    }
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

export function moveBezierAnchor(point, dx, dy) {
  const movedX = Math.max(Math.max(-point.x, -1 - point.inX, -1 - point.outX), Math.min(Math.min(1 - point.x, 2 - point.inX, 2 - point.outX), dx));
  const movedY = Math.max(Math.max(-point.y, -1 - point.inY, -1 - point.outY), Math.min(Math.min(1 - point.y, 2 - point.inY, 2 - point.outY), dy));
  return { ...point, x: point.x + movedX, y: point.y + movedY, inX: point.inX + movedX, inY: point.inY + movedY, outX: point.outX + movedX, outY: point.outY + movedY };
}

export function moveBezierHandle(point, part, dx, dy) {
  const incoming = part === 'in', xKey = incoming ? 'inX' : 'outX', yKey = incoming ? 'inY' : 'outY', oppositeX = incoming ? 'outX' : 'inX', oppositeY = incoming ? 'outY' : 'inY';
  const vectorX = Math.max(Math.max(-1 - point.x, point.x - 2), Math.min(Math.min(2 - point.x, point.x + 1), point[xKey] + dx - point.x));
  const vectorY = Math.max(Math.max(-1 - point.y, point.y - 2), Math.min(Math.min(2 - point.y, point.y + 1), point[yKey] + dy - point.y));
  return { ...point, [xKey]: point.x + vectorX, [yKey]: point.y + vectorY, [oppositeX]: point.x - vectorX, [oppositeY]: point.y - vectorY };
}

const cubic = (a, b, c, d, t) => {
  const s = 1 - t;
  return s * s * s * a + 3 * s * s * t * b + 3 * s * t * t * c + t * t * t * d;
};
export function flattenBezierMask(mask, subdivisions = 12) {
  if (mask?.type !== 'bezier' || !mask.closed || mask.points.length < 3) return [];
  const steps = Math.max(2, Math.min(32, Math.round(subdivisions))), flattened = [];
  for (let index = 0; index < mask.points.length; index++) {
    const point = mask.points[index], next = mask.points[(index + 1) % mask.points.length];
    const out = point.kind === 'curve' ? { x: point.outX, y: point.outY } : point;
    const incoming = next.kind === 'curve' ? { x: next.inX, y: next.inY } : next;
    if (!index) flattened.push({ x: point.x, y: point.y });
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      flattened.push({ x: cubic(point.x, out.x, incoming.x, next.x, t), y: cubic(point.y, out.y, incoming.y, next.y, t) });
    }
  }
  return flattened;
}
function polygonContains(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function segmentDistance(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}
function polygonBoundaryDistance(points, point) {
  let distance = Infinity;
  for (let i = 0; i < points.length; i++) distance = Math.min(distance, segmentDistance(point, points[i], points[(i + 1) % points.length]));
  return distance;
}
function bezierAlphaAt(mask, u, v) {
  const points = flattenBezierMask(mask);
  if (!points.length) return 1;
  if (!polygonContains(points, u, v)) return mask.inverted ? 1 : 0;
  let inside = 1;
  if (mask.feather > 0) inside = clamp01(polygonBoundaryDistance(points, { x: u, y: v }) / (mask.feather / 2));
  return mask.inverted ? 1 - inside : inside;
}
export function maskAlphaAt(clip, u, v) {
  const crop = effectiveCrop(clip);
  if (u < crop.left || u > 1 - crop.right || v < crop.top || v > 1 - crop.bottom) return 0;
  const mask = clip?.videoMask;
  if (!mask) return 1;
  if (mask.type === 'bezier') return bezierAlphaAt(mask, u, v);
  const nx = Math.abs((u - mask.x) / (mask.width / 2));
  const ny = Math.abs((v - mask.y) / (mask.height / 2));
  const distance = mask.type === 'ellipse' ? Math.sqrt(nx * nx + ny * ny) : Math.max(nx, ny);
  const inside = mask.feather > 0 ? clamp01((1 - distance) / mask.feather) : distance <= 1 ? 1 : 0;
  return mask.inverted ? 1 - inside : inside;
}

export function rasterizeBezierMask(clip, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) throw new Error('ベジェマスクの画像サイズが不正です。');
  const alpha = new Uint8Array(width * height), mask = clip?.videoMask, crop = effectiveCrop(clip);
  const points = mask?.type === 'bezier' ? flattenBezierMask(mask).map(point => ({ x: point.x * width, y: point.y * height })) : [];
  const inside = new Uint8Array(width * height);
  if (!points.length) inside.fill(1);
  else for (let y = 0; y < height; y++) {
    const sampleY = y + .5, intersections = [];
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i], b = points[j];
      if ((a.y > sampleY) !== (b.y > sampleY)) intersections.push(a.x + (sampleY - a.y) * (b.x - a.x) / (b.y - a.y));
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const from = Math.max(0, Math.ceil(intersections[i] - .5)), to = Math.min(width - 1, Math.floor(intersections[i + 1] - .5));
      for (let x = from; x <= to; x++) inside[y * width + x] = 1;
    }
  }
  let distances;
  if (points.length && mask.feather > 0) {
    const far = width + height, diagonal = Math.SQRT2; distances = new Float32Array(width * height);
    for (let i = 0; i < distances.length; i++) distances[i] = inside[i] ? far : 0;
    // The distance transform cannot see path edges at or beyond the raster bounds.
    // Seed visible border pixels with their exact distance to the path so a full-frame
    // path feathers at its edges without inventing a fade for a path farther off-canvas.
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (inside[index] && (x === 0 || y === 0 || x === width - 1 || y === height - 1)) distances[index] = Math.min(distances[index], polygonBoundaryDistance(points, { x: x + .5, y: y + .5 }));
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = y * width + x;if (!inside[index]) continue;let value = distances[index];
      if (x) value = Math.min(value, distances[index - 1] + 1);if (y) value = Math.min(value, distances[index - width] + 1);
      if (x && y) value = Math.min(value, distances[index - width - 1] + diagonal);if (x + 1 < width && y) value = Math.min(value, distances[index - width + 1] + diagonal);distances[index] = value;
    }
    for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
      const index = y * width + x;if (!inside[index]) continue;let value = distances[index];
      if (x + 1 < width) value = Math.min(value, distances[index + 1] + 1);if (y + 1 < height) value = Math.min(value, distances[index + width] + 1);
      if (x + 1 < width && y + 1 < height) value = Math.min(value, distances[index + width + 1] + diagonal);if (x && y + 1 < height) value = Math.min(value, distances[index + width - 1] + diagonal);distances[index] = value;
    }
  }
  const radius = mask?.type === 'bezier' ? Math.max(1, mask.feather * Math.min(width, height) / 2) : 1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x, u = (x + .5) / width, v = (y + .5) / height;
    if (u < crop.left || u > 1 - crop.right || v < crop.top || v > 1 - crop.bottom) { alpha[index] = 0; continue; }
    let value = inside[index] ? distances ? Math.min(1, distances[index] / radius) : 1 : 0;
    if (points.length && mask.inverted) value = 1 - value;
    alpha[index] = Math.round(value * 255);
  }
  return alpha;
}

const number = value => Number(value.toFixed(8));
export function ffmpegMaskExpression(clip) {
  if (!hasVideoMask(clip)) return '1';
  const crop = effectiveCrop(clip);
  const u = '(X/W)', v = '(Y/H)';
  const cropExpression = `between(${u},${number(crop.left)},${number(1 - crop.right)})*between(${v},${number(crop.top)},${number(1 - crop.bottom)})`;
  const mask = clip.videoMask;
  if (!mask) return cropExpression;
  if (mask.type === 'bezier') throw new Error('ベジェマスクはラスター形式で書き出してください。');
  const nx = `abs((${u}-${number(mask.x)})/${number(mask.width / 2)})`;
  const ny = `abs((${v}-${number(mask.y)})/${number(mask.height / 2)})`;
  const distance = mask.type === 'ellipse' ? `sqrt(pow(${nx},2)+pow(${ny},2))` : `max(${nx},${ny})`;
  let shape = mask.feather > 0 ? `clip((1-${distance})/${number(mask.feather)},0,1)` : `lte(${distance},1)`;
  if (mask.inverted) shape = `(1-${shape})`;
  return `${cropExpression}*${shape}`;
}
