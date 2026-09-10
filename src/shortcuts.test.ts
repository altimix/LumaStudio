import { describe, expect, it } from 'vitest';
import { shortcutCommand } from './shortcuts';
import { emptyProject, makeClip, rippleTrim } from './model';
import { useEditor } from './store';
import { opacityAt } from '../shared/opacity.mjs';
import type { Asset } from './types';
const key = (name: string, extra = {}) => ({ key: name, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, isComposing: false, repeat: false, ...extra });
describe('requested editing keys', () => {
  it('maps every requested key and preserves existing aliases', () => {
    const mapping = { '1': 'play', ' ': 'play', z: 'splitAll', q: 'trimPrevious', w: 'trimNext', a: 'zoomIn', s: 'zoomOut', e: 'backFrame', ArrowLeft: 'backFrame', r: 'forwardFrame', ArrowRight: 'forwardFrame', j: 'reverse', k: 'stop', l: 'forward', n: 'snap', v: 'selectTool', c: 'razorTool' };
    for (const [name, command] of Object.entries(mapping)) expect(shortcutCommand(key(name))).toBe(command);
    expect(shortcutCommand(key('D', { shiftKey: true }))).toBe('rippleDelete');
    expect(shortcutCommand(key('Delete', { shiftKey: true }))).toBe('rippleDelete');
    expect(shortcutCommand(key('E', { shiftKey: true }))).toBe('backTen');
    expect(shortcutCommand(key('ArrowRight', { shiftKey: true }))).toBe('forwardTen');
  });
  it('supports Command and the Mac delete key without firing during IME', () => {
    expect(shortcutCommand(key('s', { metaKey: true }))).toBe('save');
    expect(shortcutCommand(key('z', { metaKey: true, shiftKey: true }))).toBe('redo');
    expect(shortcutCommand(key('Backspace', { shiftKey: true }))).toBe('rippleDelete');
    expect(shortcutCommand(key('Backspace', { isComposing: true }))).toBeUndefined();
  });
  it('keeps Ctrl shortcuts separate from unmodified actions', () => {
    expect(shortcutCommand(key('z', { ctrlKey: true }))).toBe('undo');
    expect(shortcutCommand(key('Z', { ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(shortcutCommand(key('d', { ctrlKey: true }))).toBe('duplicate');
    expect(shortcutCommand(key('a', { ctrlKey: true }))).toBe('selectAll');
    expect(shortcutCommand(key('s', { ctrlKey: true }))).toBe('save');
    expect(shortcutCommand(key('v', { ctrlKey: true }))).toBe('paste');
    expect(shortcutCommand(key('e', { ctrlKey: true }))).toBe('export');
    expect(shortcutCommand(key('D', { ctrlKey: true, shiftKey: true }))).toBeUndefined();
  });
  it('ignores IME, Alt and destructive/shuttle repeat, but repeats frame movement', () => {
    for (const extra of [{ isComposing: true }, { keyCode: 229 }, { altKey: true }, { repeat: true }]) expect(shortcutCommand(key('z', extra))).toBeUndefined();
    expect(shortcutCommand(key('j', { repeat: true }))).toBeUndefined();
    expect(shortcutCommand(key('1', { repeat: true }))).toBeUndefined();
    expect(shortcutCommand(key('r', { repeat: true }))).toBe('forwardFrame');
  });
});
function fixture() {
  const p = emptyProject();
  const video: Asset = { id: 'video', name: 'Video', path: 'test.mp4', url: '', thumbnail: '', kind: 'video', duration: 30, width: 1280, height: 720, fps: 30, hasAudio: true, waveform: [], size: 1, codec: 'h264' };
  const audio: Asset = { ...video, id: 'audio', kind: 'audio' };
  p.assets = [video, audio];
  p.clips = [{ ...makeClip(p.tracks[1].id, 0, video), duration: 10, in: 2, speed: 2 }, { ...makeClip(p.tracks[2].id, 0, audio), duration: 10 }, { ...makeClip(p.tracks[0].id, 2), duration: 6, opacityKeyframes: [{ time: 0, value: 0 }, { time: 6, value: 1 }] }];
  p.markers = [{ id: 'inside', time: 3, label: 'inside' }, { id: 'after', time: 9, label: 'after' }];
  return p;
}
describe('ripple trimming across tracks', () => {
  it('Q removes previous edit to playhead while preserving source speed, title keys and sync', () => {
    const p = fixture(); const result = rippleTrim(p, 4, 'previous')!;
    expect(result.playhead).toBe(2); expect(result.project.assets).toBe(p.assets);
    const video = result.project.clips.filter(c => c.kind === 'video');
    expect(video.map(c => [c.start, c.in, c.duration])).toEqual([[0, 2, 2], [2, 10, 6]]);
    expect(result.project.clips.filter(c => c.kind === 'audio').map(c => [c.start, c.in, c.duration])).toEqual([[0, 0, 2], [2, 4, 6]]);
    const title = result.project.clips.find(c => c.kind === 'title')!;
    expect(title.start).toBe(2); expect(title.duration).toBe(4); expect(opacityAt(title.opacityKeyframes, 0)).toBeCloseTo(1 / 3);
    expect(result.project.markers.map(m => m.time)).toEqual([2, 7]); expect(p.clips[0].duration).toBe(10);
  });
  it('W removes playhead to next edit including clips spanning the entire interval', () => {
    const result = rippleTrim(fixture(), 4, 'next')!;
    expect(result.playhead).toBe(4);
    expect(result.project.clips.filter(c => c.kind === 'video').map(c => [c.start, c.in, c.duration])).toEqual([[0, 2, 4], [4, 18, 2]]);
    const title = result.project.clips.find(c => c.kind === 'title')!;
    expect(title.duration).toBe(2); expect(opacityAt(title.opacityKeyframes, 2)).toBeCloseTo(1 / 3);
    expect(new Set(result.project.clips.map(c => c.id)).size).toBe(result.project.clips.length);
  });
  it('keeps outer fades but clears both newly joined inner edges', () => {
    const p = fixture(); p.clips = p.clips.map(c => ({ ...c, fadeIn: 1, fadeOut: 1 }));
    for (const direction of ['previous', 'next'] as const) {
      const next = rippleTrim(p, 4, direction)!.project;
      for (const kind of ['video', 'audio']) {
        const pieces = next.clips.filter(c => c.kind === kind);
        expect(pieces.map(c => [c.fadeIn, c.fadeOut])).toEqual([[1, 0], [0, 1]]);
      }
    }
  });
  it('rejects affected locked tracks atomically without history', () => {
    const p = fixture(); p.tracks[2].locked = true; const s = useEditor.getState(); s.load(p); s.seek(4); s.rippleTrim('previous');
    expect(useEditor.getState().project).toBe(p); expect(useEditor.getState().history).toHaveLength(0); expect(useEditor.getState().toast).toContain('ロック');
  });
  it('handles gaps, exact cuts and sequence boundaries without zero length clips', () => {
    const p = fixture(); p.clips = [{ ...p.clips[0], start: 2, duration: 2 }, { ...p.clips[1], start: 6, duration: 2 }];
    expect(rippleTrim(p, 5, 'previous')!.project.clips.map(c => c.start)).toEqual([2, 5]);
    expect(rippleTrim(p, 2, 'previous')!.project.clips[0].start).toBe(0);
    expect(rippleTrim(p, 0, 'previous')).toBeNull(); expect(rippleTrim(p, 8, 'next')).toBeNull(); expect(rippleTrim(p, 9, 'previous')).toBeNull(); expect(rippleTrim(emptyProject(), 0, 'next')).toBeNull();
  });
  it('enforces the 2000 clip limit and leaves original data intact', () => {
    const p = fixture(); const c = p.clips[0]; p.clips = Array.from({ length: 2000 }, (_, i) => ({ ...c, id: `c${i}`, start: i === 0 ? 2 : 0, duration: i === 0 ? 8 : 10 }));
    expect(() => rippleTrim(p, 4, 'previous')).toThrow(/2000/); expect(p.clips).toHaveLength(2000);
  });
  it('all-track splitting needs no selection, skips locks and undoes in one operation', () => {
    const p = fixture(); p.tracks[0].locked = true; const s = useEditor.getState(); s.load(p); s.select([]); s.split(4, p.clips.map(c => c.id));
    expect(useEditor.getState().project.clips).toHaveLength(5); expect(useEditor.getState().project.clips.find(c => c.kind === 'title')).toBe(p.clips[2]); s.undo(); expect(useEditor.getState().project).toBe(p);
  });
});
describe('shuttle and history', () => {
  it('accelerates only in the same direction, resets on K/Space and starts at bounds', () => {
    const s = useEditor.getState(); s.load(fixture());
    for (const rate of [1, 2, 4, 8, 16, 16]) { s.shuttle(1); expect(useEditor.getState().shuttleRate).toBe(rate); }
    s.shuttle(-1); expect(useEditor.getState().shuttleRate).toBe(-1); s.shuttle(-1); expect(useEditor.getState().shuttleRate).toBe(-2);
    s.stop(); expect(useEditor.getState().shuttleRate).toBe(1); expect(useEditor.getState().playing).toBe(false);
    s.seek(0); s.shuttle(-1); expect(useEditor.getState().playhead).toBe(10);
    s.stop(); s.seek(10); s.shuttle(1); expect(useEditor.getState().playhead).toBe(0);
    s.togglePlay(); expect(useEditor.getState().playing).toBe(false); s.load(emptyProject()); s.shuttle(1); expect(useEditor.getState().playing).toBe(false);
  });
  it('jumps through arbitrary states and discards redo only after a new edit', () => {
    const s = useEditor.getState(); const p = fixture(); s.load(p); s.seek(4); s.rippleTrim('previous'); const cut = useEditor.getState().project;
    s.commit({ ...cut, name: 'renamed' }, '名前を変更'); s.restoreHistory(0); expect(useEditor.getState().project).toBe(p); expect(useEditor.getState().futureLabels).toEqual(['前の編集点までリップルトリム', '名前を変更']);
    s.restoreHistory(2); expect(useEditor.getState().project.name).toBe('renamed'); s.undo(); expect(useEditor.getState().project).toBe(cut);
    s.commit({ ...cut, name: 'branch' }); expect(useEditor.getState().future).toHaveLength(0); expect(useEditor.getState().futureLabels).toHaveLength(0);
  });
  it('keeps 80 history labels aligned and resets on load; invalid jumps do nothing', () => {
    const s = useEditor.getState(); const p = fixture(); s.load(p);
    for (let i = 0; i < 100; i++) s.commit({ ...p, name: `edit${i}` }, `編集${i}`);
    expect(useEditor.getState().history).toHaveLength(80); expect(useEditor.getState().historyLabels).toHaveLength(80);
    s.restoreHistory(0); expect(useEditor.getState().project.name).toBe('edit19'); expect(useEditor.getState().currentAction).toBe('編集19');
    s.restoreHistory(80); expect(useEditor.getState().currentAction).toBe('編集99');
    for (const index of [-1, 81, 0.5, NaN]) s.restoreHistory(index);
    expect(useEditor.getState().currentAction).toBe('編集99'); s.load(p); expect(useEditor.getState().historyLabels).toEqual([]); expect(useEditor.getState().futureLabels).toEqual([]); expect(useEditor.getState().currentAction).toBe('開始');
  });
});
