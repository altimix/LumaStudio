import { create } from 'zustand';
import { AudioMeterDisplay, silentMeter, type MeterDisplay, type StereoPeaks } from './audio-meter';

// Meter refreshes must not notify the timeline/editor store or enter Undo history.
const display = new AudioMeterDisplay();
let discardPlayedSamples: (() => void) | undefined;
export function bindAudioMeterReset(discard: () => void) {
  discardPlayedSamples = discard;
  return () => { if (discardPlayedSamples === discard) discardPlayedSamples = undefined; };
}
export const useAudioMeter = create<MeterDisplay>(() => silentMeter());
export function publishAudioPeaks(peaks: StereoPeaks) {
  const next = display.update(peaks, performance.now());
  const old = useAudioMeter.getState();
  if (next.maximum !== old.maximum || next.clipped !== old.clipped || next.db.some((v, i) => v !== old.db[i]) || next.held.some((v, i) => v !== old.held[i])) useAudioMeter.setState(next);
}
export function resetAudioMeter() {
  // Consume only samples before this click. Keep scheduled future PCM so sound
  // that plays after the reset can establish a new peak without restarting audio.
  discardPlayedSamples?.();
  useAudioMeter.setState(display.reset());
}
