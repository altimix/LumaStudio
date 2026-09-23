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

// Soften cell edges while leaving the selected rectangle and block size intact.
export function mosaicBlurSigma(mosaic, width) { return Math.max(.5, width * mosaic.blockSize * .15); }

// Apply after scaling and chroma, before crop/mask and the clip transform.
// The sample location is clamped to the selected region, so a boundary block
// cannot borrow an unpixelated pixel from outside the selected rectangle.
export function ffmpegMosaicFilter(clip, extendEdges = false) {
  const m = clip.mosaic, n = value => Number(value.toFixed(8));
  const left = `ceil(W*${n(m.x - m.width / 2)})`, right = `ceil(W*${n(m.x + m.width / 2)})`;
  const top = `ceil(H*${n(m.y - m.height / 2)})`, bottom = `ceil(H*${n(m.y + m.height / 2)})`;
  const block = `max(2,round(W*${n(m.blockSize)}))`;
  const x = extendEdges ? `min(${right}-1,max(${left},X))` : 'X';
  const y = extendEdges ? `min(${bottom}-1,max(${top},Y))` : 'Y';
  const sx = `min(${right}-1,max(${left},${left}+floor((${x}-${left})/${block})*${block}+floor(${block}/2)))`;
  const sy = `min(${bottom}-1,max(${top},${top}+floor((${y}-${top})/${block})*${block}+floor(${block}/2)))`;
  const inside = `gte(X,${left})*lt(X,${right})*gte(Y,${top})*lt(Y,${bottom})`;
  const channel = (name) => extendEdges ? `${name}(${sx},${sy})` : `if(${inside},${name}(${sx},${sy}),${name}(X,Y))`;
  return `geq=r='${channel('r')}':g='${channel('g')}':b='${channel('b')}':a='${channel('alpha')}'`;
}
