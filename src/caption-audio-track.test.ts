import { expect, it } from 'vitest';
import { emptyProject, makeClip } from './model';
import { applySubtitles, emptyYoutube } from './youtube';
it('reapplies old Audio captions on Video without replacing unrelated legacy clips',()=>{
  const p=emptyProject();
  p.clips=[{...makeClip(p.tracks[2].id,0),id:'subtitle',subtitle:true,duration:2},{...makeClip(p.tracks[3].id,2),id:'legacy',duration:3}];
  p.youtube={...emptyYoutube(p),cues:[{start:0,end:2,text:'更新した字幕'}]};
  const next=applySubtitles(p),caption=next.clips.find(c=>c.subtitle)!;
  expect(next.tracks.find(t=>t.id===caption.trackId)?.kind).toBe('video');
  expect(next.clips.find(c=>c.id==='legacy')).toBe(p.clips[1]);expect(p.clips[0].trackId).toBe(p.tracks[2].id);
});
