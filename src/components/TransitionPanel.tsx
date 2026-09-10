import { linkedIds } from '../../shared/clip-links.mjs';
import { useState } from 'react';
import { useEditor } from '../store';
import { AUDIO_TRANSITIONS, VIDEO_TRANSITIONS } from '../../shared/transitions.mjs';
import type { TransitionOptions } from '../types';

export default function TransitionPanel(){
  const p=useEditor(s=>s.project),selected=useEditor(s=>s.selected);
  const [duration,setDuration]=useState(.5),[autoAudio,setAutoAudio]=useState(true);
  const related=linkedIds(p,selected),applied=p.transitions?.filter(t=>related.includes(t.toId)||related.includes(t.fromId))||[];
  const effects:[string,string,Omit<TransitionOptions,'duration'>][]=[
    ...Object.entries(VIDEO_TRANSITIONS).map(([id,name])=>[name,id==='dissolve'?'2つの映像をなめらかに重ねる':id==='pageTurn'?'ページが横に回転して開く':'右下の角を折り返してめくる',{video:id as TransitionOptions['video'],autoAudio}] as [string,string,Omit<TransitionOptions,'duration'>]),
    ...Object.entries(AUDIO_TRANSITIONS).map(([id,name])=>[name,id==='constantGain'?'音量を直線的に切り替える':'異なる音を自然につなぐ',{audio:id as TransitionOptions['audio']}] as [string,string,Omit<TransitionOptions,'duration'>])
  ];
  return <div className="transition-panel"><h3>つなぎ目の効果</h3><p>切り替え先のクリップを選んで適用。つなぎ目へのドラッグでも追加できます。</p>
    <label className="transition-duration">効果の長さ（秒）<input aria-label="トランジションの長さ" type="number" min={1/p.fps} max={60} step={1/p.fps} value={duration} onChange={e=>setDuration(Number(e.target.value))}/></label>
    <label className="transition-audio"><input type="checkbox" checked={autoAudio} onChange={e=>setAutoAudio(e.target.checked)}/>両方の映像に音声があれば、音も自然につなぐ</label>
    <div className="transition-list">{effects.map(([name,description,options])=><button key={name} draggable onDragStart={e=>{e.dataTransfer.setData('application/x-luma-transition',JSON.stringify({...options,duration}));e.dataTransfer.effectAllowed='copy';}} onClick={()=>useEditor.getState().addTransition({...options,duration})}><strong>{name}</strong><small>{description}</small></button>)}</div>
    <p className="transition-hint">カット位置と動画全体の長さを保ちます。未使用の映像を使い、足りない部分は前の最後・後ろの最初のフレームで補います。音声が足りない部分はフェードでつなぎます。効果は各クリップの半分まで。</p>
    {applied.map(t=><div className="applied-transition" key={t.id}><strong>{[t.video&&VIDEO_TRANSITIONS[t.video],t.audio&&AUDIO_TRANSITIONS[t.audio]].filter(Boolean).join(' + ')}</strong><button onClick={()=>useEditor.getState().removeTransition(t.id)}>効果を解除</button><small>{t.mode==='fixed'?'適用・解除でクリップの位置や動画の長さは変わりません。':'以前の重なりを維持しています。解除しても配置は変わりません。'}</small></div>)}
  </div>;
}
