import { expect, it } from 'vitest';
import { emptyProject, makeClip, splitClip } from './model';
import { useEditor } from './store';
import { canSplitAt, timelinePointerTime, timelineScrubTime } from './timeline-pointer';

function fixture() {
  const p = emptyProject();
  p.clips = [{ ...makeClip(p.tracks[0].id, 0), duration: 6 }, { ...makeClip(p.tracks[1].id, 2), duration: 1 }];
  return p;
}
it('snaps pointer seeks to both clip edges only inside a fixed screen-pixel range', () => {
  const p = fixture();
  expect(timelinePointerTime(p, 2.05, 100, true)).toEqual({ time: 2, snapped: true });
  expect(timelinePointerTime(p, 2.95, 100, true)).toEqual({ time: 3, snapped: true });
  expect(timelinePointerTime(p, 2.05, 200, true).snapped).toBe(false);
  expect(timelinePointerTime(p, 2.06, 100, false)).toEqual({ time: 62 / 30, snapped: false });
  expect(timelinePointerTime(p, 1.9, 100, true).snapped).toBe(false);
  expect(timelinePointerTime(p, -.02, 100, true)).toEqual({ time: 0, snapped: true });
});
it('does not stick to the moving playhead or equate frame rounding with snapping', () => {
  const p = fixture();
  expect(timelinePointerTime(p, 1.21, 100, true)).toEqual({ time: 36 / 30, snapped: false });
  p.markers = [{ id: 'm', label: '合図', time: 1.5 }];
  expect(timelinePointerTime(p, 1.55, 100, true)).toEqual({ time: 1.5, snapped: true });
});
it('uses the actual split rounding for fractional legacy starts and rejects empty edge cuts', () => {
  const p = fixture(), clip = { ...p.clips[0], start: .015 };
  p.clips[0] = clip;
  const guide = timelinePointerTime(p, 2.05, 100, true, clip);
  expect(guide).toEqual({time: 2, snapped: true});
  const pair = splitClip(clip, guide.time, p.fps, guide.snapped)!;
  expect(pair[1].start).toBe(guide.time);
  expect(canSplitAt(clip, guide.time, p.fps)).toBe(true);
  for (const raw of [clip.start + .01, clip.start + clip.duration - .01]) {
    const edge = timelinePointerTime(p, raw, 100, true, clip);
    expect(edge.snapped).toBe(true);
    expect(canSplitAt(clip, edge.time, p.fps)).toBe(false);
    expect(splitClip(clip, edge.time, p.fps, edge.snapped)).toBeNull();
  }
});

it('preserves fractional boundary targets for the playhead and linked razor splits', () => {
  const p = fixture();
  const asset = {id:'source',kind:'video' as const,name:'source',path:'source.mp4',url:'',thumbnail:'',duration:10,width:320,height:180,fps:30,hasAudio:true,waveform:[],codec:'h264',size:1};
  p.assets=[asset];
  const clip = {...makeClip(p.tracks[0].id,.015,asset),duration:6,audioDetached:true,linkId:'pair'};
  p.clips = [clip, {...clip, id: 'linked', trackId: p.tracks[2].id, kind: 'audio',audioDetached:undefined}, {...p.clips[1], start: 2.017}];
  const target = timelinePointerTime(p, 2.04, 100, true, clip), s = useEditor.getState();
  expect(target).toEqual({time: 2.017, snapped: true});
  s.load(p); s.seek(target.time, target.snapped); expect(useEditor.getState().playhead).toBe(target.time);
  s.split(target.time, [clip.id], target.snapped);
  expect(useEditor.getState().project.clips.filter(c => c.start === target.time)).toHaveLength(3);
  s.undo(); expect(useEditor.getState().project).toBe(p); s.redo();
  expect(useEditor.getState().project.clips.filter(c => c.start === target.time)).toHaveLength(3);
});

it('preserves visible fractional targets at either viewport edge and ignores targets outside it',()=>{
  const p=fixture();p.clips=[];p.markers=[{id:'left',label:'左端',time:1.02},{id:'right',label:'右端',time:9.98},{id:'outside',label:'範囲外',time:9.995}];
  expect(timelineScrubTime(p,9.99,100,true,1.015,9.99)).toEqual({time:9.98,snapped:true});
  expect(timelineScrubTime(p,1.016,100,true,1.015,9.99)).toEqual({time:1.02,snapped:true});
  expect(timelineScrubTime(p,9.99,100,false,1.015,9.99)).toEqual({time:299/30,snapped:false});
  expect(timelineScrubTime(p,1.016,100,false,1.015,9.99)).toEqual({time:31/30,snapped:false});
  p.markers=p.markers.slice(2);expect(timelineScrubTime(p,9.99,100,true,1.015,9.99)).toEqual({time:299/30,snapped:false});
});

it('keeps unsnapped razor cuts on their relative frame grid inside the visible viewport',()=>{
  const p=fixture(),clip={...p.clips[0],start:.015};p.clips=[clip];p.markers=[{id:'outside',label:'範囲外',time:9.995}];
  const target=timelineScrubTime(p,9.99,100,true,1.015,9.99,clip);
  expect(target).toEqual({time:.015+299/30,snapped:false});
  expect(timelineScrubTime(p,1.016,100,false,1.018,9.99,clip)).toEqual({time:.015+31/30,snapped:false});
});
