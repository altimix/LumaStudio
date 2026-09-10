import { describe, expect, it } from 'vitest';
import { AudioBufferCache } from './audio';
import { AUDIO_CHUNK_SECONDS, AUDIO_SAMPLE_RATE } from './audio-plan';
import type { Asset } from './types';
const frames = AUDIO_CHUNK_SECONDS * AUDIO_SAMPLE_RATE;
const context = { createBuffer: (channels: number, length: number) => {
  const data = Array.from({ length: channels }, () => new Float32Array(length)); return { length, getChannelData: (channel: number) => data[channel] };
} } as unknown as BaseAudioContext;
const asset = { url: 'media://local/asset/audio?v=1' } as Asset;
describe('PCM cache', () => {
  it('separates normalized PCM, retains reverse audio, and restores originals on bypass', async () => {
    const calls: string[] = [];
    const cache = new AudioBufferCache(context, async (_asset, _chunk, mode) => { calls.push(mode || 'original'); return new Float32Array(frames * 2).fill(mode === 'speech' ? 0.3 : 0.1); });
    const original = await cache.get(asset, 0, false), enhanced = await cache.get(asset, 0, false, 'speech'), reverse = await cache.get(asset, 0, true, 'speech');
    expect(original.getChannelData(0)[0]).toBeCloseTo(0.1); expect(enhanced.getChannelData(0)[0]).toBeCloseTo(0.3); expect(reverse.getChannelData(1)[frames - 1]).toBeCloseTo(0.3);
    expect(await cache.get(asset, 0, false)).toBe(original); expect(calls).toEqual(['original', 'speech']); cache.dispose();
  });
  it('reverses actual samples independently per channel and reuses both directions', async () => {
    let calls = 0;
    const cache = new AudioBufferCache(context, async () => { calls++; const data = new Float32Array(frames * 2); data[0] = 0.1; data[1] = 0.2; data[data.length - 2] = 0.3; data[data.length - 1] = 0.4; return data; });
    const [a, b] = await Promise.all([cache.get(asset, 0, false), cache.get(asset, 0, true)]);
    expect(calls).toBe(1); expect(a.getChannelData(0)[0]).toBeCloseTo(0.1); expect(b.getChannelData(0)[0]).toBeCloseTo(0.3); expect(b.getChannelData(1)[frames - 1]).toBeCloseTo(0.2);
    expect(await cache.get(asset, 0, true)).toBe(b); expect(calls).toBe(1);
  });
  it('bounds memory across directions and invalidates re-linked revisions', async () => {
    let calls = 0; const limit = frames * 8 * 2;
    const cache = new AudioBufferCache(context, async () => { calls++; return new Float32Array(frames * 2); }, limit);
    await cache.get(asset, 0, true); await cache.get(asset, 1, true); expect(cache.bytes).toBeLessThanOrEqual(limit);
    await cache.get(asset, 0, false); expect(calls).toBe(3);
    await cache.get({ ...asset, url: 'media://local/asset/audio?v=2' }, 0, false); expect(calls).toBe(4); expect(cache.bytes).toBeLessThanOrEqual(limit);
    cache.dispose(); expect(cache.bytes).toBe(0);
  });
  it('does not resurrect cache entries after disposal or retain failed loads', async () => {
    let resolve!: (data: Float32Array) => void;
    const cache = new AudioBufferCache(context, () => new Promise(done => { resolve = done; }));
    const pending = cache.get(asset, 0, false); await Promise.resolve(); cache.dispose(); resolve(new Float32Array(frames * 2));
    await expect(pending).rejects.toThrow(/終了/); expect(cache.bytes).toBe(0);
    let calls = 0; const retry = new AudioBufferCache(context, async () => { if (++calls === 1) throw new Error('offline'); return new Float32Array(frames * 2); });
    await expect(retry.get(asset, 0, true)).rejects.toThrow('offline'); await retry.get(asset, 0, true); expect(calls).toBe(2);
  });
  it('bounds decode requests for seven overlapping clips at 16x shuttle and 4x clip speed', async () => {
    let active = 0; let peak = 0; let completed = 0; const jobs: (() => void)[] = [];
    const cache = new AudioBufferCache(context, () => new Promise(resolve => {
      peak = Math.max(peak, ++active); jobs.push(() => { active--; completed++; resolve(new Float32Array(frames * 2)); });
    }), frames * 8 * 3);
    const all = Promise.all(Array.from({ length: 35 }, (_, i) => cache.get({ ...asset, url: `${asset.url}-${Math.floor(i / 5)}` }, i % 5, false).then(() => {})));
    await Promise.resolve(); expect(peak).toBeLessThanOrEqual(2);
    while (completed < 35) { for (const finish of jobs.splice(0)) finish(); await Promise.resolve(); }
    await all; expect(peak).toBe(2); expect(cache.bytes).toBeLessThanOrEqual(frames * 8 * 3); cache.dispose();
  });
  it('cancels old queued decodes and allows a new request for the same window', async () => {
    const jobs: { chunk: number; finish: () => void }[] = [];
    const cache = new AudioBufferCache(context, (_asset, chunk) => new Promise(resolve => { jobs.push({ chunk, finish: () => resolve(new Float32Array(frames * 2)) }); }));
    const old = [0, 1, 2, 3].map(chunk => cache.get(asset, chunk, false)); const oldResults = Promise.allSettled(old);
    await Promise.resolve(); expect(jobs.map(job => job.chunk)).toEqual([0, 1]);
    cache.cancelPending(); const fresh = cache.get(asset, 2, true);
    jobs.splice(0).forEach(job => job.finish());
    const results = await oldResults; expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled', 'rejected', 'rejected']);
    while (!jobs.length) await Promise.resolve(); expect(jobs[0].chunk).toBe(2); jobs[0].finish(); await fresh; cache.dispose();
  });
});
