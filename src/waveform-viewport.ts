import type { Clip } from './types';

export const EMPTY_WAVEFORM_RANGE = { left: 0, right: 0 };

// Clip-local pixel tiles are primitive props for React.memo. Off-screen clips
// always receive the same empty range, regardless of the global scroll offset.
export function clipWaveformRange(clip: Pick<Clip, 'start' | 'duration'>, zoom: number, viewport: { left: number; width: number }) {
  const left = Math.max(0, Math.floor((viewport.left - clip.start * zoom - 128) / 256) * 256);
  const right = Math.min(clip.duration * zoom, Math.ceil((viewport.left + viewport.width - clip.start * zoom + 128) / 256) * 256);
  return right > left ? { left, right } : EMPTY_WAVEFORM_RANGE;
}

/** Legacy per-source overviews are approximate; retain peaks in the visible source window. */
export function overviewWaveform(samples: number[], duration: number, start: number, end: number, bins: number): Float32Array {
  const values=new Float32Array(bins);
  if(!samples.length||duration<=0||end<=start)return values;
  for(let i=0;i<bins;i++){
    const first=Math.max(0,Math.min(samples.length-1,Math.floor((start+(end-start)*i/bins)/duration*samples.length)));
    const last=Math.max(first+1,Math.min(samples.length,Math.ceil((start+(end-start)*(i+1)/bins)/duration*samples.length)));
    for(let j=first;j<last;j++)values[i]=Math.max(values[i],Number.isFinite(samples[j])?Math.max(0,samples[j]):0);
  }
  return values;
}
