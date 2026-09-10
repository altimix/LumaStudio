import { expect, it } from 'vitest';
import { clipWaveformRange, overviewWaveform } from './waveform-viewport';

it('keeps 2,000 clip memo props stable except for waveform tiles that enter, leave or change', () => {
  const clips = Array.from({ length: 2000 }, (_, i) => ({ start: i * 10, duration: 10 }));
  const at = (left: number) => clips.map(clip => clipWaveformRange(clip, 100, { left, width: 1000 }));
  const initial = at(0);
  const changed = (next: ReturnType<typeof at>) => next.flatMap((range, i) => range.left === initial[i].left && range.right === initial[i].right ? [] : [i]);
  expect(changed(at(1))).toEqual([]);
  expect(changed(at(256))).toEqual([1]);
  expect(changed(at(100000))).toEqual([0, 1, 99, 100, 101]);
  expect(at(100000)[1500]).toBe(initial[1500]);
  expect(clipWaveformRange({ start: 10, duration: .25 }, 100, { left: 1000, width: 1000 })).toEqual({ left: 0, right: 25 });
  expect(clipWaveformRange({ start: 0, duration: 100 }, 100, { left: 900, width: 1000 })).toEqual({ left: 768, right: 2048 });
});

it('retains overview peaks at source-window positions while detailed reads are pending',()=>{
  expect(Array.from(overviewWaveform([.1,.9,.2,.8],4,1,3,2))).toEqual([expect.closeTo(.9),expect.closeTo(.2)]);
  expect(Array.from(overviewWaveform([.1,.9,.2,.8],4,0,4,2))).toEqual([expect.closeTo(.9),expect.closeTo(.8)]);
  expect(Array.from(overviewWaveform([],4,0,4,2))).toEqual([0,0]);
});
