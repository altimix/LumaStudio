import { describe, expect, it } from 'vitest';
import { emptyProject, makeClip, splitClip, trimClip, rateStretchClip } from './model';
import { useEditor } from './store';
import { DEFAULT_VIDEO_MASK } from '../shared/video-mask.mjs';
import { hasVisualKeys, needsTitleFrames, patchVisualClip, setVisualKey, validateVisualKeys, visualClipAt, visualKeys, visualSnapshot, visualValuesAt } from '../shared/visual-keyframes.mjs';
import type { Clip } from './types';

const title = (): Clip => ({ ...makeClip('v', 0), duration: 4, fadeIn: 0, fadeOut: 0, text: '共通の文章', color: '#ff0000', fontSize: 40 });
const animated = () => setVisualKey(setVisualKey(title(), 0), 4, { x: 40, scale: 2, opacity: 0, fontSize: 120, color: '#0000ff', textStyle: 'subtitle' });
const sameAppearance = (actual: ReturnType<typeof visualValuesAt>, expected: ReturnType<typeof visualValuesAt>) => {
  expect({ ...actual, color: undefined }).toEqual({ ...expected, color: undefined });
  // A newly stored boundary color is quantized to the same 8-bit RGB format as a color input.
  for (const offset of [1, 3, 5]) expect(Math.abs(parseInt(actual.color!.slice(offset, offset + 2), 16) - parseInt(expected.color!.slice(offset, offset + 2), 16))).toBeLessThanOrEqual(1);
};

describe('visual keyframes', () => {
  it('interpolates appearance and transforms while keeping text and discrete settings', () => {
    const clip = animated(), middle = visualClipAt(clip, 2);
    expect(middle).toMatchObject({ x: 20, scale: 1.5, opacity: .5, fontSize: 80, color: '#800080', text: clip.text, textStyle: 'hero' });
    expect(visualClipAt(clip, 4).textStyle).toBe('subtitle');
    expect(visualValuesAt(clip, -1)).toEqual(visualValuesAt(clip, 0));
    expect(visualValuesAt(clip, 10)).toEqual(visualValuesAt(clip, 4));
    expect(needsTitleFrames(clip)).toBe(true);
  });
  it('seeds the start when the first point is added midway and ignores text patches', () => {
    const clip = setVisualKey(title(), 2, { fontSize: 100, text: '変更しない' });
    expect(visualKeys(clip).map(key => key.time)).toEqual([0, 2]);
    expect(visualClipAt(clip, 1).fontSize).toBe(70);
    expect(visualClipAt(clip, 2).text).toBe('共通の文章');
  });
  it('keeps legacy opacity curves until an edit converts them without changing the curve', () => {
    const clip = { ...title(), opacityKeyframes: [{ time: 0, value: 0 }, { time: 2, value: 1 }, { time: 4, value: .5 }] };
    const migrated = setVisualKey(clip, 1);
    expect(hasVisualKeys(clip)).toBe(true);
    expect(migrated.opacityKeyframes).toBeUndefined();
    for (const time of [0, .5, 1, 1.5, 2, 3, 4]) expect(visualClipAt(migrated, time).opacity).toBeCloseTo(visualClipAt(clip, time).opacity);
    expect(needsTitleFrames(migrated)).toBe(false);
  });
  it('patches the current point, including values equal to the original base', () => {
    const clip = animated(), patched = patchVisualClip(clip, { x: 0, fontSize: 40, text: '文章は全体で変更' }, 2);
    expect(patched.x).toBe(0);
    expect(visualClipAt(patched, 2)).toMatchObject({ x: 0, fontSize: 40, text: '文章は全体で変更' });
    expect(visualClipAt(patched, 4).fontSize).toBe(120);
  });
  it('interpolates nested crop, mask and chroma settings and switches effect types at points', () => {
    const video: Clip = { ...title(), kind: 'video', videoMask: { ...DEFAULT_VIDEO_MASK }, crop: { top: 0, right: 0, bottom: 0, left: 0 } };
    const keyed = setVisualKey(setVisualKey(video, 0), 4, { exposure: 2, crop: { top: .2, right: .2, bottom: 0, left: 0 }, videoMask: { ...DEFAULT_VIDEO_MASK, x: .8, width: .3 } });
    expect(visualClipAt(keyed, 2)).toMatchObject({ exposure: 1, crop: { top: .1, right: .1 }, videoMask: { x: .65, width: .5 } });
    const changed = setVisualKey(keyed, 4, { videoMask: { ...DEFAULT_VIDEO_MASK, type: 'ellipse' } });
    expect(visualClipAt(changed, 3).videoMask?.type).toBe('rectangle');
    expect(visualClipAt(changed, 4).videoMask?.type).toBe('ellipse');
    const disabled = setVisualKey(keyed, 4, { videoMask: undefined });
    expect(visualClipAt(disabled, 3).videoMask).toEqual(video.videoMask);
    expect(visualClipAt(disabled, 4).videoMask).toBeUndefined();
    expect(() => validateVisualKeys(JSON.parse(JSON.stringify(disabled)))).not.toThrow();
  });
  it('preserves the visible animation across split and both trims', () => {
    const clip = animated(), project = { ...emptyProject(), clips: [clip] };
    const parts = splitClip(clip, 2, 30)!;
    for (const time of [0, .5, 1, 1.5]) {
      sameAppearance(visualValuesAt(parts[0], time), visualValuesAt(clip, time));
      sameAppearance(visualValuesAt(parts[1], time), visualValuesAt(clip, time + 2));
    }
    const left = trimClip(clip, 'left', 1, project), right = trimClip(clip, 'right', -1, project);
    sameAppearance(visualValuesAt(left, .5), visualValuesAt(clip, 1.5));
    sameAppearance(visualValuesAt(right, 2), visualValuesAt(clip, 2));
  });
  it('retimes visual points with rate stretching', () => {
    const video: Clip = { ...title(), kind: 'video' }, clip = setVisualKey(setVisualKey(video, 0), 4, { x: 40 });
    const stretched = rateStretchClip(clip, 'right', 4, emptyProject());
    expect(stretched.duration).toBe(8);
    expect(visualKeys(stretched).map(key => key.time)).toEqual([0, 8]);
    expect(visualClipAt(stretched, 4).x).toBe(20);
  });
  it('retimes points when speed changes in properties or the rate command',()=>{
    for(const command of ['property','rate']){
      const p=emptyProject(),clip=setVisualKey(setVisualKey({...title(),kind:'video',trackId:p.tracks[0].id},0),4,{x:40});
      p.clips=[clip];useEditor.getState().load(p);
      if(command==='property')useEditor.getState().updateClip(clip.id,{speed:2});else useEditor.getState().setRate(2,[clip.id]);
      const result=useEditor.getState().project.clips[0];expect(result.duration).toBe(2);expect(visualKeys(result).map(key=>key.time)).toEqual([0,2]);expect(visualClipAt(result,1).x).toBe(20);
    }
  });
  it('rejects malformed settings, duplicate times, forbidden text and more than 64 points', () => {
    const clip = animated(), values = visualSnapshot(clip);
    for (const keys of [[{ time: -1, values }], [{ time: 1, values }, { time: 1, values }], [{ time: 0, values: { ...values, opacity: 2 } }], [{ time: 0, values: { ...values, text: '文章' } }], [{ time: 0, values: { ...values, color: 'red' } }], Array.from({ length: 65 }, (_, index) => ({ time: index / 30, values }))]) {
      expect(() => validateVisualKeys({ ...clip, visualKeyframes: keys } as Clip)).toThrow();
    }
  });
  it('maintains locking, Undo and Redo when properties edit a keyframe', () => {
    const p = emptyProject(), clip = { ...animated(), trackId: p.tracks[0].id };
    p.clips = [clip]; useEditor.getState().load(p); useEditor.getState().seek(2);
    useEditor.getState().updateClip(clip.id, { fontSize: 90 });
    expect(visualClipAt(useEditor.getState().project.clips[0], 2).fontSize).toBe(90);
    useEditor.getState().undo(); expect(visualClipAt(useEditor.getState().project.clips[0], 2).fontSize).toBe(80);
    useEditor.getState().redo(); expect(visualClipAt(useEditor.getState().project.clips[0], 2).fontSize).toBe(90);
    useEditor.getState().updateTrack(clip.trackId, { locked: true });
    const before = useEditor.getState().project; useEditor.getState().updateClip(clip.id, { fontSize: 100 });
    expect(useEditor.getState().project).toBe(before);
  });
});
