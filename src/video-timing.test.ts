import { expect, it } from 'vitest';
import { playbackFrameAhead, waitForNativeFrame, usablePlaybackFrame, videoSeekLead, videoSeekRecoveryMs, videoSeekTolerance } from './video-timing';

it('keeps the held tail/head frame while the playhead is outside the moving source interval', () => {
  expect(videoSeekLead(1400, 3.966666, 4.75)).toBe(0);
  expect(videoSeekLead(1400, 0, -.5)).toBe(0);
  expect(videoSeekLead(1400, 3.95, 3.95)).toBe(.8);
});

it('predicts wall-clock decode time only inside moving footage with a bounded lead', () => {
  expect(videoSeekLead(undefined, 2, 2)).toBeCloseTo(.020);
  expect(videoSeekLead(200, 2, 2)).toBeCloseTo(.208);
  expect(videoSeekLead(1800, 2, 2)).toBe(.8);
});

it('allows a long-GOP seek to finish before treating its decoder as stalled', () => {
  expect(videoSeekRecoveryMs(undefined)).toBe(2000);
  expect(videoSeekRecoveryMs(350)).toBe(2000);
  expect(videoSeekRecoveryMs(1400)).toBe(4200);
});

it('keeps an early reverse frame until the playhead reaches its display interval', () => {
  expect(playbackFrameAhead(2.87, 3.25, 1, -1, 30)).toBe(true);
  expect(playbackFrameAhead(2.87, 2.9, 1, -1, 30)).toBe(false);
  expect(usablePlaybackFrame(2.87, 2.9, 1, -1, 30, true)).toBe(true);
});

it('resynchronizes slow motion after the same sequence-time drift as normal footage', () => {
  for (const speed of [.25, .5, 1, 2, 4]) {
    const budget = videoSeekTolerance(speed, 1, 30, true);
    expect(budget / speed).toBe(.5);
    expect(.6 * speed).toBeGreaterThan(budget);
  }
});

it('keeps manual seeks exact and accounts for shuttle rate in the six-frame budget', () => {
  expect(videoSeekTolerance(.25, 1, 30, false)).toBe(.008);
  expect(videoSeekTolerance(4, 4, 24, false)).toBe(.008);
  expect(videoSeekTolerance(.25, 4, 30, true)).toBe(.2);
  expect(videoSeekTolerance(2, 4, 24, true)).toBe(2);
});

it('uses recent continuous frames in both directions without presenting future images', () => {
  expect(usablePlaybackFrame(3.65, 4, 1, 1, 30, true)).toBe(true);
  expect(usablePlaybackFrame(4.35, 4, 1, -1, 30, true)).toBe(true);
  expect(usablePlaybackFrame(4.1, 4, 1, 1, 30, true)).toBe(false);
  expect(usablePlaybackFrame(3.9, 4, 1, -1, 30, true)).toBe(false);
});

it('fences a previous seek, undecoded input and frames older than half a playback second', () => {
  expect(usablePlaybackFrame(3.99, 4, 1, 1, 30, false)).toBe(false);
  expect(usablePlaybackFrame(undefined, 4, 1, 1, 30, true)).toBe(false);
  expect(usablePlaybackFrame(3.49, 4, 1, 1, 30, true)).toBe(false);
  expect(usablePlaybackFrame(4.51, 4, 1, -1, 30, true)).toBe(false);
});

it('keeps the cached-frame age bound in wall time for slow motion and fast shuttles', () => {
  for (const speed of [.25, 1, 4]) for (const shuttle of [-4, -1, 1, 4]) {
    expect(usablePlaybackFrame(4 - speed * shuttle * .4, 4, speed, shuttle, 30, true)).toBe(true);
    expect(usablePlaybackFrame(4 - speed * shuttle * .6, 4, speed, shuttle, 30, true)).toBe(false);
  }
});

it('holds an early native decoder until the timeline catches it without toggling every frame',()=>{
  for(const speed of [.25,1,4]){
    expect(waitForNativeFrame(3+.18*speed,3,speed,30,false)).toBe(true);
    expect(waitForNativeFrame(3+.08*speed,3,speed,30,false)).toBe(false);
    expect(waitForNativeFrame(3+.08*speed,3,speed,30,true)).toBe(true);
    expect(waitForNativeFrame(3+.03*speed,3,speed,30,true)).toBe(false);
    expect(waitForNativeFrame(3-.18*speed,3,speed,30,true)).toBe(false);
  }
});
