import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimelineAudio } from './audio';
import { emptyProject, makeClip } from './model';
import type { Asset } from './types';
import { mixAudioBlock, MIX_BATCH_SIZE } from './audio-mix';
import { audioSlices } from './audio-plan';
import { AudioBufferCache } from './audio';
import { bindAudioMeterReset, resetAudioMeter } from './meter-store';

class Context {
  currentTime = 0; state = 'running'; destination = {};
  resumes = 0; sources: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; playbackRate: { value: number }; buffer: AudioBuffer | null }[] = [];
  resume = async () => { this.resumes++; this.state = 'running'; };
  close = async () => { this.state = 'closed'; };
  createAnalyser = () => ({ connect: vi.fn(), fftSize: 0, getFloatTimeDomainData: vi.fn() });
  createGain = () => ({ connect: vi.fn(), disconnect: vi.fn(), gain: { setValueCurveAtTime: vi.fn() } });
  createBuffer = (channels: number, length: number) => { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { length, getChannelData: (channel: number) => data[channel] }; };
  createBufferSource = () => { const source = { start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), playbackRate: { value: 1 }, buffer: null as AudioBuffer | null }; this.sources.push(source); return source; };
}
function setup(read: (url: string, chunk: number) => Promise<Float32Array>) {
  vi.useFakeTimers(); const context = new Context();
  const offline: Context[] = [];
  vi.stubGlobal('OfflineAudioContext', class extends Context {
    private length: number;
    constructor(_channels: number, length: number) { super(); this.length = length; offline.push(this); }
    startRendering = async () => this.createBuffer(2, this.length);
  });
  vi.stubGlobal('AudioContext', class { constructor() { return context; } });
  vi.stubGlobal('window', { luma: { readAudioChunk: read } });
  const project = emptyProject(); const asset = { id: 'audio', url: 'media://local/asset/audio?v=1', kind: 'audio', duration: 64, hasAudio: true } as Asset;
  project.assets = [asset]; project.clips = [{ ...makeClip(project.tracks[2].id, 0, asset), duration: 64, volume: 1, fadeIn: 0, fadeOut: 0 }];
  const error = vi.fn(); const meter = vi.fn(); const transport = new TimelineAudio(error, meter); return { context, project, transport, error, offline, meter };
}
const pcm = () => new Float32Array(48000 * 8 * 2);
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('audio command lifetime', () => {
  it('reset discards a just-played transient but keeps the already scheduled post-reset signal', async () => {
    const samples = pcm(); samples[100 * 2] = 1.25; samples[2000 * 2 + 1] = -.5;
    const { context, project, transport, meter } = setup(async () => samples);
    const unbind = bindAudioMeterReset(() => transport.discardPlayedMeterSamples());
    try {
      transport.setTransport(project, 0, true, 1); await vi.advanceTimersByTimeAsync(0);
      context.currentTime = .05; resetAudioMeter();
      context.currentTime = .08; await vi.advanceTimersByTimeAsync(25);
      expect(meter).toHaveBeenLastCalledWith([0, .5]);
      expect(meter.mock.calls.some(([value]) => value[0] >= 1)).toBe(false);
      expect(context.sources.every(source => source.stop.mock.calls.length === 1)).toBe(true);
    } finally { unbind(); transport.dispose(); }
  });
  it('meters only played mixed PCM, flushes a short peak on K, and clears queued future audio', async () => {
    const samples = pcm();
    samples[100 * 2] = 1.25; samples[100 * 2 + 1] = -.5;
    samples[24000 * 2] = 2;
    const { context, project, transport, meter } = setup(async () => samples);
    try {
      transport.setTransport(project, 0, true, 1); await vi.advanceTimersByTimeAsync(25);
      expect(meter.mock.calls.every(([value]) => value[0] === 0 && value[1] === 0)).toBe(true);
      // A single transient has played, but the next meter/UI timer has not run.
      context.currentTime = .05;
      transport.setTransport(project, .02, false, 1);
      expect(meter).toHaveBeenLastCalledWith([1.25, .5]);
      context.currentTime = 1; await vi.advanceTimersByTimeAsync(25);
      expect(meter).toHaveBeenLastCalledWith([0, 0]);
      expect(meter.mock.calls.some(([value]) => value[0] === 2)).toBe(false);
    } finally { transport.dispose(); }
  });
  it('keeps scheduled PCM contiguous through a 500 ms UI stall across decode boundaries in both directions', async () => {
    for (const direction of [1, -1]) {
      const { context, project, transport, error } = setup(async () => pcm());
      try {
        const position = direction > 0 ? 7.7 : 8.3;
        transport.setTransport(project, position, true, direction);
        await vi.advanceTimersByTimeAsync(0);
        const before = context.sources.length;
        // Audio keeps running while a busy UI cannot execute its scheduling timer.
        context.currentTime = .525;
        await vi.advanceTimersByTimeAsync(25);
        expect(context.sources.length).toBeGreaterThan(before);
        const starts = context.sources.map(source => source.start.mock.calls[0][0] as number);
        for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeCloseTo(.1, 7);
        expect(transport.position).toBeCloseTo(position + (.525 - .03) * direction, 7);
        expect(error).not.toHaveBeenCalled();
        transport.setTransport(project, transport.position, false, direction);
        expect(context.sources.every(source => source.stop.mock.calls.length === 2)).toBe(true);
      } finally { transport.dispose(); }
    }
  });
  it('processes same-frame K/L, resumes a suspended context and replaces existing sources', async () => {
    const { context, project, transport } = setup(async () => pcm());
    try {
      transport.setTransport(project, 2, true, -1); await vi.advanceTimersByTimeAsync(0);
      const old = [...context.sources]; expect(old.length).toBeGreaterThan(0);
      context.state = 'suspended'; transport.setTransport(project, 2, false, 1); transport.setTransport(project, 2, true, 1);
      await vi.advanceTimersByTimeAsync(0);
      expect(old.every(source => source.stop.mock.calls.length === 2 && source.disconnect.mock.calls.length > 0)).toBe(true);
      expect(context.resumes).toBe(2); expect(context.state).toBe('running');
      const next = context.sources.slice(old.length); expect(next.length).toBeGreaterThan(0);
      expect(next.every(source => source.playbackRate.value === 1)).toBe(true);
      expect(next.every(source => source.buffer!.length <= 4800)).toBe(true);
    } finally { transport.dispose(); }
  });
  it('a decode completed after stop or direction/seek changes cannot start stale sound', async () => {
    const pending = new Map<number, (data: Float32Array) => void>();
    const read = vi.fn((_url: string, chunk: number) => new Promise<Float32Array>(resolve => pending.set(chunk, resolve)));
    const { context, project, transport, error } = setup(read);
    try {
      transport.setTransport(project, 2, true, 1); await vi.advanceTimersByTimeAsync(0); expect(pending.has(0)).toBe(true);
      transport.setTransport(project, 2, false, 1); pending.get(0)!(pcm()); await vi.advanceTimersByTimeAsync(0);
      expect(context.sources).toHaveLength(0);
      transport.setTransport(project, 10, true, 1); await vi.advanceTimersByTimeAsync(0);
      transport.setTransport(project, 20, true, -1); await vi.advanceTimersByTimeAsync(0);
      pending.get(1)!(pcm()); await vi.advanceTimersByTimeAsync(0); expect(context.sources).toHaveLength(0);
      pending.get(2)!(pcm()); await vi.advanceTimersByTimeAsync(0);
      expect(context.sources.length).toBeGreaterThan(0);
      expect(error).not.toHaveBeenCalled();
    } finally { transport.dispose(); }
  });
  it('bounds scratch graphs and live buffers for 24 overlapping high-speed clips', async () => {
    const { context, project, transport, offline } = setup(async () => pcm());
    try {
      project.clips = Array.from({ length: 24 }, (_, i) => ({ ...project.clips[0], id: `clip-${i}`, speed: 4, duration: 16 }));
      const slices = audioSlices(project, 1.95, 3.55, 16);
      const cache = new AudioBufferCache(context as unknown as BaseAudioContext, async () => pcm());
      const output = context.createBuffer(2, 4800) as unknown as AudioBuffer;
      const mixed = await mixAudioBlock(output, slices, cache, () => true);
      expect(mixed!.length).toBe(4800); expect(offline.length).toBeGreaterThan(1);
      expect(offline.every(batch => batch.sources.length <= MIX_BATCH_SIZE)).toBe(true);
      expect(offline.flatMap(batch => batch.sources).every(source => source.buffer === null && source.disconnect.mock.calls.length === 1)).toBe(true);
      cache.dispose();
    } finally { transport.dispose(); }
  });
  it('mixes aligned unity-rate stereo across windows with exact forward/reverse samples and fades', async () => {
    const { context, project, transport, offline } = setup(async () => pcm());
    const cache = new AudioBufferCache(context as unknown as BaseAudioContext, async (_asset, chunk) => {
      const samples = pcm(); for (let i = 0; i < samples.length / 2; i++) { samples[i * 2] = (chunk * 8 * 48000 + i) / (64 * 48000); samples[i * 2 + 1] = -samples[i * 2]; } return samples;
    });
    try {
      for (const speed of [1, 0.5]) for (const direction of [1, -1]) {
        project.clips[0] = { ...project.clips[0], start: 1, in: 7.95, duration: 0.2, speed, volume: 0.5, fadeIn: 0.1, fadeOut: 0.1 };
        const frames = Math.round(9600 * speed), output = context.createBuffer(2, frames) as unknown as AudioBuffer;
        await mixAudioBlock(output, audioSlices(project, direction > 0 ? 1 : 1.2, direction > 0 ? 1.2 : 1, direction / speed), cache, () => true);
        for (const sample of [0, frames / 8, frames / 4, frames / 2, frames * 3 / 4, frames - 1]) {
          const elapsed = direction > 0 ? sample / (48000 * speed) : 0.2 - sample / (48000 * speed);
          const gain = 0.5 * Math.max(0, Math.min(1, elapsed / 0.1, (0.2 - elapsed) / 0.1));
          const sourceFrame = direction > 0 ? 7.95 * 48000 + sample : (7.95 + 0.2 * speed) * 48000 - 1 - sample;
          expect(output.getChannelData(0)[sample]).toBeCloseTo(sourceFrame / (64 * 48000) * gain, 6);
          expect(output.getChannelData(1)[sample]).toBeCloseTo(-output.getChannelData(0)[sample], 7);
        }
      }
      expect(offline).toHaveLength(0);
    } finally { cache.dispose(); transport.dispose(); }
  });
  it('holds the playhead during decode and ignores stale errors but reports current failures', async () => {
    const rejects: ((error: Error) => void)[] = [];
    const { context, project, transport, error } = setup(() => new Promise((_resolve, reject) => rejects.push(reject)));
    try {
      transport.setTransport(project, 3, true, 1); await vi.advanceTimersByTimeAsync(0); context.currentTime = 20;
      expect(transport.position).toBe(3); expect(transport.loading).toBe(true);
      transport.setTransport(project, 10, true, 1); await vi.advanceTimersByTimeAsync(0);
      rejects[0](new Error('stale')); await vi.advanceTimersByTimeAsync(0); expect(error).not.toHaveBeenCalled();
      rejects[1](new Error('missing source')); await vi.advanceTimersByTimeAsync(0); expect(error).toHaveBeenCalledWith(expect.stringContaining('missing source'));
      expect(transport.loading).toBe(false); expect(context.sources).toHaveLength(0);
    } finally { transport.dispose(); }
  });
});
