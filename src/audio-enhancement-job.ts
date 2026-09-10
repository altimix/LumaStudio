import { create } from 'zustand';
import { useEditor } from './store';
import { audioTargets, clipsLocked } from '../shared/clip-links.mjs';
import { uid } from './model';
import { AUDIO_PHASE_LABELS, audioWorkItems } from './audio-job-progress';
import type { AudioPreparePhase } from './types';

export const useAudioJob = create<{
  busy: boolean; message: string; progress: number | null; phase: AudioPreparePhase;
  startedAt: number | null; finishedAt: number | null; updatedAt: number | null;
}>(() => ({ busy: false, message: '', progress: null, phase: 'preparing', startedAt: null, finishedAt: null, updatedAt: null }));
let active: { cancelled: boolean } | undefined;
export function cancelAudioJob() {
  if (!active) return;
  active.cancelled = true;
  useAudioJob.setState({ message: '音声の調整を中止しています…' });
  void window.luma?.cancelAudioPrepare()?.catch(() => {});
}
export async function runAudioEnhancement(ids: string[], mode: 'normalize' | 'speech') {
  if (!window.luma || active) return;
  const state = useEditor.getState(), snapshot = state.project, targets = audioTargets(snapshot, ids);
  if (state.gestureActive || !targets.length || clipsLocked(snapshot, targets.map(c => c.id))) { state.notify('音声のある、ロックされていないクリップを選択してください。'); return; }
  const job = { cancelled: false }; active = job; state.stop();
  const startedAt = Date.now();
  useAudioJob.setState({ busy: true, message: '素材全体の音声を準備しています…', progress: 0, phase: 'preparing', startedAt, finishedAt: null, updatedAt: startedAt });
  const work = audioWorkItems(snapshot, targets), total = work.reduce((sum, item) => sum + item.duration, 0);
  let completed = 0, current: { id: string; index: number; duration: number; name: string } | undefined;
  const offProgress = window.luma.onAudioPrepareProgress?.(event => {
    if (active !== job || job.cancelled || !current || event.requestId !== current.id || !Number.isFinite(event.progress) || event.progress < 0 || event.progress > 1 || !Object.hasOwn(AUDIO_PHASE_LABELS, event.phase)) return;
    const before = useAudioJob.getState();
    const progress = Math.max(before.progress || 0, Math.min(.99, (completed + current.duration * event.progress) / total));
    useAudioJob.setState({ progress, phase: event.phase,
      message: `${AUDIO_PHASE_LABELS[event.phase]} ${current.index + 1} / ${work.length}：${current.name}`,
      updatedAt: progress > (before.progress || 0) || before.phase !== event.phase ? Date.now() : before.updatedAt });
  }) || (() => {});
  // Any edit, load, undo or lock change invalidates this immutable snapshot. Selection changes are safe.
  const unsubscribe = useEditor.subscribe(current => { if (active === job && current.project !== snapshot && !job.cancelled) cancelAudioJob(); });
  try {
    let last;
    for (let i = 0; i < work.length; i++) {
      if (job.cancelled) throw Error('編集内容が変わったか、処理が中止されました。調整は適用していません。');
      current = { id: uid(), index: i, duration: work[i].duration, name: work[i].clip.name };
      useAudioJob.setState({ phase: 'preparing', message: `音声を準備中 ${i + 1} / ${work.length}：${current.name}` });
      last = await window.luma.prepareAudio(snapshot, work[i].clip.id, mode, current.id);
      if (job.cancelled) throw Error('編集内容が変わったか、処理が中止されました。調整は適用していません。');
      completed += current.duration; current = undefined;
      useAudioJob.setState({ progress: Math.min(.99, completed / total), updatedAt: Date.now() });
    }
    if (job.cancelled || useEditor.getState().project !== snapshot) throw Error('編集内容が変わったか、処理が中止されました。調整は適用していません。');
    unsubscribe(); // The following atomic commit belongs to this completed job.
    const targetIds = new Set(targets.map(c => c.id));
    if (!useEditor.getState().commit({ ...snapshot, clips: snapshot.clips.map(c => targetIds.has(c.id) ? { ...c, audioTreatment: mode } : c) }, mode === 'speech' ? '会話音声を最適化' : '音量をノーマライズ')) throw Error('調整を適用できませんでした。');
    useAudioJob.setState({ progress: 1, phase: 'complete', message: `${targets.length} 個に適用しました（素材 ${work.length} 件）。調整後 ${last!.outputLufs.toFixed(1)} LUFS · ピーク ${last!.peak.toFixed(1)} dBTP` });
  } catch (error) {
    useAudioJob.setState({ message: job.cancelled ? '編集内容が変わったか、処理が中止されました。調整は適用していません。' : (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '') });
  } finally { offProgress(); unsubscribe(); if (active === job) active = undefined; useAudioJob.setState({ busy: false, finishedAt: Date.now() }); }
}

useEditor.subscribe((current,previous)=>{if(current.project!==previous.project&&!useAudioJob.getState().busy)useAudioJob.setState({message:''});});
