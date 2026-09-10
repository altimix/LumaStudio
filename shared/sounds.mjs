export const SOUNDS = [
  { id: 'ping', name: 'ピーン', duration: 0.85, revision: 2 },
  { id: 'chime', name: 'チャイム', duration: 0.9, revision: 1 },
  { id: 'jingle', name: '短いジングル', duration: 1.4, revision: 2 }
];

export function soundDurationForFps(id, fps) {
  const sound = SOUNDS.find(s => s.id === id);
  if (!sound) throw new Error('効果音の種類が不正です。');
  if (!Number.isInteger(fps) || fps < 1 || fps > 120) throw new Error('効果音のフレームレートが不正です。');
  // Whole seconds are on every supported integer-FPS grid, including grids
  // selected after insertion. Padding to only the current frame can be rounded
  // down by a later FPS change and cut into the audible tail.
  return Math.ceil(sound.duration);
}

// Original deterministic synthesis; no recordings, samples or external services.
// Increment the cue's revision whenever its samples change: saved projects keep
// referring to the previous file, including the retired v1 pop and jingle.
function bell(t, frequency, decay) {
  const phase = 2 * Math.PI * frequency * t;
  const partials = Math.sin(phase)
    + 0.24 * Math.exp(-t * 8) * Math.sin(phase * 2.76)
    + 0.1 * Math.exp(-t * 12) * Math.sin(phase * 3.95);
  return partials * Math.min(1, t / 0.004) * Math.exp(-t * decay);
}

export function soundWave(id, minimumDuration = 0) {
  const sound = SOUNDS.find(s => s.id === id);
  if (!sound) throw new Error('効果音の種類が不正です。');
  if (!Number.isFinite(minimumDuration) || minimumDuration < 0 || minimumDuration > Math.ceil(sound.duration)) throw new Error('効果音の最小時間が不正です。');
  const rate = 48000, audibleFrames = Math.round(sound.duration * rate);
  const frames = Math.ceil(Math.max(sound.duration, minimumDuration) * rate);
  const bytes = new Uint8Array(44 + frames * 4), v = new DataView(bytes.buffer);
  const ascii = (at, text) => [...text].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, 'RIFF'); v.setUint32(4, bytes.length - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  ascii(36, 'data'); v.setUint32(40, frames * 4, true);

  // A quick rising run, then a bright resolving chord with a ringing tail.
  const jingle = [[0, 659.25, .22], [.12, 830.61, .24], [.24, 987.77, .26], [.38, 1318.51, .28],
    [.56, 659.25, .1], [.56, 987.77, .1], [.56, 1318.51, .26], [.56, 1975.53, .07]];
  const samples = new Float64Array(audibleFrames);
  let peak = 0;
  for (let i = 0; i < audibleFrames; i++) {
    const t = i / rate;
    let sample = 0;
    if (id === 'ping') sample = .42 * bell(t, 1760, 4);
    else if (id === 'jingle') {
      for (const [start, frequency, gain] of jingle) {
        const dt = t - start;
        if (dt >= 0) sample += gain * bell(dt, frequency, start < .56 ? 7 : 4.5);
      }
    } else {
      // Keep v1 chime samples byte-for-byte unchanged.
      for (const [start, f] of [[0, 1318.51], [.14, 1975.53]]) {
        const dt = t - start;
        if (dt >= 0) sample += (Math.sin(2 * Math.PI * f * dt) + .12 * Math.sin(2 * Math.PI * f * 2 * dt)) * Math.min(1, dt / .009) * Math.exp(-dt * 7) * .14;
      }
    }
    samples[i] = sample * Math.min(1, (sound.duration - t) / .04);
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  // Leave mixing headroom without flattening transients. Silent padding never
  // changes the cue's gain or samples, even in a one-FPS sequence.
  const gain = peak > .48 ? .48 / peak : 1;
  for (let i = 0; i < audibleFrames; i++) {
    const value = Math.round(samples[i] * gain * 32767);
    v.setInt16(44 + i * 4, value, true); v.setInt16(46 + i * 4, value, true);
  }
  return bytes;
}
