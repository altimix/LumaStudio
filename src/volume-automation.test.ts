import { it, expect, vi } from 'vitest';
import { volumeAt, windowVolume, validateVolumeKeys } from '../shared/volume-automation.mjs';
import { timelineKey } from '../shared/youtube.mjs';
import { emptyProject, makeClip, splitClip, trimClip, rateStretchClip, rippleTrim, applySequenceSettings } from './model';
import { separateAudio } from './linked-editing';
import { addVolumePoint, moveVolumePoint, shiftVolumeSegment } from './volume-editing';
import { useEditor } from './store';
import { audioSlices, AUDIO_SAMPLE_RATE } from './audio-plan';
import { AudioBufferCache } from './audio';
import { mixAudioBlock } from './audio-mix';
import type { Asset, Clip } from './types';

it('preserves a one-frame volume dip in the gain scheduled for fast and slow forward/reverse playback',async()=>{
  const context={createBuffer:(_channels:number,length:number)=>{const data=[new Float32Array(length),new Float32Array(length)];return{length,getChannelData:(channel:number)=>data[channel]};}} as unknown as BaseAudioContext;
  const cache=new AudioBufferCache(context,async()=>new Float32Array(8*AUDIO_SAMPLE_RATE*2));
  const scheduled:{values:Float32Array;when:number;duration:number}[]=[];
  vi.stubGlobal('OfflineAudioContext',class {
    destination={}; constructor(_channels:number,readonly frames:number){}
    createBufferSource(){return{playbackRate:{value:1},connect(){},disconnect(){},start(){},stop(){},buffer:null};}
    createGain(){return{gain:{setValueCurveAtTime:(values:Float32Array,when:number,duration:number)=>scheduled.push({values,when,duration})},connect(){},disconnect(){}};}
    async startRendering(){return context.createBuffer(2,this.frames,AUDIO_SAMPLE_RATE);}
  });
  try{
    for(const rate of [16,-16,.5,-.5]){
      const p=fixture();p.clips[0]={...p.clips[0],start:0,in:2,duration:2,speed:1,volume:.1,volumeKeyframes:[{time:0,value:1},{time:1/30,value:0},{time:2/30,value:1},{time:2,value:1}]};
      const from=rate<0?Math.abs(rate)*.1:0,to=rate<0?0:rate*.1;scheduled.length=0;
      await mixAudioBlock(context.createBuffer(2,4800,AUDIO_SAMPLE_RATE),audioSlices(p,from,to,rate),cache,()=>true);
      expect(scheduled).toHaveLength(1);
      const curve=scheduled[0];
      for(const time of [.025,1/30,.04]){
        const position=((time-from)/rate-curve.when)/curve.duration*(curve.values.length-1),left=Math.floor(position),part=position-left;
        const gain=curve.values[left]*(1-part)+curve.values[Math.min(left+1,curve.values.length-1)]*part;
        expect(gain).toBeCloseTo(.1*volumeAt(p.clips[0].volumeKeyframes,time),5);
      }
    }
  }finally{cache.dispose();vi.unstubAllGlobals();}
});

function fixture() {
  const p=emptyProject(),asset:Asset={id:'tone',path:'C:/test.wav',url:'media://tone',thumbnail:'',kind:'audio',name:'tone',duration:60,size:1,codec:'pcm',fps:0,width:0,height:0,hasAudio:true,waveform:[]};
  p.assets=[asset];p.clips=[{...makeClip(p.tracks[2].id,5,asset),in:2,duration:4,speed:2,volume:.1,fadeIn:0,fadeOut:0,volumeKeyframes:[{time:0,value:1},{time:1,value:.2},{time:3,value:.2},{time:4,value:1}]}];return p;
}
function sameSourceCurve(original: Clip, clip: Clip) {
  validateVolumeKeys(clip);
  for(let time=0;time<=clip.duration;time+=.037)expect(volumeAt(clip.volumeKeyframes,time)).toBeCloseTo(volumeAt(original.volumeKeyframes,(clip.in-original.in)/original.speed+time*clip.speed/original.speed),9);
}
it('holds endpoints and interpolates gains without changing legacy volume',()=>{
  const keys=fixture().clips[0].volumeKeyframes;expect(volumeAt(undefined,10)).toBe(1);expect(volumeAt([],1)).toBe(1);
  expect(volumeAt(keys,-1)).toBe(1);expect(volumeAt(keys,.5)).toBeCloseTo(.6);expect(volumeAt(keys,2)).toBe(.2);expect(volumeAt(keys,3.5)).toBeCloseTo(.6);expect(volumeAt(keys,8)).toBe(1);
});
it('starts with two endpoint anchors and adds points without changing the curve',()=>{
  const clip={...fixture().clips[0],volumeKeyframes:undefined},keys=addVolumePoint(clip,1.01,30);expect(keys).toEqual([{time:0,value:1},{time:1,value:1},{time:4,value:1}]);
  const changed={...clip,volumeKeyframes:[{time:0,value:0},{time:4,value:2}]};expect(addVolumePoint(changed,2,30)[1]).toEqual({time:2,value:1});expect(addVolumePoint(changed,0,30)).toBe(changed.volumeKeyframes);
});
it('moves time and gain within neighboring points and cannot create duplicate times',()=>{
  const clip=fixture().clips[0],keys=moveVolumePoint(clip,1,20,-3,30);expect(keys[1].time).toBeLessThan(keys[2].time);expect(keys[1].value).toBe(0);validateVolumeKeys({...clip,volumeKeyframes:keys});expect(moveVolumePoint(clip,1,NaN,1,30)).toBe(clip.volumeKeyframes);
});
it('dragging a segment changes its adjacent nodes together without changing time or its slope',()=>{
  const clip=fixture().clips[0],next=shiftVolumeSegment(clip,.5,.4);expect(next[0].value).toBeCloseTo(1.4);expect(next[1].value).toBeCloseTo(.6);expect(next.slice(2)).toEqual(clip.volumeKeyframes!.slice(2));expect(next.map(k=>k.time)).toEqual(clip.volumeKeyframes!.map(k=>k.time));
  const limited=shiftVolumeSegment(clip,.5,5);expect(limited[0].value).toBe(2);expect(limited[1].value).toBeCloseTo(1.2);
});
it('preserves volume at each source sample after splits and trims, including extensions',()=>{
  const p=fixture(),clip=p.clips[0];for(const part of splitClip(clip,6.5,30)!)sameSourceCurve(clip,part);
  for(const [edge,delta] of [['left',.5],['left',-1],['right',-1.3],['right',2]] as const)sameSourceCurve(clip,trimClip(clip,edge,delta,p));
});
it('preserves source-relative automation when stretching either edge or changing speed in properties and menus',()=>{
  const p=fixture(),clip=p.clips[0];for(const edge of ['left','right'] as const)sameSourceCurve(clip,rateStretchClip(clip,edge,1,p));
  const s=useEditor.getState();s.load(p);s.updateClip(clip.id,{speed:.5});sameSourceCurve(clip,useEditor.getState().project.clips[0]);s.undo();s.setRate(4,[clip.id]);sameSourceCurve(clip,useEditor.getState().project.clips[0]);
});
it('keeps Q/W volume curves attached to the surviving source intervals',()=>{
  const p=fixture();for(const direction of ['previous','next'] as const){const next=rippleTrim(p,6.5,direction)!.project;for(const clip of next.clips)sameSourceCurve(p.clips[0],clip);}
});
it('transfers video automation to its audio and follows edits made through the linked video',()=>{
  const p=fixture();p.assets[0].kind='video';p.clips[0]={...p.clips[0],kind:'video',trackId:p.tracks[1].id};const separated=separateAudio(p,[p.clips[0].id]),audio=separated.clips.find(c=>c.kind==='audio')!;
  expect(separated.clips[0].volumeKeyframes).toBeUndefined();expect(audio.volumeKeyframes).toEqual(p.clips[0].volumeKeyframes);
  const s=useEditor.getState();s.load(separated);s.updateClip(separated.clips[0].id,{speed:1});sameSourceCurve(audio,useEditor.getState().project.clips.find(c=>c.id===audio.id)!);
  s.load(separated);const edited=trimClip(separated.clips[0],'left',.5,separated);s.commit({...separated,clips:separated.clips.map(c=>c.id===edited.id?edited:c)});sameSourceCurve(audio,useEditor.getState().project.clips.find(c=>c.id===audio.id)!);
});
it('BGM presets multiply the whole curve, preserve history, and reset returns to the base level',()=>{
  const p=fixture(),clip=p.clips[0],s=useEditor.getState();s.load(p);s.setBgmVolumeDb(-15,[clip.id]);let next=useEditor.getState().project.clips[0];expect(next.volumeKeyframes).toBe(clip.volumeKeyframes);expect(next.volume*volumeAt(next.volumeKeyframes,2)).toBeCloseTo(10**(-15/20)*.2);s.undo();expect(useEditor.getState().project).toBe(p);
  s.updateClip(clip.id,{volumeKeyframes:[]});next=useEditor.getState().project.clips[0];expect(next.volume*volumeAt(next.volumeKeyframes,2)).toBe(.1);s.undo();expect(useEditor.getState().project).toBe(p);s.redo();expect(useEditor.getState().project.clips[0].volumeKeyframes).toEqual([]);
});
it('protects locked clips and rejects invalid key data without creating history',()=>{
  const p=fixture(),s=useEditor.getState();p.tracks[2].locked=true;s.load(p);s.updateClip(p.clips[0].id,{volumeKeyframes:[]});expect(useEditor.getState().project).toBe(p);p.tracks[2].locked=false;s.updateClip(p.clips[0].id,{volumeKeyframes:[{time:99,value:1}]});expect(useEditor.getState().history).toHaveLength(0);
  for(const keys of [[{time:0,value:NaN}],[{time:-1,value:1}],[{time:0,value:3}],[{time:0,value:1},{time:0,value:0}],Array.from({length:65},(_,i)=>({time:i/30,value:1}))])expect(()=>validateVolumeKeys({...p.clips[0],volumeKeyframes:keys})).toThrow();
});
it('keeps full-capacity curves valid through extensions, FPS changes and fractional rate changes',()=>{
  const keys=Array.from({length:64},(_,i)=>({time:i+1,value:i%2}));for(const [offset,duration]of[[-2,70],[2.5,60],[4,.4]]){const next=windowVolume(keys,offset,duration)!;expect(next.length).toBeLessThanOrEqual(64);validateVolumeKeys({kind:'audio',duration,volumeKeyframes:next});}
  const p=fixture();p.clips[0].duration=1.03;p.clips[0].volumeKeyframes=[{time:0,value:0},{time:1.03,value:1}];const next=applySequenceSettings(p,{name:p.name,width:p.width,height:p.height,fps:24});sameSourceCurve(p.clips[0],next.clips[0]);
});
it('invalidates transcription when volume automation changes but preserves keys for legacy projects',()=>{
  const p=fixture(),before=timelineKey(p);p.clips[0].volumeKeyframes![1].value=.5;expect(timelineKey(p)).not.toBe(before);p.clips[0].volumeKeyframes=undefined;const legacy=timelineKey(p);p.clips[0].volumeKeyframes=[];expect(timelineKey(p)).toBe(legacy);
});
it('mixes actual forward and reverse PCM samples with automation, base gain and clip fades',async()=>{
  const context={createBuffer:(channels:number,length:number)=>{const data=Array.from({length:channels},()=>new Float32Array(length));return{length,getChannelData:(channel:number)=>data[channel]};}} as unknown as BaseAudioContext;
  const cache=new AudioBufferCache(context,async()=>{const pcm=new Float32Array(8*AUDIO_SAMPLE_RATE*2);for(let i=0;i<pcm.length;i+=2){pcm[i]=.1;pcm[i+1]=.2;}return pcm;});
  try{for(const speed of [1,.5])for(const direction of [1,-1]){
    const p=fixture();p.clips[0]={...p.clips[0],start:1,in:7.95,duration:.2,speed,volume:.5,fadeIn:.05,fadeOut:.05,volumeKeyframes:[{time:0,value:.2},{time:.1,value:1},{time:.2,value:.4}]};
    const frames=Math.round(9600*speed),output=context.createBuffer(2,frames,AUDIO_SAMPLE_RATE);await mixAudioBlock(output,audioSlices(p,direction>0?1:1.2,direction>0?1.2:1,direction/speed),cache,()=>true);
    for(const sample of [0,frames/8,frames/4,frames/2,frames*3/4,frames-1]){const t=direction>0?sample/(AUDIO_SAMPLE_RATE*speed):.2-sample/(AUDIO_SAMPLE_RATE*speed),curve=t<=.1?.2+8*t:1-6*(t-.1),fade=Math.max(0,Math.min(1,t/.05,(.2-t)/.05));expect(output.getChannelData(0)[sample]).toBeCloseTo(.1*.5*curve*fade,6);expect(output.getChannelData(1)[sample]).toBeCloseTo(.2*.5*curve*fade,6);}
  }}finally{cache.dispose();}
});
