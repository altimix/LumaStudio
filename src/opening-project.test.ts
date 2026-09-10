import { describe, expect, it } from 'vitest';
import { demoProject, endTime } from './model';
import type { Asset } from './types';
describe('opening project', () => {
  it('retains the full video interval, independent linked audio and a quiet BGM', () => {
    const assets = [{ id: 'v', name: 'movie05.mp4', kind: 'video', duration: 49.412067, hasAudio: true }, { id: 'a', name: '英雄の奪っていったもの.mp3', kind: 'audio', duration: 137.04, hasAudio: true }] as Asset[];
    const p = demoProject(assets), video = p.clips.find(c => c.kind === 'video')!;
    expect([p.width, p.height, p.fps]).toEqual([1080, 1920, 30]);
    expect(endTime(p)).toBe(49.4); expect(video.in).toBe(0); expect(video.audioDetached).toBe(true);
    const voice = p.clips.find(c => c.kind === 'audio' && c.assetId === 'v')!;
    expect(voice.linkId).toBe(video.linkId); expect(voice.duration).toBe(video.duration); expect(voice.volume).toBe(1);
    const music = p.clips.find(c => c.assetId === 'a')!;
    expect([music.start, music.duration, music.volume, music.fadeIn, music.fadeOut]).toEqual([0, 49.4, .1, 1, 2]);
    const title = p.clips.find(c => c.kind === 'title')!;
    expect([title.text, title.duration, title.strokeColor, title.strokeWidth, title.textShadow]).toEqual(['英雄が残したもの', 5, '#0064ff', 4, false]);
    expect(demoProject(assets).id).not.toBe(p.id);
  });
});
