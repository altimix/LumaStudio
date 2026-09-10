import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '../store';
import type { Project } from '../types';
import { linkedIds, clipsLocked, audioTargets, sameTiming } from '../../shared/clip-links.mjs';
import { runAudioEnhancement, useAudioJob } from '../audio-enhancement-job';
import { BGM_VOLUME_PRESETS } from '../audio-volume';
import '../clip-context-menu.css';

export interface ClipMenuAnchor { ids: string[]; x: number; y: number; element: HTMLElement; project: Project }
export default function ClipContextMenu({ anchor, onClose }: { anchor: ClipMenuAnchor; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null), p = useEditor(s => s.project), busy = useAudioJob(s => s.busy);
  const close = useRef(onClose); close.current = onClose;
  useLayoutEffect(() => {
    const element = menu.current!;
    const place = () => {
      element.style.left = `${Math.max(8, Math.min(anchor.x, window.innerWidth - element.offsetWidth - 8))}px`;
      element.style.top = `${Math.max(8, Math.min(anchor.y, window.innerHeight - element.offsetHeight - 8))}px`;
    };
    place(); element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (e: PointerEvent) => { if (!element.contains(e.target as Node)) close.current(); };
    const dismiss = () => close.current();
    window.addEventListener('pointerdown', outside, true); window.addEventListener('blur', dismiss); window.addEventListener('resize', place);
    return () => { window.removeEventListener('pointerdown', outside, true); window.removeEventListener('blur', dismiss); window.removeEventListener('resize', place); if (anchor.element.isConnected) anchor.element.focus({ preventScroll: true }); };
  }, [anchor]);
  useLayoutEffect(() => { if (p !== anchor.project) close.current(); }, [p, anchor.project]);
  const ids = anchor.ids, expanded = linkedIds(p, ids), selected = p.clips.filter(c => ids.includes(c.id));
  const audio = audioTargets(p, ids), audioLocked = clipsLocked(p, audio.map(c => c.id)), locked = clipsLocked(p, expanded);
  const canSeparate = selected.some(c => c.kind === 'video' && !c.audioDetached && p.assets.find(a => a.id === c.assetId)?.hasAudio);
  const hasLinks = selected.some(c => c.linkId), allMuted = audio.length > 0 && audio.every(c => c.audioMuted);
  const video = selected.find(c => c.kind === 'video'), sound = selected.find(c => c.kind === 'audio');
  const canLink = selected.length === 2 && video && sound && !video.linkId && !sound.linkId && video.assetId === sound.assetId && sameTiming(video, sound);
  const run = (action: () => void) => { onClose(); useEditor.getState().select(ids); action(); };
  const item = (id: string, label: string, action: () => void, disabled = false, hint?: string) => <button key={id} data-action={id} type="button" role="menuitem" tabIndex={-1} disabled={disabled} title={disabled ? hint || '対象クリップとトラックのロックを確認してください。' : undefined} onClick={() => run(action)}><span>{label}</span></button>;
  return createPortal(<div ref={menu} className="clip-context-menu" role="menu" aria-label="クリップの編集" style={{ left: anchor.x, top: anchor.y }} onContextMenu={e => e.preventDefault()} onKeyDown={e => {
    e.stopPropagation();
    const buttons = [...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (['ArrowDown','ArrowUp','Home','End'].includes(e.key)) {
      e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length; buttons[next]?.focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); onClose(); }
  }}>
    <div className="clip-menu-heading">{selected.length === 1 ? selected[0].name : `${selected.length} 個のクリップ`}<small>{hasLinks ? 'リンク相手も一緒に編集' : 'クリップを編集'}{locked ? ' · ロック中' : ''}</small></div>
    <div className="clip-menu-group" role="group" aria-label="音声の調整">
      {item('normalize','音量をノーマライズ',() => void runAudioEnhancement(ids,'normalize'),busy || !window.luma || !audio.length || audioLocked)}
      {item('speech','会話音声を聴きやすく',() => void runAudioEnhancement(ids,'speech'),busy || !window.luma || !audio.length || audioLocked)}
      {item('reset-audio','音声の自動調整を解除',() => useEditor.getState().patchAudio({audioTreatment:undefined},ids),busy || audioLocked || !audio.some(c => c.audioTreatment))}
      {item('mute',allMuted ? '音声のミュートを解除' : '音声をミュート',() => useEditor.getState().patchAudio({audioMuted:!allMuted},ids),!audio.length || audioLocked)}
    </div>
    {audio.length ? <div className="clip-menu-group" role="group" aria-label="BGM音量調整">
      <div className="clip-menu-label">BGM音量調整<small>選択した音声の100%を0 dBとして設定</small></div>
      {BGM_VOLUME_PRESETS.map(preset => {
        const checked = audio.every(c => Math.abs(c.volume - preset.volume) < 1e-9);
        return <button key={preset.db} data-action={`bgm-volume-${-preset.db}`} type="button" role="menuitemradio" aria-checked={checked} tabIndex={-1} disabled={busy || audioLocked} title={audioLocked ? '音声トラックのロックを解除してください。' : undefined} onClick={() => run(() => useEditor.getState().setBgmVolumeDb(preset.db,ids))}><span>{preset.label}に設定</span><span className="clip-menu-check" aria-hidden="true">{checked ? '✓' : ''}</span></button>;
      })}
      {item('audio-volume-properties','音量を細かく調整',() => { useEditor.getState().select(audio.map(c => c.id)); useEditor.getState().setInspectorTab('audio'); })}
    </div> : null}
    <div className="clip-menu-group" role="group" aria-label="映像と音声のリンク">
      {item('separate','音声を別トラックに表示（リンク維持）',() => useEditor.getState().separateAudio(ids),!canSeparate || locked)}
      {item('unlink','映像と音声のリンクを解除',() => useEditor.getState().unlink(ids),(!hasLinks && !canSeparate) || locked)}
      {item('relink','映像と音声を再リンク',() => useEditor.getState().relink(ids),!canLink || locked,'同じ素材区間の映像と音声をShift+クリックで2つ選択してください。')}
    </div>
    <div className="clip-menu-group" role="group" aria-label="速度と編集">
      {[.5,1,2].map(speed => item(`speed-${speed}`,`再生速度 ${speed}×${speed === 1 ? '（標準）' : ''}`,() => useEditor.getState().setRate(speed,ids),locked || !selected.every(c => ['video','audio'].includes(c.kind))))}
      {item('properties','プロパティを開く',() => useEditor.getState().setInspectorTab(selected[0]?.kind === 'audio' ? 'audio' : 'video'))}
      {item('split','再生ヘッド位置で分割　Ctrl+B',() => useEditor.getState().split(undefined,ids),locked)}
      {item('copy','コピー　Ctrl+C',() => useEditor.getState().copy())}
      {item('duplicate','複製　Ctrl+D',() => useEditor.getState().duplicate(),locked)}
      {item('delete','削除　Delete',() => useEditor.getState().remove(),locked)}
      {item('ripple-delete','リップル削除　Shift+D',() => useEditor.getState().remove(true),locked)}
    </div>
  </div>,document.body);
}
