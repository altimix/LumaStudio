import type { Clip } from './types';
import { hasVideoMask, maskAlphaAt, rasterizeBezierMask } from '../shared/video-mask.mjs';
import { hasChromaKey } from '../shared/chroma-key.mjs';
import { hasMosaic, mosaicBounds, mosaicBlurSigma } from '../shared/mosaic.mjs';
import { effectRegionBounds, hasGaussianBlur } from '../shared/gaussian-blur.mjs';
import { GpuChromaPreview, paintChromaCpu } from './chroma-preview';
import { paintEdgePaddedBlurSource } from './blur-padding';

export type MaskedFrame = { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; mask: HTMLCanvasElement; key: string; renderKey?:string; chroma?:GpuChromaPreview; chromaFallback?:HTMLCanvasElement; chromaUnavailable?:boolean; mosaicCells?:HTMLCanvasElement; blurPaddedSource?:HTMLCanvasElement };

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

export function maskedVideoFrame(source: CanvasImageSource, clip: Clip, width: number, height: number, cached?: MaskedFrame, sourceKey?: string): MaskedFrame | undefined {
  if (!hasVideoMask(clip) && !hasChromaKey(clip) && !hasMosaic(clip) && !hasGaussianBlur(clip)) return undefined;
  const key = videoMaskKey(clip, width, height), renderKey = sourceKey === undefined ? undefined : JSON.stringify([sourceKey, key, clip.chromaKey || null, clip.mosaic || null, clip.gaussianBlur || null]);
  // requestAnimationFrame continues while paused. Reuse the completed matte
  // until the decoded source frame or an effect setting actually changes.
  if (renderKey !== undefined && cached?.renderKey === renderKey && !cached.chroma?.lost) return cached;
  const canvas = cached?.canvas || document.createElement('canvas');
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const context = cached?.context || canvas.getContext('2d', { alpha: true, willReadFrequently: false })!;
  const mask = cached?.mask || document.createElement('canvas');
  if (hasVideoMask(clip) && cached?.key !== key) paintVideoMask(mask, clip, width, height);
  let processed=source,chroma=cached?.chroma,chromaFallback=cached?.chromaFallback,chromaUnavailable=cached?.chromaUnavailable;
  if(clip.chromaKey){
    if(chroma?.lost){chroma.dispose();chroma=undefined;chromaUnavailable=true;}
    if(!chromaUnavailable)try{chroma ||= new GpuChromaPreview();if(chroma.render(source,width,height,clip.chromaKey))processed=chroma.canvas;else throw Error('GPU chroma unavailable');}
    catch{chroma?.dispose();chroma=undefined;chromaUnavailable=true;}
    if(chromaUnavailable){chromaFallback ||= document.createElement('canvas');processed=paintChromaCpu(chromaFallback,source,width,height,clip.chromaKey);}
  }else{chroma?.dispose();chroma=undefined;chromaUnavailable=false;if(chromaFallback){chromaFallback.width=chromaFallback.height=0;chromaFallback=undefined;}}
  context.save(); context.globalCompositeOperation = 'copy'; context.globalAlpha = 1; context.filter = 'none';
  context.drawImage(processed, 0, 0, width, height);
  context.globalCompositeOperation = 'source-over';
  let blurPaddedSource=cached?.blurPaddedSource;
  const blurRegion=(region:{x:number;y:number;width:number;height:number},sigma:number,clampSamples=false)=>{
    const {left,top,right,bottom}=effectRegionBounds(region,width,height);
    if(right<=left||bottom<=top)return;
    blurPaddedSource ||= document.createElement('canvas');
    const allowed=clampSamples?{left,top,right,bottom}:{left:0,top:0,right:width,bottom:height};
    const position=paintEdgePaddedBlurSource(blurPaddedSource,canvas,allowed,{left,top,right,bottom},sigma);
    context.save();context.beginPath();context.rect(left,top,right-left,bottom-top);context.clip();
    context.globalCompositeOperation='copy';context.filter=`blur(${sigma}px)`;context.drawImage(blurPaddedSource,position.x,position.y);
    context.restore();
  };
  if(clip.gaussianBlur)blurRegion(clip.gaussianBlur,Math.max(.5,width*clip.gaussianBlur.sigma));
  let mosaicCells=cached?.mosaicCells;
  if(clip.mosaic){
    const {left,top,right,bottom,block}=mosaicBounds(clip.mosaic,width,height),regionWidth=right-left,regionHeight=bottom-top;
    if(regionWidth>0&&regionHeight>0){
      mosaicCells ||= document.createElement('canvas');
      const columns=Math.max(1,Math.ceil(regionWidth/block)),rows=Math.max(1,Math.ceil(regionHeight/block));
      if(mosaicCells.width!==columns||mosaicCells.height!==rows){mosaicCells.width=columns;mosaicCells.height=rows;}
      const cells=mosaicCells.getContext('2d',{alpha:true})!;
      const sourcePixels=context.getImageData(left,top,regionWidth,regionHeight).data;
      const sampled=cells.createImageData(columns,rows),targetPixels=sampled.data;
      for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
        const sampleX=Math.min(regionWidth-1,column*block+Math.floor(block/2));
        const sampleY=Math.min(regionHeight-1,row*block+Math.floor(block/2));
        const from=(sampleY*regionWidth+sampleX)*4,to=(row*columns+column)*4;
        targetPixels[to]=sourcePixels[from];targetPixels[to+1]=sourcePixels[from+1];targetPixels[to+2]=sourcePixels[from+2];targetPixels[to+3]=sourcePixels[from+3];
      }
      cells.putImageData(sampled,0,0);
      context.save();context.beginPath();context.rect(left,top,regionWidth,regionHeight);context.clip();
      context.clearRect(left,top,regionWidth,regionHeight);
      context.imageSmoothingEnabled=false;
      context.drawImage(mosaicCells,0,0,columns,rows,left,top,columns*block,rows*block);
      context.restore();
    }
  }else if(mosaicCells){mosaicCells.width=mosaicCells.height=0;mosaicCells=undefined;}
  if(clip.mosaic)blurRegion(clip.mosaic,mosaicBlurSigma(clip.mosaic,width),true);
  if(!clip.mosaic&&!clip.gaussianBlur&&blurPaddedSource){blurPaddedSource.width=blurPaddedSource.height=0;blurPaddedSource=undefined;}
  if(hasVideoMask(clip)){context.globalCompositeOperation = 'destination-in'; context.imageSmoothingEnabled = !!clip.videoMask?.feather; context.drawImage(mask, 0, 0, width, height);}context.restore();
  return { canvas, context, mask, key, renderKey, chroma, chromaFallback, chromaUnavailable, mosaicCells, blurPaddedSource };
}

export function disposeMaskedFrame(frame: MaskedFrame) {
  frame.chroma?.dispose();if(frame.chromaFallback)frame.chromaFallback.width=frame.chromaFallback.height=0;frame.canvas.width = frame.canvas.height = frame.mask.width = frame.mask.height = 0;
  if(frame.mosaicCells)frame.mosaicCells.width=frame.mosaicCells.height=0;
  if(frame.blurPaddedSource)frame.blurPaddedSource.width=frame.blurPaddedSource.height=0;
}

export function evictInactiveMaskedFrames(frames: Map<string, MaskedFrame>, active: ReadonlySet<string>) {
  for (const [id, frame] of frames) {
    if (active.has(id)) continue;
    disposeMaskedFrame(frame);
    frames.delete(id);
  }
}
