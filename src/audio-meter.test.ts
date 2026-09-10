import { describe, expect, it } from 'vitest';
import { AudioMeterDisplay, ScheduledAudioPeaks, formatMeterDb, meterPercent, meterZone, peakDb } from './audio-meter';

const buffer = (left: number[], right = left.map(v => -v)) => ({ length: left.length, getChannelData: (channel: number) => Float32Array.from(channel ? right : left) });
describe('stereo sample peaks on the playback clock', () => {
  it('does not cancel opposite phases or reveal a future peak', () => {
    const meter = new ScheduledAudioPeaks();
    meter.schedule(buffer([.125, .25, 1.25, .5]), 10, 1, 4);
    expect(meter.read(9)).toEqual([0, 0]);
    expect(meter.read(10.5)).toEqual([.25, .25]);
    expect(meter.read(10.75)).toEqual([1.25, 1.25]);
    expect(meter.read(11)).toEqual([.5, .5]);
    expect(meter.read(12)).toEqual([0, 0]);
  });
  it('keeps a one-sample transient across a UI stall and ignores samples after source.stop', () => {
    const meter = new ScheduledAudioPeaks();
    meter.schedule(buffer([0, 1.125, 0, 0]), 0, 1, 4);
    meter.schedule(buffer([.25, .5, .75, 9], [.5, 0, 0, 9]), 1, .75, 4);
    expect(meter.read(2)).toEqual([1.125, 1.125]);
    expect(meter.read(3)).toEqual([0, 0]);
  });
  it('measures L/R independently and drops pending audio on seek/stop', () => {
    const meter = new ScheduledAudioPeaks();
    meter.schedule(buffer([.125, .125], [.5, -.5]), 0, 1, 2);
    expect(meter.read(.5)).toEqual([.125, .5]);
    meter.clear();
    expect(meter.read(10)).toEqual([0, 0]);
    meter.schedule(buffer([.25], [0]), 11, .5, 2);
    expect(meter.read(12)).toEqual([.25, 0]);
  });
});
describe('calibrated dBFS display and peak memory', () => {
  it('uses a fixed -60..0 dBFS scale with precise zone boundaries', () => {
    expect(peakDb(1)).toBe(0); expect(peakDb(.5)).toBeCloseTo(-6.0206, 4);
    expect(peakDb(0)).toBe(-Infinity); expect(formatMeterDb(-Infinity)).toBe('−∞');
    expect(meterZone(-12.001)).toBe('green'); expect(meterZone(-12)).toBe('yellow');
    expect(meterZone(-3.001)).toBe('yellow'); expect(meterZone(-3)).toBe('red');
    expect(meterPercent(-12)).toBe(80); expect(meterPercent(-3)).toBe(95);
    expect(meterPercent(-Infinity)).toBe(0); expect(meterPercent(-100)).toBe(0); expect(meterPercent(6)).toBe(100);
  });
  it('holds peaks for 1.5 seconds then falls using elapsed time', () => {
    const display = new AudioMeterDisplay();
    display.update([.5, .25], 100);
    const quiet = display.update([0, 0], 1600);
    expect(quiet.db).toEqual([-Infinity, -Infinity]); expect(quiet.held[0]).toBeCloseTo(peakDb(.5));
    expect(display.update([0, 0], 1850).held[0]).toBeCloseTo(peakDb(.5) - 6);
    expect(display.update([0, 0], 6000).held).toEqual([-Infinity, -Infinity]);
    expect(display.update([0, 0], 6100).maximum).toBeCloseTo(peakDb(.5));
  });
  it('latches full scale on either channel, distinguishes red from CLIP, and resets', () => {
    const display = new AudioMeterDisplay();
    expect(display.update([.9, 0], 0).clipped).toBe(false);
    expect(display.update([0, 1], 25).clipped).toBe(true);
    expect(display.update([1.5, 0], 50).maximum).toBeCloseTo(3.5218, 4);
    expect(display.update([0, 0], 10000).clipped).toBe(true);
    expect(display.reset()).toEqual({ db: [-Infinity, -Infinity], held: [-Infinity, -Infinity], maximum: -Infinity, clipped: false });
    expect(display.update([0, 0], 10025).clipped).toBe(false);
  });
  it('restarts the full hold when a quieter transient overtakes the falling line', () => {
    const display = new AudioMeterDisplay();
    display.update([.5, 0], 100);
    display.update([0, 0], 1850); // Held line has fallen to about -12.02 dBFS.
    const peak = 10 ** (-12.3 / 20);
    expect(display.update([peak, 0], 1875).held[0]).toBeCloseTo(-12.3);
    expect(display.update([0, 0], 3375).held[0]).toBeCloseTo(-12.3);
    expect(display.update([0, 0], 3625).held[0]).toBeCloseTo(-18.3);
  });
});
