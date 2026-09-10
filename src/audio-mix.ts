import type { AudioSlice } from './audio-plan';
import { AUDIO_SAMPLE_RATE } from './audio-plan';
import { fadeAt } from './render';
import type { AudioBufferCache } from './audio';

import { crossfadeGain } from '../shared/transitions.mjs';
import { volumeAt } from '../shared/volume-automation.mjs';
export const MIX_BATCH_SIZE = 4;

// Render only a short block at output speed. Both the scratch graph (four source
// windows) and the live graph (short stereo blocks) stay bounded as tracks grow.
export async function mixAudioBlock(output: AudioBuffer, slices: AudioSlice[], cache: AudioBufferCache, current: () => boolean): Promise<AudioBuffer | undefined> {
  for (let offset = 0; offset < slices.length; offset += MIX_BATCH_SIZE) {
    if (!current()) return;
    const batch = slices.slice(offset, offset + MIX_BATCH_SIZE);
    const buffers = await Promise.all(batch.map(slice => cache.get(slice.asset, slice.chunk, slice.reverse, slice.clip.audioTreatment)));
    if (!current()) return;
    // Unity-rate PCM needs no resampling. Avoid creating a separate rendering
    // context every 100 ms for ordinary forward/reverse playback.
    const aligned = (seconds: number) => Math.abs(seconds * AUDIO_SAMPLE_RATE - Math.round(seconds * AUDIO_SAMPLE_RATE)) < 0.0001;
    if (batch.every(slice => slice.playbackRate === 1 && aligned(slice.when) && aligned(slice.offset) && aligned(slice.duration))) {
      batch.forEach((slice, i) => {
        const start = Math.max(0, Math.round(slice.when * AUDIO_SAMPLE_RATE)), sourceStart = Math.max(0, Math.round(slice.offset * AUDIO_SAMPLE_RATE));
        const length = Math.min(Math.round(slice.duration * AUDIO_SAMPLE_RATE), output.length - start, buffers[i].length - sourceStart);
        const timelineStep = (slice.timelineEnd - slice.timelineStart) / (slice.duration * AUDIO_SAMPLE_RATE);
        const left = output.getChannelData(0), right = output.getChannelData(1), sourceLeft = buffers[i].getChannelData(0), sourceRight = buffers[i].getChannelData(1);
        for (let sample = 0; sample < length; sample++) {
          const time = slice.timelineStart + sample * timelineStep;
          const gain = slice.clip.volume * volumeAt(slice.clip.volumeKeyframes, time - slice.clip.start) * fadeAt(slice.clip, time) * crossfadeGain(slice.envelopes, time);
          left[start + sample] += sourceLeft[sourceStart + sample] * gain;
          right[start + sample] += sourceRight[sourceStart + sample] * gain;
        }
      });
      continue;
    }
    const offline = new OfflineAudioContext(2, output.length, AUDIO_SAMPLE_RATE);
    const nodes: { source: AudioBufferSourceNode; gain: GainNode }[] = [];
    try {
      batch.forEach((slice, i) => {
        const when = Math.max(0, slice.when);
        const source = offline.createBufferSource(); source.buffer = buffers[i]; source.playbackRate.value = slice.playbackRate;
        // At high shuttle rates even a one-frame dip can fit between 33 points.
        // Keyed gain therefore follows each output sample in this bounded block.
        const gain = offline.createGain(); const envelope = new Float32Array(slice.clip.volumeKeyframes?.length ? Math.max(2, Math.ceil(slice.duration * AUDIO_SAMPLE_RATE) + 1) : 33);
        for (let j = 0; j < envelope.length; j++) {
          const time = slice.timelineStart + (slice.timelineEnd - slice.timelineStart) * j / (envelope.length - 1);
          envelope[j] = slice.clip.volume * volumeAt(slice.clip.volumeKeyframes, time - slice.clip.start) * fadeAt(slice.clip, time) * crossfadeGain(slice.envelopes, time);
        }
        gain.gain.setValueCurveAtTime(envelope, when, slice.duration);
        source.connect(gain); gain.connect(offline.destination); nodes.push({ source, gain });
        source.start(when, Math.max(0, slice.offset), slice.sourceDuration);
        source.stop(when + slice.duration);
      });
      const rendered = await offline.startRendering();
      if (!current()) return;
      for (let channel = 0; channel < 2; channel++) {
        const target = output.getChannelData(channel); const data = rendered.getChannelData(channel);
        for (let i = 0; i < target.length; i++) target[i] += data[i];
      }
    } finally {
      for (const { source, gain } of nodes) { source.disconnect(); source.buffer = null; gain.disconnect(); }
    }
  }
  return current() ? output : undefined;
}
