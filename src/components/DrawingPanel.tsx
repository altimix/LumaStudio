import { useEffect, useRef } from 'react';
import { ArrowUpRight, Square, Circle, Play, MousePointer2 } from 'lucide-react';
import { useEditor } from '../store';
import { graphicFromPoints } from '../../shared/graphics.mjs';
import { SOUNDS } from '../../shared/sounds.mjs';
import { loadSound, loadSoundForTimeline } from '../sounds';
import './drawing.css';
export default function DrawingPanel(){
  const tool=useEditor(s=>s.drawTool),settings=useEditor(s=>s.drawSettings),busy=useEditor(s=>s.gestureActive),audio=useRef<HTMLAudioElement|null>(null),alive=useRef(true),centerAttempt=useRef<object|null>(null),sampleAttempt=useRef<object|null>(null);
  useEffect(()=>{alive.current=true;
    const stopSample=()=>{sampleAttempt.current=null;audio.current?.pause();};
    const cancel=()=>{const attempt=centerAttempt.current;if(attempt){centerAttempt.current=null;useEditor.getState().endGesture(attempt);}};
    const unsubscribe=useEditor.subscribe((state,previous)=>{
      if(state.project!==previous.project||state.panel!==previous.panel||state.drawSettings.sound!==previous.drawSettings.sound)stopSample();
      if(state.project!==previous.project||state.panel!==previous.panel||state.drawTool!==previous.drawTool)cancel();
      if(audio.current)audio.current.volume=Math.min(1,state.drawSettings.volume);
    });
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){cancel();stopSample();}};window.addEventListener('keydown',key);
    return()=>{alive.current=false;unsubscribe();stopSample();cancel();window.removeEventListener('keydown',key);};
  },[]);
  const patch=(value:Partial<typeof settings>)=>useEditor.setState({drawSettings:{...settings,...value}});
  const sample=async()=>{
    if(settings.sound==='none')return;const attempt={};sampleAttempt.current=attempt;audio.current?.pause();
    try{const source=await loadSound(settings.sound);if(!alive.current||sampleAttempt.current!==attempt||useEditor.getState().drawSettings.sound!==settings.sound)return;audio.current=new Audio(source.url);audio.current.volume=Math.min(1,useEditor.getState().drawSettings.volume);await audio.current.play();}
    catch(error){if(alive.current&&sampleAttempt.current===attempt)useEditor.getState().notify((error as Error).message);}
  };
  const centered=async()=>{
    if(!tool||busy)return;const s=useEditor.getState(),p=s.project,attempt={};if(!s.beginGesture(attempt,()=>{if(centerAttempt.current===attempt)centerAttempt.current=null;s.endGesture(attempt);}))return;centerAttempt.current=attempt;s.stop();
    try{const sound=settings.sound==='none'?undefined:await loadSoundForTimeline(settings.sound,p.fps);if(!alive.current||centerAttempt.current!==attempt||useEditor.getState().gestureOwner!==attempt||useEditor.getState().project!==p||useEditor.getState().drawTool!==tool)return;const points=graphicFromPoints(tool,{x:p.width*.3,y:p.height*.4},{x:p.width*.7,y:tool==='arrow'?p.height*.4:p.height*.6},p.width,p.height);s.endGesture(attempt);s.addDrawing({...points,start:s.playhead,x:0,y:0,color:settings.color,duration:settings.duration},sound,settings.volume);}catch(error){if(centerAttempt.current===attempt)s.notify((error as Error).message);}finally{if(centerAttempt.current===attempt){centerAttempt.current=null;s.endGesture(attempt);}}
  };
  return <div className="drawing-panel"><h3>見せたい場所を、わかりやすく。</h3><p>図形を選び、プレビューをドラッグしてください。追加後も移動・サイズ・色・表示時間を調整できます。</p><fieldset disabled={busy}>
    <div className="drawing-tools">{[{id:'arrow',label:'矢印を描く',icon:ArrowUpRight},{id:'rectangle',label:'四角で囲む',icon:Square},{id:'ellipse',label:'丸で囲む',icon:Circle}].map(t=><button key={t.id} className={tool===t.id?'active':''} aria-pressed={tool===t.id} onClick={()=>{useEditor.getState().stop();useEditor.setState({drawTool:t.id as typeof tool});}}><t.icon size={23}/>{t.label}</button>)}</div>
    <label className="drawing-setting">線の色<input type="color" value={settings.color} onChange={e=>patch({color:e.target.value})}/></label>
    <label className="drawing-setting">表示時間（秒）<input type="number" min={.1} max={60} step={.1} value={settings.duration} onChange={e=>{const n=Number(e.target.value);if(n>=.1&&n<=60)patch({duration:n});}}/></label>
    <div className="drawing-sound"><h4>注目させる効果音</h4><label>図形と同時に追加<select aria-label="図形と同時に追加" value={settings.sound} onChange={e=>{audio.current?.pause();patch({sound:e.target.value as typeof settings.sound});}}><option value="none">効果音なし</option>{SOUNDS.map(s=><option key={s.id} value={s.id}>{s.name}（{s.duration}秒）</option>)}</select></label>
    {settings.sound!=='none'?<><label>効果音の音量<input aria-label="追加する効果音の音量" type="range" min={0} max={100} value={settings.volume*100} onChange={e=>patch({volume:Number(e.target.value)/100})}/><span>{Math.round(settings.volume*100)}%</span></label><button className="secondary-button" onClick={()=>void sample()}><Play size={14}/>効果音を試聴</button></>:null}<p>オリジナルの合成音を同梱。追加した音はタイムラインで個別に編集できます。</p></div>
    <button className="secondary-button" disabled={!tool} onClick={()=>void centered()}>選択した図形を中央に追加</button><button className="text-button drawing-cancel" onClick={()=>useEditor.setState({drawTool:null})}><MousePointer2 size={14}/>図形の描画を終了</button>
  </fieldset></div>;
}
