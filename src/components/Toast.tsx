import { useLayoutEffect, useRef, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { IconButton } from './UI';
export default function Toast({message,onClose}:{message:string;onClose:()=>void}){
  const text=useRef<HTMLSpanElement>(null),[scrollable,setScrollable]=useState(false);
  useLayoutEffect(()=>{const element=text.current!;const update=()=>setScrollable(element.scrollHeight>element.clientHeight||element.scrollWidth>element.clientWidth);update();const observer=new ResizeObserver(update);observer.observe(element);return()=>observer.disconnect();},[message]);
  return <div className="toast" role="status"><CheckCircle2 size={17}/><span ref={text} className={scrollable?'scrollable':undefined} tabIndex={scrollable?0:undefined} onKeyDown={event=>{if(scrollable){event.stopPropagation();if(event.key==='Escape')onClose();}}}>{message}</span><IconButton label="通知を閉じる" onClick={onClose}><X size={13}/></IconButton></div>;
}
