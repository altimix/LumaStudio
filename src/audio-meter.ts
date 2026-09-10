export type StereoPeaks = readonly [number, number];
export const METER_FLOOR = -60;
export const METER_YELLOW = -12;
export const METER_RED = -3;
export const PEAK_HOLD_MS = 1500;

export const peakDb = (peak: number) => peak > 0 && Number.isFinite(peak) ? 20 * Math.log10(peak) : -Infinity;
export const meterPercent = (db: number) => Math.max(0, Math.min(100, (db - METER_FLOOR) / -METER_FLOOR * 100));
export const meterZone = (db: number) => db >= METER_RED ? 'red' : db >= METER_YELLOW ? 'yellow' : 'green';
export const formatMeterDb = (db: number) => Number.isFinite(db) ? `${db > 0 ? '+' : ''}${db.toFixed(1)}` : '−∞';

// Observe the already mixed stereo PCM using the playback clock. Unlike a
// periodically sampled mono AnalyserNode, this cannot cancel opposite phases
// or miss a one-sample peak between UI updates. No samples are copied or changed.
export class ScheduledAudioPeaks {
  private blocks: { channels: StereoSamples; when: number; end: number; rate: number; length: number; cursor: number }[] = [];
  schedule(buffer: Pick<AudioBuffer, 'getChannelData' | 'length'>, when: number, duration: number, rate: number) {
    this.blocks.push({ channels: [buffer.getChannelData(0), buffer.getChannelData(1)], when, end: when + duration, rate,
      length: Math.min(buffer.length, Math.ceil(duration * rate - 1e-6)), cursor: 0 });
  }
  read(time: number): StereoPeaks {
    const peak: [number, number] = [0, 0];
    let consumed = 0;
    for (const block of this.blocks) {
      const end = Math.max(0, Math.min(block.length, Math.ceil((Math.min(time, block.end) - block.when) * block.rate - 1e-6)));
      for (let i = block.cursor; i < end; i++) {
        peak[0] = Math.max(peak[0], Math.abs(block.channels[0][i]));
        peak[1] = Math.max(peak[1], Math.abs(block.channels[1][i]));
      }
      block.cursor = end;
      if (end < block.length) break;
      consumed++;
    }
    if (consumed) this.blocks.splice(0, consumed);
    return peak;
  }
  clear() { this.blocks = []; }
}
type StereoSamples = readonly [Float32Array, Float32Array];

export interface MeterDisplay {
  db: readonly [number, number];
  held: readonly [number, number];
  maximum: number;
  clipped: boolean;
}
export const silentMeter = (): MeterDisplay => ({ db: [-Infinity, -Infinity], held: [-Infinity, -Infinity], maximum: -Infinity, clipped: false });

export class AudioMeterDisplay {
  private value = silentMeter();
  private holdUntil = [0, 0];
  private lastTime = 0;
  update(peaks: StereoPeaks, now: number): MeterDisplay {
    const db = peaks.map(peakDb) as [number, number];
    const held = db.map((level, channel) => {
      const elapsed = Math.max(0, now - Math.max(this.lastTime, this.holdUntil[channel]));
      const falling = this.value.held[channel] - elapsed * .024;
      if (level >= falling && Number.isFinite(level)) {
        this.holdUntil[channel] = now + PEAK_HOLD_MS;
        return level;
      }
      return Math.max(level, falling < METER_FLOOR ? -Infinity : falling);
    }) as [number, number];
    this.lastTime = now;
    this.value = { db, held, maximum: Math.max(this.value.maximum, ...db), clipped: this.value.clipped || peaks.some(peak => peak >= 1) };
    return this.value;
  }
  reset() { this.value = silentMeter(); this.holdUntil = [0, 0]; this.lastTime = 0; return this.value; }
}
