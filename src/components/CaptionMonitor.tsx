import { useEffect, useRef, useState } from 'react';
import Preview from './Preview';
import { endTime } from '../model';
import { captionPlaybackRange } from '../youtube';
import { useEditor } from '../store';
import type { SubtitleCue } from '../types';

export default function CaptionMonitor({ cues, index, disabled, onSelect }: { cues: SubtitleCue[]; index: number; disabled: boolean; onSelect: (index: number) => boolean }) {
  const [loop, setLoop] = useState(false);
  const cue = cues[index];
  const duration = useEditor(state => endTime(state.project));
  const fps = useEditor(state => state.project.fps);
  const playable = !!captionPlaybackRange(cue, fps, duration);
  const latest = useRef({ cue, loop, disabled }); latest.current = { cue, loop, disabled: disabled || !playable };
  useEffect(() => {
    let seeking = false, alive = true;
    const unsubscribe = useEditor.subscribe((state, previous) => {
      const { cue, loop, disabled } = latest.current;
      if (seeking || disabled || !loop || !cue || cue.end <= cue.start || !previous.playing) return;
      const range = captionPlaybackRange(cue, state.project.fps, endTime(state.project));
      if (!range) return;
      if (state.playhead >= range.end || state.playhead < range.start) {
        seeking = true;
        // Preview publishes the end playhead before stopping at the sequence end.
        // Resume only after that synchronous stop has finished.
        queueMicrotask(() => {
          try {
            if (!alive || !latest.current.loop || latest.current.disabled || latest.current.cue !== cue || useEditor.getState().project !== state.project) return;
            useEditor.getState().seek(range.start);
            if (!useEditor.getState().playing) useEditor.getState().togglePlay();
          } finally { seeking = false; }
        });
      } else if (!state.playing) {
        latest.current.loop = false; setLoop(false);
      }
    });
    return () => { alive = false; unsubscribe(); };
  }, []);
  useEffect(() => { setLoop(false); useEditor.getState().stop(); }, [disabled, index, playable]);
  useEffect(() => () => useEditor.getState().stop(), []);
  const playCue = () => {
    if (disabled || !playable || !onSelect(index)) return;
    setLoop(true); latest.current.loop = true; useEditor.getState().togglePlay();
  };
  return <div className="caption-monitor">
    <fieldset disabled={disabled}><Preview readOnly/></fieldset>
    <div className="caption-monitor-controls">
      <button disabled={disabled || index <= 0} onClick={() => { setLoop(false); onSelect(index - 1); }}>前の字幕</button>
      <button disabled={disabled || !playable} aria-pressed={loop} onClick={() => { if (loop) { setLoop(false); useEditor.getState().stop(); } else playCue(); }}>{loop ? '反復再生を停止' : 'この字幕を反復再生'}</button>
      <button disabled={disabled || index >= cues.length - 1} onClick={() => { setLoop(false); onSelect(index + 1); }}>次の字幕</button>
    </div>
    {cue && !playable ? <p className="yt-notice">この字幕には再生できる長さの区間がありません。時刻を確認してください。</p> : null}
    <div className="caption-draft-preview"><strong>字幕原稿 {cue ? `${index + 1} / ${cues.length}` : ''}</strong><p>{cue?.text || '字幕を選ぶと、この位置の映像を確認できます。'}</p><small>映像への反映は「字幕をタイムラインに適用」で確定します。</small></div>
  </div>;
}
