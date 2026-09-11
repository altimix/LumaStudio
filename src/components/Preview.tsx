import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Expand, Pause, Play, SkipBack, SkipForward, Scan, Monitor } from 'lucide-react';
import { useEditor } from '../store';
import { endTime, timecode } from '../model';
import { fadeAt, titleCanvas } from '../render';
import { IconButton } from './UI';
import { opacityAt } from '../../shared/opacity.mjs';
import { TimelineAudio } from '../audio';
import { bindAudioMeterReset, publishAudioPeaks } from '../meter-store';
import { ensureProjectFonts, fontRevision, isFontReady } from '../fonts';
import { fontStyle } from '../../shared/text-style.mjs';
import TitleDragLayer from './TitleDragLayer';
import { transitionPlan, visualSourceTime, type PlannedTransition } from '../../shared/transitions.mjs';
import { TransitionPreview } from '../transition-preview';
import { GpuTransitionPool } from '../gpu-transition';
import { playbackFrameAhead, waitForNativeFrame, usablePlaybackFrame, videoSeekLead, videoSeekRecoveryMs, videoSeekTolerance } from '../video-timing';
import { ordinaryCutPrefetch } from '../video-prefetch';
import DrawLayer from './DrawLayer';
import MediaDragLayer from './MediaDragLayer';
import { mediaSourceKey, type MediaSize } from '../media-transform';
import type { Clip, Asset } from '../types';

export default function Preview() {
  const canvas = useRef<HTMLCanvasElement>(null); const stage = useRef<HTMLDivElement>(null); const mediaBin = useRef<HTMLDivElement>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [mediaSizes, setMediaSizes] = useState<Record<string, MediaSize>>({});
  const [transformActions, setTransformActions] = useState<HTMLDivElement | null>(null);
  const playhead = useEditor(s => s.playhead); const playing = useEditor(s => s.playing); const project = useEditor(s => s.project);
  const [fontVersion, setFontVersion] = useState(0), [fontStatus, setFontStatus] = useState(''), [fontRetry, setFontRetry] = useState(0);
  const fontUse = JSON.stringify(project.clips.filter(c => c.kind === 'title' && !c.graphic && !project.tracks.find(t => t.id === c.trackId)?.hidden).map(fontStyle));
  useEffect(() => {
    let active = true;
    const snapshot = useEditor.getState().project;
    setFontStatus(snapshot.clips.some(c => c.kind === 'title' && !snapshot.tracks.find(t => t.id === c.trackId)?.hidden && !isFontReady(c)) ? '日本語フォントを準備しています…' : '');
    void ensureProjectFonts(snapshot).then(() => { if (active) { setFontVersion(fontRevision()); setFontStatus(''); } }).catch(error => { if (active) setFontStatus((error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')); });
    return () => { active = false; };
  }, [fontUse, fontRetry]);
  const shuttleRate = useEditor(s => s.shuttleRate); const quality = useEditor(s => s.previewQuality); const safeGuides = useEditor(s => s.safeGuides); const total = endTime(project);
  useEffect(() => {
    // Keep the compositor accelerated even after screenshots/readbacks. Video
    // frame caches below intentionally use independent CPU-backed canvases.
    const target = canvas.current!; const ctx = target.getContext('2d', { alpha: false, willReadFrequently: false })!;
    type VideoItem = { element: HTMLVideoElement; url: string; frame?:HTMLCanvasElement;frameTime?:number;frameRevision?:number;decodedRevision?:number;seekRevision?:number;transportRevision?:number; seekStartedAt?:number;seekLatency?:number;lastSeekLatency?:number; recoveredRevision?:number; nativePlayback?:boolean; nativeWaiting?:boolean };
    const clearFrame=(item:VideoItem)=>{if(item.frame)item.frame.width=item.frame.height=0;item.frame=undefined;item.frameTime=undefined;item.frameRevision=undefined;};
    const media = new Map<string, VideoItem>();
    const pictures = new Map<string, HTMLImageElement>(); const titles = new Map<string, { key: string; canvas: HTMLCanvasElement }>();
    const gpuPool=new GpuTransitionPool();
    const knownSizes = new Map<string, MediaSize>(); let sizeProject = '';
    let plannedProject:typeof project|undefined;let plans:PlannedTransition[]=[];let projectRevision=0;
    const transitionBuffers=new Map<string,{a:HTMLCanvasElement;b:HTMLCanvasElement;aReady:boolean;bReady:boolean;aUsable:boolean;bUsable:boolean;aAvailable:boolean;bAvailable:boolean;renderer:TransitionPreview}>();
    let frame = 0; let lastUi = 0; let updatingClock = false;let seekRevision=0;
    const audio = new TimelineAudio(message => { useEditor.getState().stop(); useEditor.getState().notify(message); }, publishAudioPeaks);
    const unbindMeterReset = bindAudioMeterReset(() => audio.discardPlayedMeterSamples());
    const sync = () => { const s = useEditor.getState(); audio.setTransport(s.project, s.playhead, s.playing, s.shuttleRate); };
    sync();
    const unsubscribe = useEditor.subscribe((s, previous) => {
      const requestedSeek=s.seekRevision!==previous.seekRevision||(!updatingClock&&s.playhead!==previous.playhead);
      const remapped=s.project!==previous.project&&(s.project.id!==previous.project.id||s.project.clips.some(c=>{
        if(c.kind!=='video')return false;const before=previous.project.clips.find(old=>old.id===c.id);
        return before&&(before.assetId!==c.assetId||before.start!==c.start||before.in!==c.in||before.speed!==c.speed);
      }));
      // Adding/moving a graphic does not invalidate already decoded video.
      if(remapped||requestedSeek)seekRevision++;
      if (s.project !== previous.project || s.playing !== previous.playing || s.shuttleRate !== previous.shuttleRate || requestedSeek) sync();
    });
    const prepareVideo = (clip: Clip, asset: Asset) => {
      let item = media.get(clip.id);
      if (item && item.url !== asset.url) { clearFrame(item);item.element.pause(); item.element.removeAttribute('src'); item.element.load(); item.element.remove(); media.delete(clip.id); item = undefined; }
      // Some Windows decoders can remain in seeking after a paused end-frame
      // seek. Recreate that decoder once per transport revision, preserving its
      // last picture. Never repeatedly reset a legitimately slow source.
      let retained:Partial<VideoItem>|undefined;
      if(item?.element.seeking&&item.seekStartedAt!==undefined&&performance.now()-item.seekStartedAt>videoSeekRecoveryMs(item.seekLatency)&&item.recoveredRevision!==seekRevision){
        retained={frame:item.frame,frameTime:item.frameTime,recoveredRevision:seekRevision};
        item.element.pause();item.element.removeAttribute('src');item.element.load();item.element.remove();media.delete(clip.id);item=undefined;
      }
      if (!item) {
        const element = document.createElement('video');
        element.muted = true; element.preload = 'auto'; element.crossOrigin = 'anonymous';
        element.src = asset.url;
        element.dataset.clipId = clip.id; element.playsInline = true;
        mediaBin.current?.appendChild(element); element.load();
        item = { ...retained, element, url: asset.url }; media.set(clip.id, item);
        element.addEventListener('error', () => useEditor.getState().notify(`プレビューできない素材: ${asset.name}。再リンクしてお試しください。`), { once: true });
      }
      // Measure when a frame is usable, before another seek can replace it.
      // A queued seeked event can otherwise clear the following seek's timer.
      if(item.seekStartedAt!==undefined&&!item.element.seeking&&item.element.readyState>=2){
        const elapsed=performance.now()-item.seekStartedAt;
        if(elapsed>0&&elapsed<2000){item.lastSeekLatency=elapsed;item.seekLatency=item.seekLatency===undefined?elapsed:item.seekLatency*.25+elapsed*.75;}
        item.decodedRevision=item.seekRevision;
        item.seekStartedAt=undefined;
      }
      return item;
    };
    const seekVideo = (item:VideoItem,desired:number,tolerance:number) => {
      const el=item.element;
      // A new user seek/project must supersede an outstanding decoder seek.
      // Waiting for the old seek can strand Home/End and replay at a clip's end.
      const superseding=el.seeking&&item.seekRevision!==seekRevision;
      // Let a new decoder produce its initial frame before its first seek;
      // metadata alone is insufficient on Windows hardware decoders.
      if((el.readyState>=2||(el.readyState>0&&superseding))&&(Math.abs(el.currentTime-desired)>tolerance||superseding)&&(!el.seeking||superseding)){
        item.seekRevision=seekRevision;item.seekStartedAt=performance.now();el.currentTime=Math.max(0,desired);
      }
    };
    const draw = (now: number) => {
      let s = useEditor.getState(); const p = s.project;
      let sizesChanged = false;
      if (sizeProject !== p.id) { knownSizes.clear(); sizeProject = p.id; sizesChanged = true; }
      let t = s.playhead;
      if (s.playing) {
        t = audio.position;
        const ended = s.shuttleRate > 0 ? t >= endTime(p) - 1e-7 : t <= 1e-7;
        if (ended) t = s.shuttleRate > 0 ? endTime(p) : 0;
        updatingClock = true; useEditor.setState({ playhead: t }); updatingClock = false;
        if (ended) { s.stop(); s = useEditor.getState(); }
      }
      const w = Math.max(2, Math.round(p.width * s.previewQuality)); const h = Math.max(2, Math.round(p.height * s.previewQuality));
      if (target.width !== w || target.height !== h) { target.width = w; target.height = h; }
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
      const alive = new Set<string>(), activeTitles = new Set<string>();
      if(plannedProject!==p){plans=transitionPlan(p);plannedProject=p;projectRevision++;const ids=new Set(p.clips.map(c=>c.id));for(const id of knownSizes.keys())if(!ids.has(id)){knownSizes.delete(id);sizesChanged=true;}}
      const active=plans.filter(pair=>pair.video&&t>=pair.start&&t<pair.end&&!p.tracks.find(track=>track.id===pair.from.trackId)?.hidden),pairs=new Map(active.flatMap(pair=>[[pair.fromId,pair],[pair.toId,pair]] as const));
      // Ordinary cuts need the same decoder warm-up as transitions. Prepare
      // only the nearest incoming clip per visible track, so long edits do not
      // open every decoder at once.
      if(s.playing)for(const track of p.tracks){
        if(track.hidden||track.kind!=='video')continue;
        const forward=s.shuttleRate>0;
        const upcoming=ordinaryCutPrefetch(p.clips,plans,track.id,t,s.shuttleRate);
        if(!upcoming)continue;
        const clip=upcoming,asset=p.assets.find(a=>a.id===clip.assetId);
        if(!asset||asset.offline)continue;
        const item=prepareVideo(clip,asset),el=item.element;
        alive.add(clip.id);item.nativePlayback=false;if(!el.paused)el.pause();
        seekVideo(item,visualSourceTime(clip,asset,forward?clip.start:clip.start+clip.duration-1/p.fps),.008);
      }
      // Prime the incoming decoder before the effect starts, including reverse playback.
      if(s.playing)for(const pair of plans){
        const forward=s.shuttleRate>0,until=forward?pair.start-t:t-pair.end;
        if(!pair.video||until<=0||until>2*Math.abs(s.shuttleRate)||p.tracks.find(track=>track.id===pair.from.trackId)?.hidden)continue;
        const clip=forward?pair.to:pair.from,asset=p.assets.find(a=>a.id===clip.assetId);
        if(clip.kind!=='video'||!asset||asset.offline)continue;
        const item=prepareVideo(clip,asset),el=item.element,desired=visualSourceTime(clip,asset,forward?pair.start:pair.end);
        alive.add(clip.id);item.nativePlayback=false;if(!el.paused)el.pause();
        seekVideo(item,desired,.008);
      }
      for(const [id,buffers]of transitionBuffers)if(!active.some(pair=>pair.id===id)){buffers.renderer.dispose();for(const buffer of [buffers.a,buffers.b])buffer.width=buffer.height=0;transitionBuffers.delete(id);}
      for(const pair of active){let buffers=transitionBuffers.get(pair.id);if(!buffers){buffers={a:document.createElement('canvas'),b:document.createElement('canvas'),aReady:false,bReady:false,aUsable:false,bUsable:false,aAvailable:false,bAvailable:false,renderer:new TransitionPreview(message=>{useEditor.getState().stop();useEditor.getState().notify(message);},gpuPool)};transitionBuffers.set(pair.id,buffers);}buffers.aReady=buffers.bReady=buffers.aUsable=buffers.bUsable=buffers.aAvailable=buffers.bAvailable=false;for(const buffer of [buffers.a,buffers.b]){if(buffer.width!==w||buffer.height!==h){buffer.width=w;buffer.height=h;}buffer.getContext('2d')!.clearRect(0,0,w,h);}}
      let transitionsReady=true,transitionsPresented=true;const tracks = [...p.tracks].reverse();
      for (const track of tracks) for (const clip of p.clips.filter(c => c.trackId === track.id).sort((a,b) => a.start - b.start)) {
        if ((t < clip.start || t >= clip.start + clip.duration) && !pairs.has(clip.id)) continue;
        const asset = p.assets.find(a => a.id === clip.assetId);
        const fade = fadeAt(clip, t); let source: CanvasImageSource | null = null; let sourceReady=true,sourceUsable=true; let sw = p.width; let sh = p.height;
        if (clip.kind === 'title') {
          activeTitles.add(clip.id); if (isFontReady(clip)) {
          const key = JSON.stringify([clip.text, clip.fontSize, clip.color, clip.textStyle, clip.fontFamily, clip.fontWeight, clip.textShadow, clip.shadowColor, clip.shadowBlur, clip.shadowDistance, clip.textStroke, clip.strokeColor, clip.strokeWidth, clip.captionBackgroundOpacity, clip.textBox, clip.graphic, clip.graphic?[clip.x,clip.y,clip.scale,clip.rotation]:null, fontRevision(), p.width, w, h]);
          if (titles.get(clip.id)?.key !== key) { const old = titles.get(clip.id)?.canvas; if (old) old.width = old.height = 0; titles.set(clip.id, { key, canvas: titleCanvas(clip, w, h, p.width) }); }
          source = titles.get(clip.id)!.canvas; sw = w; sh = h;
          }
        } else if (asset && !asset.offline) {
          if (clip.kind === 'image') {
            let img = pictures.get(asset.id);
            if (!img || img.src !== new URL(asset.url,location.href).href) { img = new Image(); img.crossOrigin = 'anonymous'; img.src = asset.url; pictures.set(asset.id, img); }
            if (img.complete && img.naturalWidth) { source = img; sw = img.naturalWidth; sh = img.naturalHeight; }
          } else if (clip.kind === 'video') {
            const item = prepareVideo(clip, asset);
            const el = item.element; alive.add(clip.id);
            const desired = visualSourceTime(clip,asset,t),unclamped=clip.in+(t-clip.start)*clip.speed;
            const nativePlayback = s.playing && !audio.loading && s.shuttleRate > 0 && clip.speed * s.shuttleRate <= 4 && Math.abs(desired-unclamped)<1e-6;
            const enteringNative = nativePlayback && !item.nativePlayback;
            item.nativePlayback=nativePlayback;
            const waitingNative=nativePlayback&&item.transportRevision===seekRevision&&!el.seeking&&el.readyState>=2&&waitForNativeFrame(el.currentTime,desired,clip.speed,p.fps,!!item.nativeWaiting);
            item.nativeWaiting=waitingNative;
            // Copy the decoded frame BEFORE seeking. currentTime can synchronously lower
            // readyState, otherwise continuous reverse seeks clear the canvas every frame.
            const ahead = s.playing && playbackFrameAhead(el.currentTime,desired,clip.speed,s.shuttleRate,p.fps);
            if(ahead&&!nativePlayback&&el.readyState>=2&&!el.seeking&&item.lastSeekLatency!==undefined)item.seekLatency=item.lastSeekLatency;
            const captureReady = s.playing ? !ahead : Math.abs(el.currentTime-desired)<=.008;
            if (el.readyState >= 2 && el.videoWidth && !el.seeking && captureReady) {
              const cached=item.frame ||= document.createElement('canvas');
              const ratio = Math.min(1, w / el.videoWidth, h / el.videoHeight);
              const fw = Math.max(2, Math.round(el.videoWidth * ratio)); const fh = Math.max(2, Math.round(el.videoHeight * ratio));
              const resized=cached.width!==fw||cached.height!==fh;
              if(resized){cached.width=fw;cached.height=fh;}
              if(resized||nativePlayback||item.frameTime!==el.currentTime){
                cached.getContext('2d',{alpha:false,willReadFrequently:true})!.drawImage(el,0,0,fw,fh);
                item.frameTime=el.currentTime;
                item.frameRevision=item.decodedRevision;
              }
            }
            // A transport frame may advance by one sequence frame while decoding.
            // Stopped seeks require the cached image to match the exact seek target.
            const frameTolerance=s.playing?Math.max(.008,Math.abs(clip.speed)/p.fps):.008;
            sourceReady=item.frameTime!==undefined&&Math.abs(item.frameTime-desired)<=frameTolerance+1e-6;
            if(sourceReady){item.frameRevision=seekRevision;item.decodedRevision=seekRevision;}
            sourceUsable=sourceReady||(s.playing&&usablePlaybackFrame(item.frameTime,desired,clip.speed,s.shuttleRate,p.fps,item.frameRevision===seekRevision));
            const baseRate=clip.speed*s.shuttleRate;
            const rate=nativePlayback ? baseRate*Math.max(.75,Math.min(1.25,1+6*(desired-el.currentTime)/baseRate)) : 1;
            // Small clock drift is corrected through playback speed. A hard seek
            // through a long GOP can take hundreds of milliseconds on CPU and
            // repeatedly seeking to catch up only makes the delay grow.
            if(!el.seeking&&Math.abs(el.playbackRate-rate)>.005)el.playbackRate=rate;
            // Seek-driven shuttle frames must be ready when they are displayed.
            // Predict only during playback; stopped seeks remain exact.
            const lead=s.playing&&!audio.loading&&!nativePlayback?videoSeekLead(item.seekLatency,desired,unclamped):0;
            const seekTarget=lead?visualSourceTime(clip,asset,t+s.shuttleRate*lead):desired;
            const steadyPlayback = nativePlayback && !enteringNative && item.transportRevision === seekRevision;
            // If decoding finishes early, keep that frame until the playhead
            // reaches it. Chasing another prediction would discard every result.
            const waitingForPlayhead=s.playing&&!nativePlayback&&ahead&&el.readyState>=2&&!el.seeking&&item.transportRevision===seekRevision;
            if(!waitingForPlayhead&&!waitingNative)seekVideo(item,seekTarget,videoSeekTolerance(clip.speed,s.shuttleRate,p.fps,steadyPlayback));
            if(el.readyState>=2||item.seekRevision===seekRevision)item.transportRevision=seekRevision;
            // play() on an ended element rewinds it to zero. A decoder can reach
            // its end slightly before the audio clock reaches the cut.
            if (nativePlayback && !waitingNative && el.paused && !el.ended && !el.seeking) void el.play().catch(() => {});
            if ((!nativePlayback||waitingNative) && !el.paused) el.pause();
            if (item.frame && (sourceUsable || !s.playing)) { source = item.frame; sw = item.frame.width; sh = item.frame.height; }
          }
        }
        const pair=pairs.get(clip.id),buffers=pair?transitionBuffers.get(pair.id):undefined;
        const drawContext=buffers?(clip.id===pair!.fromId?buffers.a:buffers.b).getContext('2d')!:ctx;
        if (source && !track.hidden && clip.kind !== 'audio') {
          if (asset && (clip.kind === 'video' || clip.kind === 'image')) {
            const previous = knownSizes.get(clip.id), key = mediaSourceKey(p, asset);
            if (previous?.width !== sw || previous?.height !== sh || previous?.source !== key) { knownSizes.set(clip.id, { width: sw, height: sh, source: key }); sizesChanged = true; }
          }
          const fit = Math.min(w / sw, h / sh) * (clip.graphic?1:clip.scale);
          drawContext.save(); drawContext.translate(w / 2 + w * (clip.graphic?0:clip.x) / 100, h / 2 + h * (clip.graphic?0:clip.y) / 100); drawContext.rotate((clip.graphic?0:clip.rotation) * Math.PI / 180);
          drawContext.globalAlpha = opacityAt(clip.opacityKeyframes, t - clip.start, clip.opacity) * fade;
          if (clip.kind !== 'title' && (clip.exposure !== 0 || clip.contrast !== 1 || clip.saturation !== 1)) drawContext.filter = `brightness(${2 ** clip.exposure}) contrast(${clip.contrast}) saturate(${clip.saturation})`;
          drawContext.drawImage(source, -sw * fit / 2, -sh * fit / 2, sw * fit, sh * fit); drawContext.restore();
          if(buffers){if(clip.id===pair!.fromId){buffers.aAvailable=true;buffers.aReady=sourceReady;buffers.aUsable=sourceUsable;}else{buffers.bAvailable=true;buffers.bReady=sourceReady;buffers.bUsable=sourceUsable;}}
        }
        if(pair&&buffers&&clip.id===pair.toId){
          // A cleared canvas is not a decoded source frame. Keep the available
          // picture while an incoming decoder/font/image is still preparing.
          if(!buffers.aReady||!buffers.bReady)transitionsReady=false;
          if(!buffers.aUsable||!buffers.bUsable){
            transitionsReady=false;
            const last=buffers.renderer.frameStamp,hold=s.playing&&buffers.renderer.hasFrame&&last&&last.revision===projectRevision&&last.width===w&&last.height===h&&last.kind===pair.video&&Math.abs(t-last.time)<.3;
            // A brief decoder delay must not flash back to the unblended clip.
            if(hold)ctx.drawImage(buffers.renderer.bitmap!,0,0,w,h);
            else{transitionsPresented=false;if(buffers.aAvailable||buffers.bAvailable)ctx.drawImage(buffers.aAvailable?buffers.a:buffers.b,0,0);}
            continue;
          }
          const sourceState=[pair.from,pair.to].map(c=>{const video=media.get(c.id);return video?[video.frameTime,video.element.readyState,video.element.seeking]:pictures.get(c.assetId!)?.complete;});
          const key=JSON.stringify([projectRevision,pair.video,t,w,h,sourceState]);buffers.renderer.request(key,pair.video!,buffers.a,buffers.b,(t-pair.start)/pair.duration,{time:t,revision:projectRevision,width:w,height:h,kind:pair.video!});
          const rendered=buffers.renderer.frameStamp,matching=rendered&&rendered.revision===projectRevision&&rendered.kind===pair.video&&rendered.width===w&&rendered.height===h;
          if(buffers.renderer.bitmap&&matching&&(s.playing||buffers.renderer.key===key))ctx.drawImage(buffers.renderer.bitmap,0,0,w,h);else{transitionsPresented=false;ctx.drawImage(buffers.a,0,0);}
          if(buffers.renderer.key!==key)transitionsReady=false;
        }
      }
      for (const [id, item] of titles) if (!activeTitles.has(id)) { item.canvas.width = item.canvas.height = 0; titles.delete(id); }
      for (const [id, item] of media) if (!alive.has(id)) {
        item.element.pause();clearFrame(item);
        if (!p.clips.some(c => c.id === id)) { item.element.removeAttribute('src'); item.element.load(); item.element.remove(); media.delete(id); }
      }
      if (now - lastUi > 90) {
        lastUi = now; setAudioLoading(audio.loading);
      }
      if (sizesChanged) setMediaSizes(Object.fromEntries(knownSizes));
      target.dataset.transitionsPresented=String(transitionsPresented);target.dataset.transitionBackend=active.map(pair=>transitionBuffers.get(pair.id)?.renderer.backend||'').join(',');target.dataset.previewTime=String(t);target.dataset.transitionKind=active.map(pair=>pair.video).join(',');target.dataset.transitionsReady=String(transitionsReady);frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); unsubscribe(); unbindMeterReset(); audio.dispose();for(const buffers of transitionBuffers.values())buffers.renderer.dispose();gpuPool.dispose(); for (const item of media.values()) { clearFrame(item);item.element.pause(); item.element.removeAttribute('src'); item.element.load(); item.element.remove(); } };
  }, []);
  const seek = useEditor(s => s.seek);
  return <section className="preview-panel panel">
    <div className="panel-heading"><div className="panel-title"><Monitor size={15}/><span>プログラムモニター</span></div><div className="preview-transform-actions" ref={setTransformActions}/><span className="subtle tiny">{project.width} × {project.height} <span className="dot-separator">·</span> {project.fps} fps</span></div>
    <div className="media-elements" aria-hidden="true" ref={mediaBin}/><div className="preview-stage" ref={stage}>
      <div className="canvas-wrap" style={{ aspectRatio: `${project.width}/${project.height}`, '--preview-ratio':project.width/project.height } as CSSProperties}><canvas ref={canvas} aria-label="動画プレビュー"/><MediaDragLayer sizes={mediaSizes} actions={transformActions}/><TitleDragLayer fontVersion={fontVersion}/><DrawLayer/>{fontStatus ? <div className="preview-font-status" role="status">{fontStatus}<button className="text-button" onClick={() => setFontRetry(value => value + 1)}>再試行</button></div> : null}{safeGuides ? <div className="safe-guides"><div/></div> : null}{project.clips.length === 0 ? <div className="preview-empty"><Monitor size={36}/><strong>あなたの物語を、タイムラインへ。</strong><span>素材をドラッグして編集をはじめましょう</span></div> : null}</div>
      <div className="monitor-badge"><span/> PROGRAM</div>
    </div>
    <div className="preview-bottom"><div className="preview-meta"><span className="timecode accent">{timecode(playhead, project.fps)}</span><span className="shuttle-status" role="status" aria-label="シャトル状態">{playing ? `${shuttleRate < 0 ? '逆再生' : '再生'} ${Math.abs(shuttleRate)}×${audioLoading ? '・音声準備中' : ''}` : '停止'}</span><div className="preview-options"><select aria-label="プレビュー画質" value={quality} onChange={e => useEditor.setState({ previewQuality: Number(e.target.value) })}><option value={1}>フル画質</option><option value={0.5}>1/2 画質</option><option value={0.25}>1/4 画質</option></select><span>フィット</span><ChevronDown size={12}/></div><span className="timecode subtle">{timecode(total, project.fps)}</span></div>
    <div className="transport"><div><IconButton label="セーフマージン" active={safeGuides} onClick={() => useEditor.setState({ safeGuides: !safeGuides })}><Scan size={16}/></IconButton></div><div className="transport-center"><IconButton label="先頭へ (Home)" onClick={() => seek(0)}><SkipBack size={17}/></IconButton><IconButton label="1フレーム戻る (←)" onClick={() => { useEditor.getState().stop(); seek(playhead - 1 / project.fps); }}><ChevronLeft size={19}/></IconButton><button className="play-button" aria-label={playing ? '一時停止 (Space)' : '再生 (Space)'} onClick={() => useEditor.getState().togglePlay()}>{playing ? <Pause size={19} fill="currentColor"/> : <Play size={19} fill="currentColor"/>}</button><IconButton label="1フレーム進む (→)" onClick={() => { useEditor.getState().stop(); seek(playhead + 1 / project.fps); }}><ChevronRight size={19}/></IconButton><IconButton label="末尾へ (End)" onClick={() => seek(total)}><SkipForward size={17}/></IconButton></div><IconButton label="プレビューを全画面表示" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void stage.current?.requestFullscreen(); }}><Expand size={16}/></IconButton></div></div>
  </section>;
}
