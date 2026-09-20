import { ChevronLeft, ChevronRight, Diamond, Plus, Trash2 } from 'lucide-react';
import { useEditor } from '../store';
import { timecode } from '../model';
import { visualClipAt, visualKeys, MAX_VISUAL_KEYFRAMES } from '../../shared/visual-keyframes.mjs';
import { visualChannels, channelText } from '../visual-channels';
import { addVisualPoint, localVisualTime, removeVisualPoint } from '../visual-editing';
import type { Clip } from '../types';
import './visual-keyframes.css';

export default function VisualKeyframes({ clip }: { clip: Clip }) {
  const project = useEditor(state => state.project), playhead = useEditor(state => state.playhead), selected = useEditor(state => state.visualChannel);
  const keys = visualKeys(clip), at = localVisualTime(clip, playhead, project.fps), channels = visualChannels(clip, project), channel = channels.find(item => item.path === selected) ?? channels[4];
  const current = keys.find(key => Math.abs(key.time - at) < 1e-7), previous = keys.filter(key => key.time < at - 1e-7).at(-1), next = keys.find(key => key.time > at + 1e-7);
  const seek = (time: number) => { const editor = useEditor.getState(); editor.stop(); editor.seek(clip.start + time); };
  return <div className="visual-keyframes-panel">
    <label className="visual-channel-label">線で表示する設定<select aria-label="キーフレームの表示項目" value={channel.path} onChange={event => useEditor.setState({ visualChannel: event.target.value })}>{channels.map(item => <option key={item.path} value={item.path}>{item.label}</option>)}</select></label>
    <div className="keyframe-readout"><span>{timecode(at, project.fps)}</span><strong>{channelText(visualClipAt(clip, at), channel)}</strong></div>
    <div className="visual-keyframe-actions">
      <button type="button" className="secondary-button" aria-label="前のキーフレーム" disabled={!previous} onClick={() => previous && seek(previous.time)}><ChevronLeft size={14}/></button>
      <button type="button" className="secondary-button" aria-label="再生ヘッドにキーフレームを追加" disabled={!!current} onClick={() => addVisualPoint(clip.id)}><Plus size={13}/><Diamond size={12}/>追加</button>
      <button type="button" className="secondary-button" aria-label="現在のキーフレームを削除" disabled={!current} onClick={() => current && removeVisualPoint(clip.id, current.time)}><Trash2 size={13}/></button>
      <button type="button" className="secondary-button" aria-label="次のキーフレーム" disabled={!next} onClick={() => next && seek(next.time)}><ChevronRight size={14}/></button>
    </div>
    <p className="field-help">{keys.length ? 'この時刻のプロパティ変更をキーに記録します。線をダブルクリックするとポイントを追加できます。' : 'キーを追加すると、位置・色・サイズなどを時間に合わせて変化させられます。'}</p>
    {keys.length ? <details className="visual-keyframe-list"><summary>ポイント一覧（{keys.length} / {MAX_VISUAL_KEYFRAMES}）</summary>{keys.map(key => <div className="keyframe-row" key={key.time}>
      <button type="button" aria-label={`${key.time.toFixed(2)} 秒のキーフレームへ`} aria-pressed={key === current} onClick={() => seek(key.time)}><Diamond size={11}/><span>{timecode(key.time, project.fps)}</span><strong>{channelText(visualClipAt(clip, key.time), channel)}</strong></button>
      <button type="button" className="keyframe-delete" aria-label={`${key.time.toFixed(2)} 秒のキーフレームを削除`} onClick={() => removeVisualPoint(clip.id, key.time)}><Trash2 size={12}/></button>
    </div>)}</details> : null}
  </div>;
}
