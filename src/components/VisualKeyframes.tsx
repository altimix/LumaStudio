import { ChevronLeft, ChevronRight, Diamond, Plus, Trash2 } from 'lucide-react';
import { useEditor } from '../store';
import { timecode } from '../model';
import { visualClipAt, visualKeys, MAX_VISUAL_KEYFRAMES } from '../../shared/visual-keyframes.mjs';
import { visualChannels, channelText, channelValue, resolveVisualChannel } from '../visual-channels';
import { addVisualPoint, localVisualTime, removeVisualPoint } from '../visual-editing';
import type { Clip } from '../types';
import './visual-keyframes.css';

export default function VisualKeyframes({ clip }: { clip: Clip }) {
  const project = useEditor(state => state.project), playhead = useEditor(state => state.playhead), selected = useEditor(state => state.visualChannel);
  const keys = visualKeys(clip), at = localVisualTime(clip, playhead, project.fps), channels = visualChannels(clip, project), channel = resolveVisualChannel(channels, selected);
  const numeric = channel.min !== undefined && channel.max !== undefined;
  const evaluated = visualClipAt(clip, at), value = channelValue(evaluated, channel.path);
  const hasNumber = numeric && typeof value === 'number' && Number.isFinite(value);
  const tab = useEditor(state => state.inspectorTab);
  const channelTab = ['exposure', 'contrast', 'saturation', 'chromaKey'].includes(channel.path.split('.')[0]) ? 'color' : 'video';
  const tabLabel = channelTab === 'color' ? 'カラー' : clip.graphic ? '図形' : clip.kind === 'title' ? 'テキスト' : 'ビデオ';
  const otherTab = tab !== channelTab;
  const controlHelp = channel.path.startsWith('videoMask.points.') ? 'この座標はモニターの点・ハンドルで調整します。'
    : ['shadowBlur', 'shadowDistance'].includes(channel.path) && evaluated.textShadow === false ? '影はオフです。「影・縁取りを調整」で影を有効にすると、数値欄を表示できます。'
    : channel.path === 'strokeWidth' && !evaluated.textStroke ? '縁取りはオフです。「影・縁取りを調整」で縁取りを有効にすると、数値欄を表示できます。'
    : channel.path === 'captionBackgroundOpacity' && evaluated.textStyle !== 'subtitle' ? 'スタイルを「字幕」にすると、背景の濃さの数値欄を表示できます。'
    : '数値欄がある項目は、対応する欄を黄緑の枠で表示します。';
  const current = keys.find(key => Math.abs(key.time - at) < 1e-7), previous = keys.filter(key => key.time < at - 1e-7).at(-1), next = keys.find(key => key.time > at + 1e-7);
  const seek = (time: number) => { const editor = useEditor.getState(); editor.stop(); editor.seek(clip.start + time); };
  return <div className="visual-keyframes-panel">
    <label className="visual-channel-label">線で表示する設定<select aria-label="キーフレームの表示項目" value={channel.path} onChange={event => useEditor.setState({ visualChannel: event.target.value })}>{channels.map(item => <option key={item.path} value={item.path}>{item.label}</option>)}</select></label>
    {keys.length ? <div className="visual-channel-status" role="status"><Diamond size={12}/><span>{hasNumber ? 'ラインの高さ' : 'ラインの表示項目'}：<strong>{channel.label}</strong></span></div> : null}
    <div className="keyframe-readout"><span>{timecode(at, project.fps)}</span><strong>{channelText(evaluated, channel)}</strong></div>
    {keys.length ? <p className="field-help visual-channel-help">{numeric ? !hasNumber ? 'この時刻では数値が未設定です。数値がない区間のラインは中央に表示し、値の大小を示しません。設定がある時刻を選ぶか、エフェクトの種類・有効状態を確認してください。' : `上ほど値が大きくなります。${otherTab ? `対応する設定は「${tabLabel}」タブにあります。` : controlHelp}` : 'この項目は高さで値を表せないため、ラインは一定の高さです。値は上の表示とポイント一覧で確認できます。'}</p> : null}
    {keys.length && otherTab ? <button type="button" className="secondary-button" onClick={() => useEditor.getState().setInspectorTab(channelTab)}>「{tabLabel}」タブで設定を表示</button> : null}
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
