export const DEFAULT_GAUSSIAN_BLUR = Object.freeze({ x: .5, y: .5, width: .3, height: .3, sigma: .01 });

export function hasGaussianBlur(clip) { return clip?.gaussianBlur !== undefined; }

export function validateGaussianBlur(clip) {
  const blur = clip?.gaussianBlur;
  if (blur === undefined) return;
  if (!blur || !['video', 'image'].includes(clip.kind) || Array.isArray(blur)) throw new Error('ガウスぼかしは映像または画像だけに設定できます。');
  for (const [name, min, max] of [['x', 0, 1], ['y', 0, 1], ['width', .01, 1], ['height', .01, 1], ['sigma', .001, .03]]) {
    if (!Number.isFinite(blur[name]) || blur[name] < min || blur[name] > max) throw new Error('ガウスぼかしの位置・範囲・強さが不正です。');
  }
  if (blur.x - blur.width / 2 < -1e-8 || blur.x + blur.width / 2 > 1 + 1e-8 || blur.y - blur.height / 2 < -1e-8 || blur.y + blur.height / 2 > 1 + 1e-8) throw new Error('ガウスぼかしの範囲が素材の外に出ています。');
}

export function gaussianBlurBounds(blur, width, height) {
  return {
    left: Math.max(0, Math.ceil((blur.x - blur.width / 2) * width)),
    top: Math.max(0, Math.ceil((blur.y - blur.height / 2) * height)),
    right: Math.min(width, Math.ceil((blur.x + blur.width / 2) * width)),
    bottom: Math.min(height, Math.ceil((blur.y + blur.height / 2) * height)),
    sigma: Math.max(.5, width * blur.sigma),
  };
}

// blend selects the blurred pixel, including alpha, only inside the rectangle.
// Both inputs are the full image, so the Gaussian kernel can sample across the
// selected boundary without changing pixels outside it.
export function ffmpegGaussianBlend(clip) {
  const b = clip.gaussianBlur, n = value => Number(value.toFixed(8));
  const left = `ceil(W*${n(b.x - b.width / 2)})`, right = `ceil(W*${n(b.x + b.width / 2)})`;
  const top = `ceil(H*${n(b.y - b.height / 2)})`, bottom = `ceil(H*${n(b.y + b.height / 2)})`;
  return `blend=all_expr='if(gte(X,${left})*lt(X,${right})*gte(Y,${top})*lt(Y,${bottom}),B,A)'`;
}
