import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useEditor } from '../store';
import { endTime } from '../model';
import type { RefObject } from 'react';

export default function TimelineScrollbars({view, rowHeight, setRowHeight}: {view:RefObject<HTMLDivElement|null>;rowHeight:number;setRowHeight:(height:number)=>void}) {
  const [revision,refresh]=useState(0);
  const horizontal=useRef<HTMLDivElement>(null),vertical=useRef<HTMLDivElement>(null),cancelRef=useRef<(()=>void)|null>(null);
  useLayoutEffect(()=>{
    const node=view.current;if(!node)return;
    const update=()=>refresh(n=>n+1),observer=new ResizeObserver(update);
    observer.observe(node);if(node.firstElementChild)observer.observe(node.firstElementChild);
    node.addEventListener('scroll',update);
    return()=>{cancelRef.current?.();observer.disconnect();node.removeEventListener('scroll',update);};
  },[view]);
  void revision;
  const geometry=(verticalAxis:boolean)=>{
    const node=view.current,rail=(verticalAxis?vertical:horizontal).current;
    const size=verticalAxis?node?.clientHeight:node?.clientWidth,total=verticalAxis?node?.scrollHeight:node?.scrollWidth;
    const length=(verticalAxis?rail?.clientHeight:rail?.clientWidth)||1;
    const thumb=Math.min(length,Math.max(60,length*(size||1)/(total||1)));
    const offset=verticalAxis?node?.scrollTop:node?.scrollLeft,max=Math.max(0,(total||1)-(size||1));
    return {size:size||1,total:total||1,length,thumb,max,offset:offset||0,start:max?(offset||0)/max*(length-thumb):0};
  };
  const start=(event:React.PointerEvent,axis:boolean,edge:'start'|'end'|null)=>{
    if(event.button!==0)return;event.preventDefault();event.stopPropagation();
    const node=view.current,state=useEditor.getState();if(!node||state.gestureActive)return;
    const origin=axis?event.clientY:event.clientX,g=geometry(axis),initialZoom=state.zoom,initialHeight=rowHeight;
    const owner={},target=event.currentTarget,pointerId=event.pointerId;let ended=false;
    const end=()=>{if(ended)return;ended=true;cancelRef.current=null;target.removeEventListener('lostpointercapture',cancel);if(target.hasPointerCapture(pointerId))target.releasePointerCapture(pointerId);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',cancel);window.removeEventListener('blur',cancel);window.removeEventListener('keydown',key);state.endGesture(owner);};
    const cancel=()=>{flushSync(()=>{state.setZoom(initialZoom);setRowHeight(initialHeight);});if(axis)node.scrollTop=g.offset;else node.scrollLeft=g.offset;end();};
    const move=(e:PointerEvent)=>{
      const delta=(axis?e.clientY:e.clientX)-origin;
      if(edge===null){const next=g.offset+delta*g.max/Math.max(1,g.length-g.thumb);if(axis)node.scrollTop=next;else node.scrollLeft=next;return;}
      const scale=axis?initialHeight:initialZoom;
      const from=g.offset/scale,to=(g.offset+g.size)/scale;
      const change=delta*g.total/g.length/scale;
      const span=Math.max(.001,to-from+(edge==='end'?change:-change));
      flushSync(()=>{if(axis)setRowHeight(Math.max(64,Math.min(180,g.size/span)));else state.setZoom(g.size/span);});
      const actualScale=axis?Math.max(64,Math.min(180,g.size/span)):useEditor.getState().zoom;
      const offset=edge==='end'?from*actualScale:to*actualScale-g.size;
      if(axis)node.scrollTop=Math.max(0,offset);else node.scrollLeft=Math.max(0,offset);
      refresh(n=>n+1);
    };
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancel();}};
    if(!state.beginGesture(owner,cancel))return;
    cancelRef.current=cancel;target.setPointerCapture(pointerId);target.addEventListener('lostpointercapture',cancel);
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',cancel);window.addEventListener('blur',cancel);window.addEventListener('keydown',key);
  };
  return <>{[false,true].map(axis=>{
    const g=geometry(axis),label=axis?'トラックの高さ':'タイムラインの拡大・縮小';
    return <div key={String(axis)} ref={axis?vertical:horizontal} className={`timeline-navigation ${axis?'vertical':'horizontal'}`} onPointerDown={event=>{if(event.target!==event.currentTarget)return;const node=view.current;if(!node)return;const rect=event.currentTarget.getBoundingClientRect(),position=axis?event.clientY-rect.top:event.clientX-rect.left;const change=position<g.start?-g.size:g.size;if(axis)node.scrollTop+=change;else node.scrollLeft+=change;}}>
      <div className="timeline-navigation-thumb" style={axis?{top:g.start,height:g.thumb}:{left:g.start,width:g.thumb}} onDoubleClick={e=>{e.preventDefault();e.stopPropagation();const node=view.current,state=useEditor.getState();if(!node||state.gestureActive)return;if(axis){setRowHeight(80);node.scrollTop=0;}else{state.setZoom((node.clientWidth-60)/Math.max(10,endTime(state.project)));node.scrollLeft=0;}}} title={axis?'ダブルクリックで標準の高さに戻す':'ダブルクリックでタイムライン全体を表示'} onPointerDown={e=>start(e,axis,null)} role="scrollbar" tabIndex={0} aria-label={axis?'タイムラインを上下に移動':'タイムラインを左右に移動'} aria-orientation={axis?'vertical':'horizontal'} aria-controls="timeline-scroll" aria-valuemin={0} aria-valuemax={Math.round(g.max)} aria-valuenow={Math.round(g.offset)} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();e.stopPropagation();const node=view.current;if(!node)return;const next=e.key==='Home'?0:e.key==='End'?g.max:g.offset+(['ArrowLeft','ArrowUp'].includes(e.key)?-1:1)*(e.shiftKey?g.size:40);if(axis)node.scrollTop=next;else node.scrollLeft=next;}}>
        {(['start','end'] as const).map(edge=><button key={edge} className={`timeline-navigation-handle ${edge}`} aria-label={`${label}（${edge==='start'?'先頭':'末尾'}の丸）`} title={`${label}：丸をドラッグ`} onPointerDown={e=>start(e,axis,edge)} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();e.stopPropagation();const factor=['ArrowUp','ArrowRight'].includes(e.key)?1.1:1/1.1;if(axis)setRowHeight(Math.max(64,Math.min(180,rowHeight*factor)));else useEditor.getState().setZoom(useEditor.getState().zoom*factor);}}/>)}
      </div>
    </div>;
  })}</>;
}
