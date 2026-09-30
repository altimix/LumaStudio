import { numberTracks } from './track-names';
import { expect, it } from 'vitest';
import { emptyProject, makeClip, makeTrack } from './model';
import { separateOverlappingClips } from './track-placement';
import { useEditor } from './store';

it('reuses an available audio interval so overlapping AV placement fits the last track, with Undo/Redo',()=>{
  const p=emptyProject(),s=useEditor.getState();
  p.assets=[{id:'source',name:'source',path:'source.mp4',url:'',thumbnail:'',kind:'video',duration:3,width:320,height:180,fps:30,hasAudio:true,waveform:[],size:1,codec:'h264'}];
  while(p.tracks.length<23)p.tracks.push(makeTrack('video','追加'));
  const videoTrack=p.tracks[1].id,audioTrack=p.tracks[2].id;
  p.clips=[{...makeClip(videoTrack,0,p.assets[0]),id:'old',audioMuted:true},{...makeClip(audioTrack,3,p.assets[0]),id:'later',kind:'audio'}];
  p.tracks=numberTracks(p).tracks;s.load(p);s.addAsset('source',0,videoTrack);
  const next=useEditor.getState().project;expect(next.tracks).toHaveLength(24);expect(next.clips).toHaveLength(4);
  const [video,audio]=next.clips.slice(2);expect(video.trackId).not.toBe(videoTrack);expect(audio.trackId).toBe(audioTrack);
  expect(audio.linkId).toBe(video.linkId);expect(audio.start).toBe(0);expect(video.start).toBe(0);expect(next.clips.slice(0,2)).toEqual(p.clips);
  s.undo();expect(useEditor.getState().project).toEqual(p);s.redo();expect(useEditor.getState().project).toEqual(next);
});

it('does not reuse locked, differently muted/soloed, or occupied audio intervals at capacity',()=>{
  for(const blocked of ['locked','muted','solo','occupied'] as const){
    const p=emptyProject(),s=useEditor.getState();
    p.assets=[{id:'source',name:'source',path:'source.mp4',url:'',thumbnail:'',kind:'video',duration:3,width:320,height:180,fps:30,hasAudio:true,waveform:[],size:1,codec:'h264'}];
    while(p.tracks.length<23)p.tracks.push(makeTrack('video','追加'));
    p.clips=[{...makeClip(p.tracks[1].id,0,p.assets[0]),id:'old',audioMuted:true}];
    for(const t of p.tracks.filter(t=>t.kind==='audio')){
      if(blocked==='occupied')p.clips.push({...makeClip(t.id,0,p.assets[0]),id:t.id,kind:'audio'});
      else t[blocked]=true;
    }
    p.tracks=numberTracks(p).tracks;s.load(p);s.addAsset('source',0,p.tracks[1].id);expect(useEditor.getState().project).toBe(p);expect(useEditor.getState().history).toHaveLength(0);
  }
});

it('separates arrow/box/caption placements without changing time or existing objects',()=>{
  const p=emptyProject(),track=p.tracks[0];p.clips=[0,1,2].map(i=>({...makeClip(track.id,2.017),id:String(i),duration:3}));
  const next=separateOverlappingClips(p,['1','2']);
  expect(next.tracks.length).toBe(p.tracks.length+2);
  expect(new Set(next.clips.map(c=>c.trackId)).size).toBe(3);
  expect(next.clips[0]).toBe(p.clips[0]);
  next.clips.forEach((clip,i)=>expect({...clip,trackId:track.id}).toEqual(p.clips[i]));
  expect(p.tracks).toHaveLength(4);
});
it('treats touching edges as non-overlapping and shares a new lane for an entire caption batch',()=>{
  const p=emptyProject(),id=p.tracks[0].id;
  p.clips=[{...makeClip(id,1),id:'old',duration:2},...[0,2,4].map((start,i)=>({...makeClip(id,start),id:`n${i}`,duration:2}))];
  const next=separateOverlappingClips(p,['n0','n1','n2']);expect(next.tracks).toHaveLength(5);
  expect(new Set(next.clips.slice(1).map(c=>c.trackId)).size).toBe(1);
  expect(next.clips[0]).toBe(p.clips[0]);
  expect(separateOverlappingClips({...p,clips:p.clips.slice(1)},['n1','n2']).tracks).toHaveLength(4);
});
it('leaves imported overlaps alone unless those clips are placed, and rejects locks/capacity atomically',()=>{
  const p=emptyProject();p.clips=[0,1].map(i=>({...makeClip(p.tracks[0].id,0),id:String(i)}));
  expect(separateOverlappingClips(p,[])).toBe(p);
  p.tracks[0].locked=true;expect(()=>separateOverlappingClips(p,['1'])).toThrow(/ロック/);p.tracks[0].locked=false;
  while(p.tracks.length<24)p.tracks.push(makeTrack('video','追加'));
  expect(()=>separateOverlappingClips(p,['1'])).toThrow(/24/);expect(p.clips[1].trackId).toBe(p.tracks[0].id);expect(p.tracks).toHaveLength(24);
});
it('retains mute/solo/hidden behavior and places new video tracks above the original',()=>{
  const p=emptyProject();p.tracks[0]={...p.tracks[0],muted:true,solo:true,hidden:true};
  p.clips=[0,1].map(i=>({...makeClip(p.tracks[0].id,0),id:String(i)}));
  const next=separateOverlappingClips(p,['1']);expect(next.tracks[0]).toMatchObject({muted:true,solo:true,hidden:true,kind:'video'});
  expect(next.clips[1].trackId).toBe(next.tracks[0].id);expect(next.tracks[1]).toBe(p.tracks[0]);
});
it('stores title auto-placement and tracks in one Undo step, with stable Redo IDs',()=>{
  const p=emptyProject(),s=useEditor.getState();p.tracks=numberTracks(p).tracks;s.load(p);s.seek(0);s.addTitle('minimal');const one=useEditor.getState().project;
  s.addTitle('subtitle');const two=useEditor.getState().project;
  expect(two.tracks).toHaveLength(5);expect(two.clips[0].trackId).not.toBe(two.clips[1].trackId);expect(two.clips[1].start).toBe(0);
  s.undo();expect(useEditor.getState().project).toEqual(one);s.redo();expect(useEditor.getState().project).toEqual(two);
  const tracks=two.tracks;s.updateClip(two.clips[0].id,{text:'変更'});expect(useEditor.getState().project.tracks).toEqual(tracks);
});
it('pastes linked audio and video at the original times on distinct fresh lanes',()=>{
  const p=emptyProject(),s=useEditor.getState();
  p.assets=[{id:'source',name:'source',path:'source.mp4',url:'',thumbnail:'',kind:'video',duration:20,width:320,height:180,fps:30,hasAudio:true,waveform:[],size:1,codec:'h264'}];
  const v={...makeClip(p.tracks[1].id,2.017),id:'v',kind:'video' as const,assetId:'source',audioDetached:true,linkId:'pair'};
  p.clips=[v,{...v,id:'a',kind:'audio',trackId:p.tracks[2].id,audioDetached:undefined}];p.tracks=numberTracks(p).tracks;s.load(p);s.select(['v']);s.copy();useEditor.setState({playhead:2.017});s.paste();
  const next=useEditor.getState().project,copies=next.clips.slice(2);expect(next.tracks).toHaveLength(6);expect(copies.every(c=>c.start===2.017)).toBe(true);
  expect(copies[0].linkId).toBe(copies[1].linkId);expect(copies[0].linkId).not.toBe('pair');
  copies.forEach((c,i)=>expect(c.trackId).not.toBe(p.clips[i].trackId));expect(next.clips.slice(0,2)).toEqual(p.clips);
  expect(copies[0].trackId).toBe(next.tracks[0].id);expect(copies[1].trackId).toBe(next.tracks.at(-1)!.id);
  expect(next.tracks.slice(1,-1)).toEqual(p.tracks);
  s.undo();expect(useEditor.getState().project).toEqual(p);s.redo();expect(useEditor.getState().project).toEqual(next);
});

it('preserves the source layer order when pasting several tracks regardless of clip creation order',()=>{
  for(const reversed of [false,true]){
    const p=emptyProject(),s=useEditor.getState();p.tracks=numberTracks(p).tracks;
    const top={...makeClip(p.tracks[0].id,0),id:'top',name:'前景',text:'前景'};
    const bottom={...makeClip(p.tracks[1].id,0),id:'bottom',name:'背景',text:'背景'};
    p.clips=reversed?[bottom,top]:[top,bottom];
    s.load(p);s.select(['top','bottom']);s.copy();s.seek(0);s.paste();
    const next=useEditor.getState().project,copies=next.clips.slice(2);
    expect(copies.find(c=>c.name===top.name)!.trackId).toBe(next.tracks[0].id);
    expect(copies.find(c=>c.name===bottom.name)!.trackId).toBe(next.tracks[1].id);
    expect(next.tracks.slice(2)).toEqual(p.tracks);expect(next.clips.slice(0,2)).toEqual(p.clips);
    expect(copies.every(c=>c.start===0)).toBe(true);
    s.undo();expect(useEditor.getState().project).toEqual(p);s.redo();expect(useEditor.getState().project).toEqual(next);
  }
});

it('keeps copied foreground above copied background when only one source lane collides',()=>{
  for(const blocked of ['top','bottom']){
    const p=emptyProject(),s=useEditor.getState();p.tracks=numberTracks(p).tracks;
    const top={...makeClip(p.tracks[0].id,0),id:'top',name:'前景'};
    const bottom={...makeClip(p.tracks[1].id,0),id:'bottom',name:'背景'};
    p.clips=[bottom,top,{...(blocked==='top'?top:bottom),id:'blocker',start:10,name:'既存'}];
    s.load(p);s.select(['top','bottom']);s.copy();s.seek(10);s.paste();
    const next=useEditor.getState().project,copies=next.clips.slice(3);
    const layer=(name:string)=>next.tracks.findIndex(t=>t.id===copies.find(c=>c.name===name)!.trackId);
    expect(layer(top.name)).toBeLessThan(layer(bottom.name));
    const added=blocked==='bottom'?2:1;
    expect(next.tracks.slice(added)).toEqual(p.tracks);expect(next.clips.slice(0,3)).toEqual(p.clips);
    expect(copies.every(c=>c.start===10)).toBe(true);
    s.undo();expect(useEditor.getState().project).toEqual(p);s.redo();expect(useEditor.getState().project).toEqual(next);
  }
});

it('rejects a batch atomically if preserving its layer order would exceed the track limit',()=>{
  const p=emptyProject(),s=useEditor.getState();while(p.tracks.length<23)p.tracks.push(makeTrack('video','追加'));
  const top={...makeClip(p.tracks[0].id,0),id:'top'},bottom={...makeClip(p.tracks[1].id,0),id:'bottom'};
  p.clips=[top,bottom,{...bottom,id:'blocker',start:10}];p.tracks=numberTracks(p).tracks;
  s.load(p);s.select(['top','bottom']);s.copy();s.seek(10);const before=useEditor.getState();s.paste();
  expect(useEditor.getState().project).toBe(p);expect(useEditor.getState().history).toEqual(before.history);expect(useEditor.getState().selected).toEqual(before.selected);
});

it('adds an overlapping imported video above all existing lanes and its audio below them',()=>{
  const p=emptyProject(),s=useEditor.getState();
  const asset={id:'outer-source',name:'映像',path:'video.mp4',url:'',thumbnail:'',kind:'video' as const,duration:3,width:320,height:180,fps:30,hasAudio:true,waveform:[],size:1,codec:'h264'};
  p.assets=[asset];
  p.tracks[0]={...p.tracks[0],name:'最上段の字幕',autoName:false};
  p.clips=p.tracks.map((track,i)=>({...makeClip(track.id,0,asset),id:`existing-${i}`,kind:track.kind,audioMuted:true}));
  s.load(p);s.addAsset(asset.id,0,p.tracks[1].id);
  const next=useEditor.getState().project,added=next.clips.slice(p.clips.length);
  expect(next.tracks.slice(1,-1)).toEqual(p.tracks);expect(next.clips.slice(0,p.clips.length)).toEqual(p.clips);
  expect(next.tracks[0].name).toBe('Video3');expect(next.tracks.at(-1)!.name).toBe('Audio3');
  expect(added.find(c=>c.kind==='video')!.trackId).toBe(next.tracks[0].id);
  expect(added.find(c=>c.kind==='audio')!.trackId).toBe(next.tracks.at(-1)!.id);
  expect(added[0].linkId).toBe(added[1].linkId);
  s.undo();expect(useEditor.getState().project).toEqual(p);s.redo();expect(useEditor.getState().project).toEqual(next);
});
it('rejects an overlapping addition at track capacity without changing project/history/selection',()=>{
  const p=emptyProject(),s=useEditor.getState();while(p.tracks.length<24)p.tracks.push(makeTrack('video','追加'));
  p.clips=[makeClip(p.tracks[0].id,0)];p.tracks=numberTracks(p).tracks;s.load(p);s.seek(0);const before=useEditor.getState();s.addTitle('minimal');
  expect(useEditor.getState().project).toBe(p);expect(useEditor.getState().history).toEqual(before.history);expect(useEditor.getState().selected).toEqual(before.selected);
});

it('keeps a later compatible partition on the original lane even when the first one collides',()=>{
  const p=emptyProject();while(p.tracks.length<23)p.tracks.push(makeTrack('video','追加'));
  const id=p.tracks[0].id;p.clips=[{...makeClip(id,0),id:'old',duration:2},{...makeClip(id,1),id:'first',duration:3},{...makeClip(id,3),id:'later',duration:2}];
  const next=separateOverlappingClips(p,['first','later']);expect(next.tracks).toHaveLength(24);
  expect(next.clips[0]).toBe(p.clips[0]);expect(next.clips[2]).toBe(p.clips[2]);expect(next.clips[1].trackId).not.toBe(id);
});

it('repartitions around stationary intervals and handles constrained original-lane choices',()=>{
  for(const [fixed,intervals] of [
    [[[1,3]],[[0,1],[0,2],[2,3]]],
    [[[10,12]],[[0,1],[0,10],[1,11]]]
  ]){
    const p=emptyProject();while(p.tracks.length<23)p.tracks.push(makeTrack('video','追加'));
    const id=p.tracks[0].id;p.clips=[...fixed.map(([start,end],i)=>({...makeClip(id,start),id:`old${i}`,duration:end-start})),...intervals.map(([start,end],i)=>({...makeClip(id,start),id:`new${i}`,duration:end-start}))];
    const next=separateOverlappingClips(p,intervals.map((_,i)=>`new${i}`));expect(next.tracks).toHaveLength(24);
    expect(next.clips.slice(0,fixed.length)).toEqual(p.clips.slice(0,fixed.length));
  }
});
it('matches exhaustive minimum-lane solutions across 300 deterministic interval arrangements',()=>{
  let seed=1937;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  const hit=(a:{start:number;duration:number},b:{start:number;duration:number})=>Math.max(a.start,b.start)<Math.min(a.start+a.duration,b.start+b.duration);
  for(let trial=0;trial<300;trial++){
    const p=emptyProject(),id=p.tracks[0].id;
    const fixed=Array.from({length:2},(_,i)=>({...makeClip(id,random()%7),id:`fixed${i}`,duration:1+random()%4}));
    const added=Array.from({length:6},(_,i)=>({...makeClip(id,random()%7),id:`new${i}`,duration:1+random()%4}));p.clips=[...fixed,...added];
    const times=[...new Set(added.flatMap(c=>[c.start,c.start+c.duration]))].sort((a,b)=>a-b);let optimum=6;
    for(let mask=0;mask<(1<<added.length);mask++){
      const original=added.filter((_,i)=>mask&(1<<i));
      if(original.some((c,i)=>fixed.some(f=>hit(c,f))||original.slice(0,i).some(other=>hit(c,other))))continue;
      const remaining=added.filter((_,i)=>!(mask&(1<<i)));let peak=0;
      for(let i=1;i<times.length;i++){const time=(times[i-1]+times[i])/2;peak=Math.max(peak,remaining.filter(c=>c.start<=time&&c.start+c.duration>time).length);}
      optimum=Math.min(optimum,peak);
    }
    const next=separateOverlappingClips(p,added.map(c=>c.id));expect(next.tracks.length-p.tracks.length,`trial ${trial}`).toBe(optimum);
    for(const c of next.clips.filter(c=>c.id.startsWith('new')))for(const other of next.clips)if(c.id!==other.id&&c.trackId===other.trackId)expect(hit(c,other),`trial ${trial} collision`).toBe(false);
  }
});

it('does not reuse an empty Audio lane for visual overlap partitions',()=>{
  const p=emptyProject(),v=p.tracks[0].id,a=p.tracks[2].id;
  p.clips=[{...makeClip(v,0),id:'fixed'},{...makeClip(v,0),id:'new'}];
  const next=separateOverlappingClips(p,['new'],undefined,[a]);
  const clip=next.clips.find(c=>c.id==='new')!;
  expect(next.tracks.find(t=>t.id===clip.trackId)?.kind).toBe('video');expect(clip.trackId).not.toBe(a);
});
it('preserves legacy visual edits on Audio but refuses new Audio overlap lanes',()=>{
  const p=emptyProject(),a=p.tracks[2].id;p.clips=[{...makeClip(a,0),id:'old'},{...makeClip(a,10),id:'moved'}];
  expect(separateOverlappingClips(p,['moved'])).toBe(p);
  p.clips[1].start=0;expect(()=>separateOverlappingClips(p,['moved'])).toThrow(/Audio/);
});
