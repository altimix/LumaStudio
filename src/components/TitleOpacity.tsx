import { useState } from 'react';
import { Crosshair, Diamond, Plus, Trash2 } from 'lucide-react';
import { MAX_OPACITY_KEYFRAMES, opacityAt } from '../../shared/opacity.mjs';
import { clamp, roundFrame, timecode } from '../model';
import { useEditor } from '../store';
import type { Clip } from '../types';

export default function TitleOpacity({ clip, fps }: { clip: Clip; fps: number }) {
  const playhead = useEditor(s => s.playhead);
  const localTime = clamp(roundFrame(playhead - clip.start, fps), 0, clip.duration);
  const keys = clip.opacityKeyframes || [];
  const [time, setTime] = useState(String(localTime));
  const [value, setValue] = useState(String(Math.round(opacityAt(keys, localTime, clip.opacity) * 100)));
  const [error, setError] = useState('');
  const timeValue = Number(time); const opacityValue = Number(value);
  const selectedTime = clamp(roundFrame(timeValue, fps), 0, clip.duration);
  const existing = keys.some(k => Math.abs(k.time - selectedTime) < 0.000001);
  const apply = () => {
    if (time.trim() === '' || value.trim() === '' || !Number.isFinite(timeValue) || timeValue < 0 || timeValue > clip.duration || !Number.isFinite(opacityValue) || opacityValue < 0 || opacityValue > 100) {
      setError('時刻はクリップの範囲内、不透明度は0〜100%で指定してください。'); return;
    }
    if (!existing && keys.length >= MAX_OPACITY_KEYFRAMES) { setError('キーフレームは最大64個です。'); return; }
    const next = [...keys.filter(k => Math.abs(k.time - selectedTime) >= 0.000001), { time: selectedTime, value: opacityValue / 100 }].sort((a, b) => a.time - b.time);
    useEditor.getState().updateClip(clip.id, { opacityKeyframes: next }); setTime(String(selectedTime)); setError('');
  };
  const currentOpacity = opacityAt(keys, localTime, clip.opacity);
  return <div className="title-opacity">
    <div className="keyframe-readout"><span><Diamond size={13}/> 現在の不透明度</span><strong>{Math.round(currentOpacity * 100)}<small>%</small></strong></div>
    <p className="field-help">時刻はテロップ先頭からの秒数です。キーの間をなめらかに変化させます。フェード設定も反映されます。</p>
    <div className="keyframe-fields">
      <label>時刻（秒）<input aria-label="キーフレームの時刻" type="number" min={0} max={clip.duration} step={1 / fps} value={time} onChange={e => setTime(e.target.value)}/></label>
      <label>不透明度（%）<input aria-label="キーフレームの不透明度" type="number" min={0} max={100} step={1} value={value} onChange={e => setValue(e.target.value)}/></label>
    </div>
    <div className="keyframe-actions"><button type="button" className="secondary-button" aria-label="再生ヘッドの時刻を使う" title="再生ヘッドの時刻を使う" onClick={() => { setTime(String(localTime)); setValue(String(Math.round(currentOpacity * 100))); setError(''); }}><Crosshair size={14}/></button><button type="button" className="secondary-button" onClick={apply}><Plus size={13}/>{existing ? 'キーフレームを更新' : 'キーフレームを追加'}</button></div>
    {error ? <p className="keyframe-error" role="alert">{error}</p> : null}
    {keys.length ? <><div className="keyframe-list" aria-label="不透明度キーフレーム一覧">{keys.map(k => <div className="keyframe-row" key={k.time}>
      <button type="button" aria-label={`${k.time.toFixed(2)} 秒のキーフレームへ`} onClick={() => { useEditor.getState().stop(); useEditor.getState().seek(clip.start + k.time); setTime(String(k.time)); setValue(String(Math.round(k.value * 100))); setError(''); }}><Diamond size={11}/><span>{timecode(k.time, fps)}</span><strong>{Math.round(k.value * 100)}%</strong></button>
      <button type="button" className="keyframe-delete" aria-label={`${k.time.toFixed(2)} 秒のキーフレームを削除`} onClick={() => { useEditor.getState().updateClip(clip.id, { opacityKeyframes: keys.filter(key => key.time !== k.time) }); setError(''); }}><Trash2 size={12}/></button>
    </div>)}</div><p className="field-help">{keys.length} / {MAX_OPACITY_KEYFRAMES} キー · 線形補間</p></> : <p className="keyframe-empty">キーを追加すると、不透明度を時間で変化させられます。</p>}
  </div>;
}
