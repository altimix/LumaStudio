import { expect, it } from 'vitest';
import { emptyProject, makeClip, makeTrack } from './model';
import { applySubtitles, emptyYoutube } from './youtube';
it('reapplies old Audio captions on Video without replacing unrelated legacy clips',()=>{
  const p=emptyProject();
  p.clips=[{...makeClip(p.tracks[2].id,0),id:'subtitle',subtitle:true,duration:2},{...makeClip(p.tracks[3].id,2),id:'legacy',duration:3}];
  p.youtube={...emptyYoutube(p),cues:[{start:0,end:2,text:'更新した字幕'}]};
  const next=applySubtitles(p),caption=next.clips.find(c=>c.subtitle)!;
  expect(next.tracks.find(t=>t.id===caption.trackId)?.kind).toBe('video');
  expect(next.clips.find(c=>c.id==='legacy')).toBe(p.clips[1]);expect(p.clips[0].trackId).toBe(p.tracks[2].id);
});

it('reuses an empty unlocked Video at 24 tracks for old Audio subtitles',()=>{
  const p=emptyProject();while(p.tracks.length<24)p.tracks.push(makeTrack('audio'));
  p.tracks[0].locked=true;
  p.clips=[{...makeClip(p.tracks[2].id,0),subtitle:true,duration:2}];
  p.youtube={...emptyYoutube(p),cues:[{start:0,end:2,text:'再適用'}]};
  const next=applySubtitles(p);expect(next.tracks).toHaveLength(24);expect(next.clips[0].trackId).toBe(p.tracks[1].id);
  p.tracks[1].locked=true;expect(()=>applySubtitles(p)).toThrow(/トラック/);expect(p.clips[0].trackId).toBe(p.tracks[2].id);
});

it.each([23,24])('reuses empty Video lanes for rounded legacy Audio subtitles starting at %i tracks',count=>{
  let p=emptyProject();while(p.tracks.length<count)p.tracks.push(makeTrack('audio'));
  p.clips=[{...makeClip(p.tracks[2].id,0),subtitle:true,duration:2}];
  p.youtube={...emptyYoutube(p),cues:[{start:0,end:1.0169,text:'先の字幕'},{start:1.0162,end:2,text:'後の字幕'}]};
  p=applySubtitles(p);expect(p.tracks).toHaveLength(24);
  const lanes=p.clips.filter(c=>c.subtitle).map(c=>c.trackId);expect(new Set(lanes).size).toBe(2);
  expect(lanes.every(id=>p.tracks.some(t=>t.id===id&&t.kind==='video'))).toBe(true);
  for(let i=0;i<3;i++){p=applySubtitles(p);expect(p.clips.filter(c=>c.subtitle).map(c=>c.trackId)).toEqual(lanes);expect(p.tracks).toHaveLength(24);}
});
