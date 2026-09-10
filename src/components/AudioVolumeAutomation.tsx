import { Diamond, Plus, RotateCcw } from 'lucide-react';
import { volumeAt } from '../../shared/volume-automation.mjs';
import { addVolumePoint, effectiveKeys, volumeLabel } from '../volume-editing';
import { useEditor } from '../store';
import { clamp, roundFrame } from '../model';
import type { Clip } from '../types';

export default function AudioVolumeAutomation({clip}: {clip: Clip}) {
  const time=useEditor(s=>s.playhead),keys=clip.volumeKeyframes||[];
  const local=clamp(time-clip.start,0,clip.duration),gain=volumeAt(keys,local);
  const addAtPlayhead=()=>{
    const state=useEditor.getState(),current=state.project.clips.find(c=>c.id===clip.id);
    if(!current||state.gestureActive||state.project.tracks.find(t=>t.id===current.trackId)?.locked)return;
    try{
      const time=clamp(roundFrame(state.playhead-current.start,state.project.fps),0,current.duration);
      const next=addVolumePoint(current,time,state.project.fps);
      const point=next.reduce((nearest,key)=>Math.abs(key.time-time)<Math.abs(nearest.time-time)?key:nearest);
      state.stop();
      if(next!==current.volumeKeyframes)state.updateClip(current.id,{volumeKeyframes:next});
      useEditor.setState({activeVolumePoint:{clipId:current.id,time:point.time}});
      requestAnimationFrame(()=>{
        const latest=useEditor.getState();
        if(latest.activeVolumePoint?.clipId!==current.id||latest.activeVolumePoint.time!==point.time)return;
        const index=effectiveKeys({...current,volumeKeyframes:next}).findIndex(key=>key.time===point.time);
        document.querySelector<SVGElement>(`[data-clip-id="${CSS.escape(current.id)}"] [data-volume-index="${index}"]`)?.focus({preventScroll:true});
      });
    }catch(e){state.notify((e as Error).message);}
  };
  return <section className="audio-automation"><h3><Diamond size={14}/>音量ライン</h3>
    <p>現在：{volumeLabel(clip.volume,gain)}。波形上の線をダブルクリック（またはCtrl+クリック）で点を追加。点を上下で音量、左右で時刻を調整できます。</p>
    <div className="audio-automation-actions"><button className="secondary-button" onClick={addAtPlayhead}><Plus size={13}/>再生ヘッドに音量ポイントを追加</button><button className="text-button" disabled={!keys.length} onClick={()=>useEditor.getState().updateClip(clip.id,{volumeKeyframes:[]})}><RotateCcw size={13}/>音量ラインをリセット</button></div>
    <p>線の区間を上下にドラッグすると、その区間の両端を一緒に調整できます。最初の追加時は両端にも点を置きます。点を選んでDeleteで削除、←／→で1フレーム、Shift＋←／→で10フレーム移動。↑／↓で1%、Shift＋↑／↓で10%調整。0〜400%（点がないときは0〜200%）で変化し、点の間はなめらかにつながります。</p>
  </section>;
}
