const { test } = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs/promises'); const path = require('node:path'); const os = require('node:os');
const { decodeAudioChunk, createAudioReader, SAMPLE_RATE } = require('../electron/audio.cjs');
const { audioFixture } = require('./helpers/audio.cjs');
const { ffmpeg, run } = require('../electron/media.cjs');

test('FFmpeg reads exact stereo source windows from Japanese paths and pads only the tail', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-audio-')); const file = path.join(dir, '音声 波形 & original.wav');
  try {
    const source = await audioFixture(file, 10);
    const first = await decodeAudioChunk(file, 0); const last = await decodeAudioChunk(file, 1);
    assert.deepEqual(first, source.slice(0, first.length));
    assert.deepEqual(last.slice(0, SAMPLE_RATE * 2 * 2), source.slice(SAMPLE_RATE * 8 * 2));
    assert.ok(last.slice(SAMPLE_RATE * 2 * 2).every(v => v === 0));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('audio IPC reader rejects unregistered paths, non-audio assets and invalid windows', async () => {
  let calls = 0; const reader = createAudioReader(async () => { calls++; return new Float32Array(1); });
  reader.register('media://local/asset/a?v=1', { path: 'source.wav', duration: 16, hasAudio: true });
  reader.register('media://local/asset/no-audio', { path: 'silent.mp4', duration: 16, hasAudio: false });
  for (const [url, index] of [['C:\\secret.wav', 0], ['media://local/asset/a?v=old', 0], ['media://local/asset/no-audio', 0], ['media://local/asset/a?v=1', -1], ['media://local/asset/a?v=1', 2], ['media://local/asset/a?v=1', 0.5], ['media://local/asset/a?v=1', Infinity]]) await assert.rejects(reader.read(url, index), /不正/);
  assert.equal(calls, 0); reader.close();
});
test('AAC windows retain container timing including delayed embedded audio', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-aac-')); const source = path.join(dir, 'source.wav'); const file = path.join(dir, '音声 遅延.mp4');
  try {
    await audioFixture(source, 10);
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=12', '-itsoffset', '2', '-i', source,
      '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-b:a', '192k', '-t', '12', file]);
    const bytes = await run(ffmpeg, ['-v', 'error', '-i', file, '-map', '0:a:0', '-af', 'aresample=48000:async=1:first_pts=0', '-ac', '2', '-ar', '48000', '-f', 'f32le', 'pipe:1']);
    const reference = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const first = await decodeAudioChunk(file, 0); const second = await decodeAudioChunk(file, 1);
    assert.ok(first.slice(0, SAMPLE_RATE * 1.9 * 2).every(v => Math.abs(v) < 1e-7), 'audio starts at its container timestamp, not at zero');
    // Include the first sample: decoder warm-up must not leak into each audible window.
    let error = 0; let energy = 0;
    for (let i = 0; i < SAMPLE_RATE * 2 * 2; i++) { const value = reference[SAMPLE_RATE * 8 * 2 + i]; error += (second[i] - value) ** 2; energy += value ** 2; }
    assert.ok(error / energy < 1e-6, `AAC source-window timing error: ${error / energy}`);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('AAC without a stream offset has no decoder startup transient at an exact packet boundary', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-aac-seam-')); const source = path.join(dir, 'source.wav'); const file = path.join(dir, 'audio.m4a');
  try {
    await audioFixture(source, 10); await run(ffmpeg, ['-v', 'error', '-i', source, '-c:a', 'aac', '-b:a', '192k', file]);
    const bytes = await run(ffmpeg, ['-v', 'error', '-i', file, '-af', 'aresample=48000:async=1:first_pts=0', '-ac', '2', '-ar', '48000', '-f', 'f32le', 'pipe:1']);
    const reference = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const next = await decodeAudioChunk(file, 1); let peakError = 0;
    for (let i = 0; i < SAMPLE_RATE * 2; i++) peakError = Math.max(peakError, Math.abs(next[i] - reference[SAMPLE_RATE * 8 * 2 + i]));
    assert.ok(peakError < 1e-4, `decoder startup transient: ${peakError}`);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('audio decoding deduplicates, limits concurrent work and cancels on shutdown', async () => {
  const jobs = []; let active = 0; let peak = 0;
  const reader = createAudioReader((file, index, signal) => new Promise((resolve, reject) => {
    peak = Math.max(peak, ++active); const finish = () => { active--; resolve(new Float32Array([index])); }; jobs.push(finish);
    signal.addEventListener('abort', () => { active--; reject(new Error('aborted')); }, { once: true });
  }));
  const url = 'media://local/asset/long?v=1'; reader.register(url, { path: 'source.wav', duration: 1000, hasAudio: true });
  const first = reader.read(url, 0); assert.equal(reader.read(url, 0), first);
  const rest = Array.from({ length: 31 }, (_, i) => reader.read(url, i + 1));
  const outcomes = Promise.allSettled([first, ...rest]);
  await assert.rejects(reader.read(url, 32), /混雑/); await Promise.resolve(); assert.equal(peak, 2);
  jobs[0](); await first; await new Promise(resolve => setImmediate(resolve)); assert.equal(peak, 2);
  reader.close(); const results = await outcomes; assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(active, 0); await assert.rejects(reader.read(url, 0), /不正/);
});
