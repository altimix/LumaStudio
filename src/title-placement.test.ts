import { expect, it } from 'vitest';
import { useEditor } from './store';
import { emptyProject } from './model';
it('places titles on a visible unlocked track and keeps Undo', () => {
  const project = emptyProject(); project.tracks[0].hidden = true;
  useEditor.getState().load(project); useEditor.getState().addTitle();
  expect(useEditor.getState().project.clips[0].trackId).toBe(project.tracks[1].id);
  useEditor.getState().undo(); expect(useEditor.getState().project.clips).toHaveLength(0);
  project.tracks[1].locked = true;
  useEditor.getState().load(project); useEditor.getState().addTitle();
  expect(useEditor.getState().project.clips[0].trackId).toBe(project.tracks[2].id);
  useEditor.getState().undo();
  project.tracks.forEach(t => { t.locked = true; });
  useEditor.getState().load(project); useEditor.getState().addTitle();
  expect(useEditor.getState().project.clips).toHaveLength(0);
});
