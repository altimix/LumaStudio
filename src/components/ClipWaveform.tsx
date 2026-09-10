import { volumeAt } from '../../shared/volume-automation.mjs';
import { fadeAt } from '../render';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Asset, Clip } from '../types';
import { requestWaveform } from '../waveform';
import { overviewWaveform } from '../waveform-viewport';

export default function ClipWaveform({ asset, clip, zoom, left, right }: { asset: Asset; clip: Clip; zoom: number; left: number; right: number }) {
  const [detail,setDetail]=useState('loading'),[retryRevision,setRetryRevision]=useState(0);
  const latestClip=useRef(clip),redraw=useRef<(()=>void)|null>(null);
  useLayoutEffect(()=>{latestClip.current=clip;redraw.current?.();},[clip]);
  const canvas = useRef<HTMLCanvasElement>(null), [ratio, setRatio] = useState(window.devicePixelRatio || 1);
  useEffect(() => { const resize = () => setRatio(window.devicePixelRatio || 1); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  const canRead=!!window.luma?.readWaveform&&!asset.offline&&!!asset.url;
  const hasOverview=!asset.offline&&!clip.audioTreatment&&asset.waveform.length>0;
  const visible = right > left, bins = Math.min(8192, Math.max(1, Math.ceil((right - left) * ratio)));
  const start = Math.min(asset.duration, clip.in + left / zoom * clip.speed), end = Math.min(asset.duration, clip.in + right / zoom * clip.speed);
  useLayoutEffect(() => {
    const node = canvas.current; if (!node || !visible || end <= start) return;
    const ctx = node.getContext('2d'); if (!ctx) return;
    let cancelled = false, unsubscribe = () => {}, retry: ReturnType<typeof setTimeout> | undefined;
    node.dataset.waveformDetail = 'loading';setDetail('loading');
    let lastValues:ArrayLike<number>|null=null;
    const draw = (values: ArrayLike<number>) => {
      lastValues=values;
      if (cancelled) return;
      node.width = bins; node.height = Math.max(1, Math.round(node.clientHeight * ratio));
      const current=latestClip.current;
      const height = node.height, center = height / 2;
      ctx.fillStyle = getComputedStyle(node).color; ctx.globalAlpha = .25; ctx.fillRect(0, Math.floor(center), bins, 1); ctx.globalAlpha = 1;
      for (let i = 0; i < bins; i++) { const local=(start+(end-start)*(i+.5)/bins-clip.in)/clip.speed;const gain=current.audioMuted?0:current.volume*volumeAt(current.volumeKeyframes||[],local)*fadeAt(current,current.start+local);const value = Math.min(1,(values[i] || 0)*gain); if (value > 0) ctx.fillRect(i, center - value * (center - ratio), 1, value * (height - ratio * 2)); }
    };
    // Preserve an explicitly approximate overview while waiting, never use raw
    // peaks for treated or offline media. Detailed reads replace it with absolute peaks.
    draw(hasOverview?overviewWaveform(asset.waveform,asset.duration,start,end,bins):new Float32Array(bins));
    redraw.current=()=>{if(lastValues)draw(lastValues);};
    const read = (attempt = 0) => {
      if (!canRead) {node.dataset.waveformDetail='unavailable';setDetail('unavailable');return;}
      node.dataset.waveformDetail = 'loading';
      unsubscribe = requestWaveform(asset.url, start, end, bins, values => {
        if (cancelled) return;
        if (values) { draw(values); node.dataset.waveformDetail = 'ready';setDetail('ready'); }
        else if (attempt < 1) retry = setTimeout(() => read(attempt + 1), 500);
        else {node.dataset.waveformDetail = 'unavailable';setDetail('unavailable');}
      },clip.audioTreatment);
    };
    const observer=new ResizeObserver(()=>{if(lastValues)draw(lastValues);});observer.observe(node);
    const timer = canRead?setTimeout(read,70):undefined;
    if(!canRead){node.dataset.waveformDetail=hasOverview?'overview':'unavailable';setDetail(hasOverview?'overview':'unavailable');}
    return () => { observer.disconnect();redraw.current=null;cancelled = true; clearTimeout(timer); clearTimeout(retry); unsubscribe(); };
  }, [asset.url, asset.offline, asset.duration, asset.waveform, start, end, bins, ratio, visible, clip.audioTreatment, clip.in, clip.speed, clip.start, clip.duration, retryRevision,canRead,hasOverview]);
  return visible ? <div className="clip-waveform detailed-waveform"><canvas ref={canvas} aria-hidden="true" className="waveform" data-source-start={start} data-source-end={end} style={{ position: 'absolute', left, width: right - left, height: '100%' }}/>{detail!=='ready'?<span className="waveform-status">{detail==='loading'?(hasOverview?'概要波形・詳細を更新中…':'波形を更新中…'):detail==='overview'?'概要波形':canRead?<button onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();setRetryRevision(n=>n+1);}}>{hasOverview?'概要波形・詳細を再読込':'波形を再読込'}</button>:hasOverview?'概要波形':'波形を表示できません'}</span>:null}</div> : null;
}
