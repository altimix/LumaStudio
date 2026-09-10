import { describe, expect, it } from 'vitest';
import { NO_SNAP, snapMonitorPosition } from './monitor-snap';
import { moveMedia } from './media-transform';

const clip = { x: 0, y: 0, rotation: 0 };
const landscape = { width: 1920, height: 1080 }, portrait = { width: 1080, height: 1920 };
describe('program monitor magnetic placement', () => {
  it('aligns all four outer edges in landscape and Shorts after contact at the same screen distance', () => {
    for (const project of [landscape, portrait]) for (const factor of [.2, .5, 1]) {
      const viewport = { width: project.width * factor, height: project.height * factor };
      const size = { width: project.width * .4, height: project.height * .4 };
      for (const side of [-1, 1]) {
        const result = snapMonitorPosition(clip, size, project,
          { x: side * (project.width * .3 + 2 / factor), y: side * (project.height * .3 + 2 / factor) }, viewport);
        expect(result.x).toBeCloseTo(side * 30, 8); expect(result.y).toBeCloseTo(side * 30, 8);
        expect(result.guides).toEqual({ x: side < 0 ? 'start' : 'end', y: side < 0 ? 'start' : 'end' });
      }
    }
  });
  it('uses the rotated box, including an enlarged box that extends beyond the frame', () => {
    for (const rotation of [0, 33, 90, -127]) for (const scale of [.2, .7, 1.5, 3]) {
      const size = { width: 720 * scale, height: 400 * scale }, angle = rotation * Math.PI / 180;
      const halfWidth = (size.width * Math.abs(Math.cos(angle)) + size.height * Math.abs(Math.sin(angle))) / 2;
      const halfHeight = (size.width * Math.abs(Math.sin(angle)) + size.height * Math.abs(Math.cos(angle))) / 2;
      const result = snapMonitorPosition({ ...clip, rotation }, size, landscape,
        { x: halfWidth - 960 - 2, y: 540 - halfHeight + 2 }, landscape, NO_SNAP, { x: halfWidth - 960 + 10, y: 540 - halfHeight - 10 });
      expect(landscape.width * (.5 + result.x / 100) - halfWidth).toBeCloseTo(0, 8);
      expect(landscape.height * (.5 + result.y / 100) + halfHeight).toBeCloseTo(1080, 8);
      expect(result.guides).toEqual({ x: Math.abs(halfWidth - 960) < 1e-8 ? 'center' : 'start', y: Math.abs(halfHeight - 540) < 1e-8 ? 'center' : 'end' });
    }
  });
  it('leaves 0.1, 1, 3 and 7 pixel insets free until an edge is touched', () => {
    for (const inset of [.1, 1, 3, 7]) for (const side of [-1, 1]) {
      const delta = { x: side * (576 - inset), y: side * (324 - inset) };
      const result = snapMonitorPosition(clip, { width: 768, height: 432 }, landscape, delta, landscape);
      expect(result.guides).toEqual(NO_SNAP);
      expect(result.x).toBeCloseTo(delta.x / 1920 * 100, 8); expect(result.y).toBeCloseTo(delta.y / 1080 * 100, 8);
    }
  });
  it('holds eight pixels of jitter on either side after contact, then releases without attracting from outside', () => {
    const project = { width: 1000, height: 1000 }, size = { width: 400, height: 400 };
    const position = (gap: number) => ({ x: -300 + gap, y: 100 });
    const move = (gap: number, before = 300, previous = NO_SNAP) => snapMonitorPosition(clip, size, project, position(gap), project, previous, position(before));
    const contact = move(-1, 1); expect(contact.x).toBe(-30); expect(contact.guides.x).toBe('start');
    expect(move(-3, -1, contact.guides).x).toBe(-30);
    for(const gap of [-8,-5,-1,.1,1,5,8])expect(move(gap,-1,contact.guides).guides.x).toBe('start');
    for(const gap of [-8.01,8.01])expect(move(gap,-1,contact.guides).guides.x).toBeNull();
    expect(move(-1, -5).guides.x).toBeNull();
    expect(move(0, -1).guides.x).toBe('start');
    expect(move(-10, 10).guides.x).toBeNull();
  });
  it('holds repeated inward/outward jitter in CSS pixels for every edge and center at each viewport scale',()=>{
    for(const project of [landscape,portrait])for(const factor of [.2,.5,1])for(const anchor of ['start','center','end'] as const){
      const viewport={width:project.width*factor,height:project.height*factor},size={width:project.width*.4,height:project.height*.4};
      const at={x:anchor==='start'?-project.width*.3:anchor==='end'?project.width*.3:0,y:anchor==='start'?-project.height*.3:anchor==='end'?project.height*.3:0};
      let guides={x:anchor,y:anchor},previous=at;
      for(const jitter of [1,-1,3,-4,7,-7,8,-8,0]){
        const delta={x:at.x+jitter/factor,y:at.y-jitter/factor};
        const result=snapMonitorPosition(clip,size,project,delta,viewport,guides,previous);
        expect(result.guides).toEqual(guides);expect(result.x).toBeCloseTo(at.x/project.width*100,8);expect(result.y).toBeCloseTo(at.y/project.height*100,8);previous=delta;
      }
      const released=snapMonitorPosition(clip,size,project,{x:at.x+9/factor,y:at.y-9/factor},viewport,guides,previous);
      expect(released.guides).toEqual(NO_SNAP);
    }
  });
  it('tracks contact while Alt supplies a free position so releasing Alt can restore the same contact', () => {
    const size = { width: 800, height: 400 }, delta = { x: -562, y: 108 };
    const result = snapMonitorPosition(clip, size, landscape, delta, landscape);
    expect(result.guides.x).toBe('start');
    const free = moveMedia(clip as Parameters<typeof moveMedia>[0], landscape, delta);
    expect(free.x).toBeCloseTo(-562 / 1920 * 100);
    const resumed = snapMonitorPosition(clip, size, landscape, delta, landscape, result.guides, delta);
    expect(resumed.x).toBeCloseTo((400 / 1920 - .5) * 100); expect(resumed.guides.x).toBe('start');
  });
  it('snaps a center crossing but allows approaching or leaving the center freely', () => {
    const size = { width: 800, height: 400 }, initial = { x: -10, y: 10, rotation: 0 };
    const approach = snapMonitorPosition(initial, size, landscape, { x: 191, y: -107 }, landscape);
    expect(approach.guides).toEqual(NO_SNAP);
    const crossed = snapMonitorPosition(initial, size, landscape, { x: 194, y: -110 }, landscape);
    expect(crossed).toEqual({ x: 0, y: 0, guides: { x: 'center', y: 'center' } });
    expect(snapMonitorPosition(clip, size, landscape, { x: 2, y: -2 }, landscape).guides).toEqual(NO_SNAP);
    expect(snapMonitorPosition(clip, landscape, landscape, { x: 0, y: 0 }, landscape).guides).toEqual({ x: 'center', y: 'center' });
  });
  it('preserves position limits without reporting an unreachable alignment', () => {
    const result = snapMonitorPosition(clip, { width: 16000, height: 16000 }, landscape, { x: 7040, y: 7460 }, landscape);
    expect(result).toEqual({ x: 200, y: 200, guides: NO_SNAP });
    const free = snapMonitorPosition(clip, { width: 200, height: 200 }, landscape, { x: 180, y: -100 }, landscape);
    expect(free.x).toBeCloseTo(9.375); expect(free.y).toBeCloseTo(-100 / 1080 * 100); expect(free.guides).toEqual(NO_SNAP);
  });
});
