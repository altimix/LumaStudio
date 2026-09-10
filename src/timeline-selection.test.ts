import { describe, expect, it } from 'vitest';
import { clipsInSelection, selectionRect, selectionScrollSpeed } from './timeline-selection';

const clips = [
  { id: 'video', left: 120, top: 43, width: 240, height: 48, locked: false },
  { id: 'audio', left: 120, top: 160, width: 240, height: 40, locked: false },
  { id: 'later', left: 480, top: 43, width: 120, height: 48, locked: false },
  { id: 'locked', left: 140, top: 102, width: 80, height: 48, locked: true }
];
describe('timeline marquee selection', () => {
  it('intersects clips across tracks in either drag direction without including locked tracks', () => {
    for (const [a, b] of [[{x:100,y:40},{x:400,y:210}], [{x:400,y:210},{x:100,y:40}]]) {
      expect(clipsInSelection(selectionRect(a,b),clips)).toEqual(['video','audio']);
    }
  });
  it('includes partially touched and narrow clips while excluding adjacent time or track ranges', () => {
    expect(clipsInSelection({left:359,top:45,width:10,height:10},clips)).toEqual(['video']);
    expect(clipsInSelection({left:361,top:45,width:118,height:10},clips)).toEqual([]);
    expect(clipsInSelection({left:125,top:93,width:40,height:8},clips)).toEqual([]);
  });
  it('adds to existing selection without duplicates and preserves it when the frame is empty', () => {
    expect(clipsInSelection({left:100,top:40,width:300,height:200},clips,['later','video'])).toEqual(['later','video','audio']);
    expect(clipsInSelection({left:800,top:250,width:100,height:50},clips,['video'])).toEqual(['video']);
  });
  it('uses content coordinates at a distant scroll position and high zoom', () => {
    const distant=clips.map(c=>({...c,left:c.left*4+20000,top:c.top+500,width:c.width*4}));
    expect(clipsInSelection(selectionRect({x:20450,y:535},{x:22000,y:740}),distant)).toEqual(['video','audio','later']);
  });
  it('keeps edge scrolling bounded and stops inside the viewport or an empty viewport', () => {
    expect(selectionScrollSpeed(-500,0,500)).toBe(-900);
    expect(selectionScrollSpeed(1000,0,500)).toBe(900);
    expect(selectionScrollSpeed(250,0,500)).toBe(0);
    expect(selectionScrollSpeed(1,0,0)).toBe(0);
    expect(selectionScrollSpeed(16,0,500)).toBe(-450);
  });
});
