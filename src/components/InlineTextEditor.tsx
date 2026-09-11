import { useLayoutEffect, useRef, useState } from 'react';
import type { Clip, Project } from '../types';
import { initialTextBox } from '../render';
import './text-box.css';

export default function InlineTextEditor({clip,project,onFinish}:{clip:Clip;project:Project;onFinish:(commit:boolean,text?:string)=>void}) {
  const [draft,setDraft]=useState(clip.text),input=useRef<HTMLTextAreaElement>(null),composing=useRef(false);
  const box=initialTextBox(clip,project.width,project.height);
  useLayoutEffect(()=>{input.current?.focus();input.current?.select();},[]);
  return <>
    <div className="inline-text-surface" style={{left:(50+clip.x)+'%',top:(50+clip.y)+'%',width:box.width/project.width*100+'%',height:box.height/project.height*100+'%',transform:`translate(-50%,-50%) rotate(${clip.rotation}deg) scale(${clip.scale})`}}>
      <textarea ref={input} aria-label="プレビューでテキストを編集" maxLength={4000} value={draft} spellCheck={false} onChange={e=>setDraft(e.target.value)} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}}
        onBlur={()=>onFinish(true,draft)}
        onKeyDown={e=>{e.stopPropagation();if(composing.current||e.nativeEvent.isComposing||e.keyCode===229)return;if(e.key==='Escape'){e.preventDefault();onFinish(false);}else if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();onFinish(true,draft);}}}/>
    </div>
  </>;
}
