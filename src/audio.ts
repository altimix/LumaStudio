import type { Asset, Clip, Project } from './types';
import { endTime } from './model';
import { audioSlices, AUDIO_CHUNK_SECONDS, AUDIO_SAMPLE_RATE } from './audio-plan';
import { mixAudioBlock } from './audio-mix';
import { ScheduledAudioPeaks, type StereoPeaks } from './audio-meter';

const CACHE_BYTES = 64 * 1024 * 1024;
const BLOCK = 0.1;
// Keep enough short PCM blocks ahead for waveform/UI work and GC on slower
// Windows hosts. Stop/seek still cancels them immediately; LEAD is unchanged.
const LOOKAHEAD = 0.8;
const LEAD = 0.03;
type Cached = { forward: AudioBuffer; reverse?: AudioBuffer };

export class AudioBufferCache {
  private entries = new Map<string, Cached>();
  private pending = new Map<string, Promise<Cached>>();
  private queue: { key: string; asset: Asset; chunk: number; treatment?: Clip['audioTreatment']; resolve: (samples: Float32Array) => void; reject: (error: Error) => void }[] = [];
  private reading = 0;
  private disposed = false;
  constructor(private context: BaseAudioContext, private read: (asset: Asset, chunk: number, treatment?: Clip['audioTreatment']) => Promise<Float32Array>, private limit = CACHE_BYTES) {}
  get bytes() { let size = 0; for (const entry of this.entries.values()) size += entry.forward.length * 8 * (entry.reverse ? 2 : 1); return size; }
  async get(asset: Asset, chunk: number, reverse: boolean, treatment?: Clip['audioTreatment']): Promise<AudioBuffer> {
    if (this.disposed) throw new Error('音声プレビューは終了しました。');
    const key = `${asset.url}:${chunk}:${treatment || 'original'}`; let entry = this.entries.get(key);
    if (!entry) {
      let pending = this.pending.get(key);
      if (!pending) {
        pending = new Promise<Float32Array>((resolve, reject) => { this.queue.push({ key, asset, chunk, treatment, resolve, reject }); this.drain(); }).then(samples => {
          if (this.disposed) throw new Error('音声プレビューは終了しました。');
          if (samples.length !== AUDIO_CHUNK_SECONDS * AUDIO_SAMPLE_RATE * 2) throw new Error('音声データの長さが不正です。');
          const forward = this.context.createBuffer(2, samples.length / 2, AUDIO_SAMPLE_RATE);
          for (let channel = 0; channel < 2; channel++) {
            const data = forward.getChannelData(channel);
            for (let i = 0; i < data.length; i++) data[i] = samples[i * 2 + channel];
          }
          const result = { forward }; this.entries.set(key, result); this.evict(); return result;
        }).finally(() => { if (this.pending.get(key) === pending) this.pending.delete(key); });
        this.pending.set(key, pending);
      }
      entry = await pending;
    }
    if (reverse && !entry.reverse) {
      entry.reverse = this.context.createBuffer(2, entry.forward.length, AUDIO_SAMPLE_RATE);
      for (let channel = 0; channel < 2; channel++) entry.reverse.getChannelData(channel).set(entry.forward.getChannelData(channel).slice().reverse());
    }
    this.entries.delete(key); this.entries.set(key, entry); this.evict();
    return reverse ? entry.reverse! : entry.forward;
  }
  private drain() {
    while (!this.disposed && this.reading < 2 && this.queue.length) {
      const job = this.queue.shift()!; this.reading++;
      Promise.resolve().then(() => this.read(job.asset, job.chunk, job.treatment)).then(job.resolve, job.reject).finally(() => { this.reading--; this.drain(); });
    }
  }
  cancelPending() {
    // Keep the two active decodes reusable, but discard obsolete queued work immediately.
    for (const job of this.queue.splice(0)) { this.pending.delete(job.key); job.reject(new Error('音声の読み込みを取り消しました。')); }
  }
  private evict() { while (this.bytes > this.limit && this.entries.size) this.entries.delete(this.entries.keys().next().value!); }
  dispose() { this.disposed = true; this.cancelPending(); this.entries.clear(); this.pending.clear(); }
}

function audioReader(context: AudioContext) {
  // The web demo only accepts small assets. Windows always uses bounded FFmpeg windows.
  const web = new Map<string, Promise<AudioBuffer>>();
  return async (asset: Asset, chunk: number, treatment?: Clip['audioTreatment']): Promise<Float32Array> => {
    if (window.luma) return window.luma.readAudioChunk(asset.url, chunk, treatment);
    if (treatment) throw new Error('音声の自動調整はデスクトップ版でご利用ください。');
    if (asset.size > 32 * 1024 * 1024 || asset.duration > 120) throw new Error('この素材の音声プレビューはデスクトップアプリでご利用ください。');
    let decoded = web.get(asset.url);
    if (!decoded) {
      decoded = fetch(asset.url).then(r => { if (!r.ok) throw new Error('音声素材を開けません。'); return r.arrayBuffer(); }).then(data => context.decodeAudioData(data));
      web.clear(); web.set(asset.url, decoded);
    }
    const buffer = await decoded; const samples = new Float32Array(AUDIO_SAMPLE_RATE * AUDIO_CHUNK_SECONDS * 2);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1));
      for (let i = 0; i < samples.length / 2; i++) {
        const position = (chunk * AUDIO_CHUNK_SECONDS + i / AUDIO_SAMPLE_RATE) * buffer.sampleRate;
        const index = Math.floor(position); const fraction = position - index;
        samples[i * 2 + channel] = (data[index] || 0) * (1 - fraction) + (data[index + 1] || 0) * fraction;
      }
    }
    return samples;
  };
}

// One clock and one audio graph for both transport directions. HTML video is silent.
// Every command invalidates scheduled work synchronously, including K/L in one frame.
export class TimelineAudio {
  private context?: AudioContext;
  private cache?: AudioBufferCache;
  private analyser?: AnalyserNode;
  private meter = new ScheduledAudioPeaks();
  private nodes = new Set<AudioBufferSourceNode>();
  private generation = 0;
  private pendingGeneration = -1;
  private project?: Project;
  private rate = 1;
  private requested = false;
  private started = false;
  private anchorPosition = 0;
  private anchorTime = 0;
  private queuedUntil = 0;
  private queuedPosition = 0;
  private timer: ReturnType<typeof setInterval>;
  private disposed = false;
  private preparing = false;
  constructor(private onError: (message: string) => void, private onMeter: (peaks: StereoPeaks) => void = () => {}) {
    this.timer = setInterval(() => { this.publishMeter(); void this.pump(); }, 25);
  }
  setTransport(project: Project, position: number, playing: boolean, rate: number) {
    if (this.disposed) return;
    const generation = ++this.generation; this.stopNodes(); this.cache?.cancelPending();
    this.project = project; this.rate = rate; this.requested = playing; this.started = false;
    this.anchorPosition = this.queuedPosition = Math.max(0, Math.min(endTime(project), position));
    this.preparing = playing;
    if (!playing) return;
    try {
      if (!this.context) {
        const context = this.context = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE, latencyHint: 'interactive' });
        this.analyser = context.createAnalyser(); this.analyser.fftSize = 256; this.analyser.connect(context.destination);
        this.cache = new AudioBufferCache(context, audioReader(context));
      }
      // Resume for EVERY play command, not only a transition noticed by RAF.
      void this.context.resume().then(() => { if (generation === this.generation) void this.pump(); }).catch(e => this.fail(generation, e));
    } catch (error) { this.fail(generation, error); }
  }
  get position() {
    if (!this.started || !this.context) return this.anchorPosition;
    const elapsed = Math.max(0, Math.min(this.context.currentTime, this.queuedUntil) - this.anchorTime);
    return Math.max(0, Math.min(endTime(this.project!), this.anchorPosition + elapsed * this.rate));
  }
  get loading() {
    const remaining = this.project && (this.rate > 0 ? endTime(this.project) - this.queuedPosition : this.queuedPosition);
    return this.requested && (this.preparing || (!!remaining && this.started && !!this.context && this.context.currentTime > this.queuedUntil));
  }
  private publishMeter() { this.onMeter(this.started && this.context ? this.meter.read(this.context.currentTime) : [0, 0]); }
  discardPlayedMeterSamples() { if (this.context) this.meter.read(this.context.currentTime); }
  private async pump() {
    const generation = this.generation; const context = this.context; const project = this.project;
    if (!this.requested || !context || context.state !== 'running' || !project || this.pendingGeneration === generation) return;
    this.pendingGeneration = generation;
    try {
      if (!this.started) {
        const to = Math.max(0, Math.min(endTime(project), this.queuedPosition + LOOKAHEAD * this.rate));
        const initial = audioSlices(project, this.queuedPosition, to, this.rate);
        // Only wait for readiness; retaining fulfilled buffers here defeats LRU eviction
        // while a large preload is still decoding its remaining windows.
        await Promise.all(initial.map(async slice => { await this.cache!.get(slice.asset, slice.chunk, slice.reverse, slice.clip.audioTreatment); }));
      }
      while (generation === this.generation && this.requested) {
        if (this.started && this.queuedUntil - context.currentTime >= LOOKAHEAD) break;
        const from = this.queuedPosition;
        const duration = Math.min(BLOCK, (this.rate > 0 ? endTime(project) - from : from) / Math.abs(this.rate));
        if (duration < 1e-9) break;
        const to = from + duration * this.rate;
        const slices = audioSlices(project, from, to, this.rate);
        const block = context.createBuffer(2, Math.max(1, Math.ceil(duration * AUDIO_SAMPLE_RATE - 1e-6)), AUDIO_SAMPLE_RATE);
        const mixed = await mixAudioBlock(block, slices, this.cache!, () => generation === this.generation && this.requested);
        if (!mixed || generation !== this.generation || !this.requested) return;
        // If decoding missed the deadline, freeze at the last audible sample and re-anchor.
        if (this.started && context.currentTime > this.queuedUntil) {
          this.stopNodes(); this.anchorPosition = from; this.started = false;
        }
        if (!this.started) { this.anchorTime = context.currentTime + LEAD; this.queuedUntil = this.anchorTime; this.started = true; }
        const when = this.queuedUntil;
        const source = context.createBufferSource(); source.buffer = mixed; source.connect(this.analyser!); this.nodes.add(source);
        source.onended = () => { source.disconnect(); source.buffer = null; this.nodes.delete(source); };
        source.start(when); source.stop(when + duration);
        this.meter.schedule(mixed, when, duration, AUDIO_SAMPLE_RATE);
        this.queuedUntil += duration; this.queuedPosition = to; this.preparing = false;
      }
    } catch (error) { this.fail(generation, error); }
    finally { if (this.pendingGeneration === generation) this.pendingGeneration = -1; }
  }
  private fail(generation: number, error: unknown) {
    if (generation !== this.generation || this.disposed) return;
    this.requested = false; this.preparing = false; this.stopNodes();
    this.onError(`音声を再生できません: ${(error as Error).message}`);
  }
  private stopNodes() {
    // Flush samples already played before K/seek invalidates the queue, so a
    // transient immediately before stopping still reaches the CLIP latch.
    this.publishMeter(); this.meter.clear();
    for (const source of this.nodes) { source.stop(); source.disconnect(); source.buffer = null; } this.nodes.clear();
  }
  dispose() { this.disposed = true; this.requested = false; this.generation++; clearInterval(this.timer); this.stopNodes(); this.cache?.dispose(); void this.context?.close(); }
}
