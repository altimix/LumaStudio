import { useState } from 'react';
import { Sparkles, LoaderCircle } from 'lucide-react';
import { useEditor } from '../store';
import '../audio-enhancement.css';
import { useAudioJob, runAudioEnhancement, cancelAudioJob } from '../audio-enhancement-job';
import type { Clip } from '../types';
import { BGM_VOLUME_PRESETS } from '../audio-volume';
import AudioJobProgress from './AudioJobProgress';

type AdjustmentMode = 'speech' | 'normalize' | 'bgm-20' | 'bgm-15';

export default function AudioEnhancement({ clip }: { clip: Clip }) {
  const busy=useAudioJob(state=>state.busy);
  const [mode,setMode]=useState<AdjustmentMode>(clip.audioTreatment||'speech');
  const preset = BGM_VOLUME_PRESETS.find(value => `bgm${value.db}` === mode);
  const apply = () => {
    if (preset) useEditor.getState().setBgmVolumeDb(preset.db,[clip.id]);
    else if (mode === 'speech' || mode === 'normalize') void runAudioEnhancement([clip.id],mode);
  };
  return <section className="audio-enhancement"><h3><Sparkles size={15}/>音声の自動調整</h3>
    <label htmlFor="audio-treatment-mode">調整方法</label><select id="audio-treatment-mode" value={mode} disabled={busy} onChange={e => setMode(e.target.value as AdjustmentMode)}><option value="speech">会話を聴きやすく（おすすめ）</option><option value="normalize">音量をそろえる</option>{BGM_VOLUME_PRESETS.map(value => <option key={value.db} value={`bgm${value.db}`}>BGM音量 {value.label} {value.db === -20 ? '会話中心・おすすめ' : '音楽を少し大きく'}</option>)}</select>
    <p>{preset ? `${preset.db === -20 ? '会話中心の動画におすすめの出発点です。' : 'BGMをもう少し聞かせたいときに使います。'} 音量100%を0 dBとして${preset.label}に設定します。曲の元の音量は異なるため、声が聞き取りやすいか確認して微調整してください。` : <>{mode === 'speech' ? '声の大小差と低い振動音を抑え、会話の音量を整えます。' : '音の質感を保ちながら、聴感上の音量をそろえます。'} 目安 −16 LUFS。素材全体を解析して、このクリップに適用します。</>}</p>
    <div className="audio-enhancement-actions">{busy ? <button className="secondary-button" onClick={cancelAudioJob}><LoaderCircle size={14} className="spin"/>処理を中止</button> : <button className="primary-button" disabled={!preset && !window.luma} onClick={apply}><Sparkles size={14}/>{preset ? '音量を適用' : '解析して適用'}</button>}
    <button className="text-button" disabled={busy || !clip.audioTreatment} onClick={() => { useEditor.getState().patchAudio({audioTreatment:undefined},[clip.id]); }}>自動調整を解除</button></div>
    <p className="field-help">{clip.audioTreatment ? `適用中：${clip.audioTreatment === 'speech' ? '会話を聴きやすく' : '音量をそろえる'}。` : ''}元のファイルは保持されます。下の音量で仕上がりを微調整できます。</p>
    <AudioJobProgress location="inspector"/>
  </section>;
}
