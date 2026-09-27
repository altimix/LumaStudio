import { expect, it } from 'vitest';
import { emptyProject, makeClip } from './model';
import { useEditor } from './store';
it('monitor selection requests reveal without editing time, project or history, and resets on load',()=>{
  const p=emptyProject();p.clips=[makeClip(p.tracks[0].id,0),makeClip(p.tracks[1].id,0)];
  const s=useEditor.getState();s.load(p);s.seek(1);const before=useEditor.getState();
  s.selectFromMonitor(p.clips[1].id);const next=useEditor.getState();
  expect(next.selected).toEqual([p.clips[1].id]);expect(next.project).toBe(before.project);
  expect(next.playhead).toBe(before.playhead);expect(next.history).toBe(before.history);expect(next.dirty).toBe(false);
  s.selectFromMonitor(p.clips[1].id);expect(useEditor.getState().monitorSelection?.revision).toBe(2);
  s.selectFromMonitor('missing');expect(useEditor.getState().monitorSelection?.revision).toBe(2);
  s.load(p);expect(useEditor.getState().monitorSelection).toBeNull();
});
