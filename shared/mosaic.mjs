export const DEFAULT_MOSAIC = Object.freeze({ x: .5, y: .5, width: .3, height: .3, blockSize: .02 });

export function hasMosaic(clip) { return clip?.mosaic !== undefined; }

export function validateMosaic(clip) {
  const mosaic = clip?.mosaic;
  if (mosaic === undefined) return;
  if (!mosaic || !['video', 'image'].includes(clip.kind) || Array.isArray(mosaic)) throw new Error('モザイクは映像または画像だけに設定できます。');
  for (const [name, min, max] of [['x', 0, 1], ['y', 0, 1], ['width', .01, 1], ['height', .01, 1], ['blockSize', .005, .1]]) {
    if (!Number.isFinite(mosaic[name]) || mosaic[name] < min || mosaic[name] > max) throw new Error('モザイクの位置・範囲・粗さが不正です。');
  }
  if (mosaic.x - mosaic.width / 2 < -1e-8 || mosaic.x + mosaic.width / 2 > 1 + 1e-8 || mosaic.y - mosaic.height / 2 < -1e-8 || mosaic.y + mosaic.height / 2 > 1 + 1e-8) throw new Error('モザイクの範囲が素材の外に出ています。');
}

export function mosaicBounds(mosaic, width, height) {
  return {
    left: Math.max(0, Math.ceil((mosaic.x - mosaic.width / 2) * width)),
    top: Math.max(0, Math.ceil((mosaic.y - mosaic.height / 2) * height)),
    right: Math.min(width, Math.ceil((mosaic.x + mosaic.width / 2) * width)),
    bottom: Math.min(height, Math.ceil((mosaic.y + mosaic.height / 2) * height)),
    block: Math.max(2, Math.round(width * mosaic.blockSize)),
  };
}

// Apply after scaling and chroma, before crop/mask and the clip transform.
// The sample location is clamped to the selected region, so a boundary block
// cannot borrow an unpixelated pixel from outside the selected rectangle.
export function ffmpegMosaicFilter(clip) {
  const m = clip.mosaic, n = value => Number(value.toFixed(8));
  const left = `ceil(W*${n(m.x - m.width / 2)})`, right = `ceil(W*${n(m.x + m.width / 2)})`;
  const top = `ceil(H*${n(m.y - m.height / 2)})`, bottom = `ceil(H*${n(m.y + m.height / 2)})`;
  const block = `max(2,round(W*${n(m.blockSize)}))`;
  const sx = `min(${right}-1,max(${left},${left}+floor((X-${left})/${block})*${block}+floor(${block}/2)))`;
  const sy = `min(${bottom}-1,max(${top},${top}+floor((Y-${top})/${block})*${block}+floor(${block}/2)))`;
  const inside = `gte(X,${left})*lt(X,${right})*gte(Y,${top})*lt(Y,${bottom})`;
  return `geq=r='if(${inside},r(${sx},${sy}),r(X,Y))':g='if(${inside},g(${sx},${sy}),g(X,Y))':b='if(${inside},b(${sx},${sy}),b(X,Y))':a='if(${inside},alpha(${sx},${sy}),alpha(X,Y))'`;
}

// For an opaque video whose scaled dimensions are known, evaluate geq only
// inside the selected rectangle. The extra source pixel at the right/bottom
// prevents geq's bilinear sampler from changing a clamped corner sample.
export function ffmpegMosaicRegionFilter(clip, width, height) {
  const m = clip.mosaic, n = value => Number(value.toFixed(8));
  const left = Math.max(0, Math.ceil(width * n(m.x - m.width / 2)));
  const top = Math.max(0, Math.ceil(height * n(m.y - m.height / 2)));
  const right = Math.min(width, Math.ceil(width * n(m.x + m.width / 2)));
  const bottom = Math.min(height, Math.ceil(height * n(m.y + m.height / 2)));
  const regionWidth = right - left, regionHeight = bottom - top;
  if (regionWidth < 1 || regionHeight < 1) return null;
  const block = `max(2,round(${width}*${n(m.blockSize)}))`;
  const sx = `min(${regionWidth - 1},floor(X/${block})*${block}+floor(${block}/2))`;
  const sy = `min(${regionHeight - 1},floor(Y/${block})*${block}+floor(${block}/2))`;
  const sample = `geq=r='r(${sx},${sy})':g='g(${sx},${sy})':b='b(${sx},${sy})':a='alpha(${sx},${sy})'`;
  return {
    area: regionWidth * regionHeight / (width * height),
    crop: `crop=${regionWidth + (right < width ? 1 : 0)}:${regionHeight + (bottom < height ? 1 : 0)}:${left}:${top}:exact=1`,
    sample,
    trim: `crop=${regionWidth}:${regionHeight}:0:0:exact=1`,
    x: left,
    y: top,
  };
}
