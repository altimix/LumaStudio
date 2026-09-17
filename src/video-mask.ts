import type { Clip } from './types';
import { hasVideoMask, maskAlphaAt } from '../shared/video-mask.mjs';

export type MaskedFrame = { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; mask: HTMLCanvasElement; key: string };

export function videoMaskKey(clip: Clip, width: number, height: number) {
  return JSON.stringify([width, height, clip.crop || null, clip.videoMask || null]);
}

export function paintVideoMask(canvas: HTMLCanvasElement, clip: Clip, width: number, height: number) {
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const context = canvas.getContext('2d', { alpha: true, willReadFrequently: false })!;
  const image = context.createImageData(width, height), pixels = image.data;
  let offset = 0;
  for (let y = 0; y < height; y++) {
    const v = (y + .5) / height;
    for (let x = 0; x < width; x++) {
      const alpha = Math.round(maskAlphaAt(clip, (x + .5) / width, v) * 255);
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
  context.globalCompositeOperation = 'destination-in'; context.drawImage(mask, 0, 0, width, height); context.restore();
  return { canvas, context, mask, key };
}

export function disposeMaskedFrame(frame: MaskedFrame) {
  frame.canvas.width = frame.canvas.height = frame.mask.width = frame.mask.height = 0;
}
