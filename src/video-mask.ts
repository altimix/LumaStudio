import type { Clip } from './types';
import { hasVideoMask, maskAlphaAt, rasterizeBezierMask } from '../shared/video-mask.mjs';

export type MaskedFrame = { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; mask: HTMLCanvasElement; key: string };

// The matte contains only normalized alpha information, so it does not need to
// match a 4K/8K source pixel-for-pixel. Keeping the longer edge bounded avoids
// allocating and filling tens of millions of pixels on the renderer thread
// while a handle is dragged. Canvas scales this reusable matte onto the output
// frame; exports continue to evaluate the full-resolution FFmpeg expression.
export const MAX_VIDEO_MASK_RASTER_EDGE = 512;

export function videoMaskRasterSize(width: number, height: number) {
  const safeWidth = Math.max(1, Math.round(width)), safeHeight = Math.max(1, Math.round(height));
  const scale = Math.min(1, MAX_VIDEO_MASK_RASTER_EDGE / Math.max(safeWidth, safeHeight));
  return { width: Math.max(1, Math.round(safeWidth * scale)), height: Math.max(1, Math.round(safeHeight * scale)) };
}

export function maskedCompositeSize(sourceWidth: number, sourceHeight: number, outputWidth: number, outputHeight: number) {
  const safeSourceWidth = Math.max(1, Math.round(sourceWidth)), safeSourceHeight = Math.max(1, Math.round(sourceHeight));
  const scale = Math.min(1, outputWidth / safeSourceWidth, outputHeight / safeSourceHeight);
  return { width: Math.max(1, Math.round(safeSourceWidth * scale)), height: Math.max(1, Math.round(safeSourceHeight * scale)) };
}

export function videoMaskKey(clip: Clip, width: number, height: number) {
  return JSON.stringify([width, height, clip.crop || null, clip.videoMask || null]);
}

export function paintVideoMask(canvas: HTMLCanvasElement, clip: Clip, width: number, height: number) {
  const raster = videoMaskRasterSize(width, height);
  width = raster.width; height = raster.height;
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const context = canvas.getContext('2d', { alpha: true, willReadFrequently: false })!;
  const image = context.createImageData(width, height), pixels = image.data;
  const bezier = clip.videoMask?.type === 'bezier' ? rasterizeBezierMask(clip, width, height) : undefined;
  let offset = 0;
  for (let y = 0; y < height; y++) {
    const v = (y + .5) / height;
    for (let x = 0; x < width; x++) {
      const alpha = bezier?.[y * width + x] ?? Math.round(maskAlphaAt(clip, (x + .5) / width, v) * 255);
      pixels[offset++] = 255; pixels[offset++] = 255; pixels[offset++] = 255; pixels[offset++] = alpha;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

export function maskedVideoFrame(source: CanvasImageSource, clip: Clip, width: number, height: number, cached?: MaskedFrame): MaskedFrame | undefined {
  if (!hasVideoMask(clip)) return undefined;
  const canvas = cached?.canvas || document.createElement('canvas');
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const context = cached?.context || canvas.getContext('2d', { alpha: true, willReadFrequently: false })!;
  const mask = cached?.mask || document.createElement('canvas'), key = videoMaskKey(clip, width, height);
  if (cached?.key !== key) paintVideoMask(mask, clip, width, height);
  context.save(); context.globalCompositeOperation = 'copy'; context.globalAlpha = 1; context.filter = 'none';
  context.drawImage(source, 0, 0, width, height);
  context.globalCompositeOperation = 'destination-in'; context.imageSmoothingEnabled = !!clip.videoMask?.feather; context.drawImage(mask, 0, 0, width, height); context.restore();
  return { canvas, context, mask, key };
}

export function disposeMaskedFrame(frame: MaskedFrame) {
  frame.canvas.width = frame.canvas.height = frame.mask.width = frame.mask.height = 0;
}

export function evictInactiveMaskedFrames(frames: Map<string, MaskedFrame>, active: ReadonlySet<string>) {
  for (const [id, frame] of frames) {
    if (active.has(id)) continue;
    disposeMaskedFrame(frame);
    frames.delete(id);
  }
}
