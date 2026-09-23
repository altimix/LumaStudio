type Bounds = { left: number; top: number; right: number; bottom: number };

// Crop to the pixels a blur can reach and repeat the allowed edge pixels into
// the kernel margin. This matches FFmpeg's edge clamping, including selections
// that touch the source image or a separately pixelated mosaic boundary.
export function paintEdgePaddedBlurSource(target: HTMLCanvasElement, source: HTMLCanvasElement, allowed: Bounds, selected: Bounds, sigma: number) {
  const pad = Math.max(2, Math.ceil(sigma * 4));
  const left = Math.max(allowed.left, selected.left - pad), top = Math.max(allowed.top, selected.top - pad);
  const right = Math.min(allowed.right, selected.right + pad), bottom = Math.min(allowed.bottom, selected.bottom + pad);
  const beforeX = left - (selected.left - pad), beforeY = top - (selected.top - pad);
  const afterX = selected.right + pad - right, afterY = selected.bottom + pad - bottom;
  const innerWidth = right - left, innerHeight = bottom - top;
  const width = beforeX + innerWidth + afterX, height = beforeY + innerHeight + afterY;
  if (target.width !== width || target.height !== height) { target.width = width; target.height = height; }
  const context = target.getContext('2d', { alpha: true })!;
  context.globalCompositeOperation = 'source-over'; context.filter = 'none'; context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, width, height);
  const xs = [[left, 1, 0, beforeX], [left, innerWidth, beforeX, innerWidth], [right - 1, 1, beforeX + innerWidth, afterX]];
  const ys = [[top, 1, 0, beforeY], [top, innerHeight, beforeY, innerHeight], [bottom - 1, 1, beforeY + innerHeight, afterY]];
  for (const [sy, sh, dy, dh] of ys) for (const [sx, sw, dx, dw] of xs) {
    if (dw > 0 && dh > 0) context.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh);
  }
  return { x: left - beforeX, y: top - beforeY };
}
