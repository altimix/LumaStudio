const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ffmpeg, run, probe, inspectMedia } = require('../electron/media.cjs');
const { buildExport, exportProject } = require('../electron/export.cjs');
const { exportMp3 } = require('../electron/audio-export.cjs');
const { audioClips, buildMp3Audio } = require('../electron/timeline-audio.cjs');

let dir, video, voice;
before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-mp3-export-'));
  const videoPath = path.join(dir, '映像 & 音声.mp4');
  const voicePath = path.join(dir, 'BGM 音声.wav');
  await run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=30:d=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4:sample_rate=48000', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', videoPath]);
  await run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=4:sample_rate=48000', '-c:a', 'pcm_s16le', voicePath]);
  video = await inspectMedia(videoPath, path.join(dir, 'video-cache'));
  voice = await inspectMedia(voicePath, path.join(dir, 'voice-cache'));
});
after(async () => { if (dir) await fs.rm(dir, { recursive: true, force: true }); });

function clip(id, asset, kind, trackId, start, duration, patch = {}) {
  return { id, assetId: asset.id, trackId, name: id, kind, start, in: 0, duration, speed: 1,
    x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, exposure: 0, contrast: 1, saturation: 1,
    volume: 1, fadeIn: 0, fadeOut: 0, ...patch };
}
function project() {
  return {
    version: 1, id: 'mp3-export', name: 'MP3 export', width: 320, height: 180, fps: 30,
    assets: [video, voice], markers: [],
    tracks: [{ id: 'v', name: '映像', kind: 'video' }, { id: 'a', name: '音声', kind: 'audio' }],
    clips: [
      clip('video-audio', video, 'video', 'v', 0, 2, { volume: .8 }),
      clip('voice', voice, 'audio', 'a', 1, 2, { volume: .6, fadeIn: .5, fadeOut: .5 }),
      clip('video-silent', video, 'video', 'v', 3, 1, { audioMuted: true }),
    ],
  };
}
async function rms(file, time) {
  const bytes = await run(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', file, '-t', '0.15', '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1']);
  let sum = 0;
  for (let offset = 0; offset < bytes.length; offset += 4) sum += bytes.readFloatLE(offset) ** 2;
  return Math.sqrt(sum / (bytes.length / 4));
}

test('MP3 contains the same edited timeline mix as MP4, with no video stream', async () => {
  const p = project(), mp3 = path.join(dir, '書き出し.mp3'), mp4 = path.join(dir, '比較.mp4');
  const progress = [];
  const args = buildMp3Audio(p, mp3);
  assert.equal(args.filter(arg => arg === '-i').length, 3);
  assert.ok(!args.includes('-c:v'));
  await exportMp3(p, mp3, { onProgress: value => progress.push(value) });
  await exportProject(p, { width: 320, height: 180, fps: 30, quality: 'draft', encoder: 'cpu' }, mp4);
  const info = await probe(mp3), stream = info.streams.find(item => item.codec_type === 'audio');
  assert.equal(info.streams.some(item => item.codec_type === 'video'), false);
  assert.equal(stream.codec_name, 'mp3');
  assert.equal(Number(stream.sample_rate), 48000);
  assert.equal(stream.channels, 2);
  assert.ok(Math.abs(Number(info.format.duration) - 4) < .08);
  for (const time of [.4, 1.5, 2.5]) {
    const mp3Level = await rms(mp3, time), mp4Level = await rms(mp4, time);
    assert.ok(mp3Level > .01, `audible at ${time}`);
    assert.ok(Math.abs(mp3Level - mp4Level) / mp4Level < .2, `mix level at ${time}: ${mp3Level} / ${mp4Level}`);
  }
  assert.ok(await rms(mp3, 3.4) < .005, 'silent tail remains silent');
  assert.equal(progress.at(-1).status, 'complete');
  assert.equal(progress.at(-1).progress, 1);
});

test('an audio-only timeline exports MP3 without preparing any visual input', async () => {
  const p = project(); p.clips = [p.clips[1]];
  const out = path.join(dir, '音声のみ.mp3');
  assert.equal(buildMp3Audio(p, out).filter(arg => arg === '-i').length, 2);
  await exportMp3(p, out);
  assert.equal((await probe(out)).streams[0].codec_name, 'mp3');
  assert.ok(await rms(out, .4) < .005);
  assert.ok(await rms(out, 1.7) > .01);
});

test('fully-zero volume points count as no exportable audio before choosing a destination', async () => {
  const p = project();
  p.clips = [{ ...p.clips[1], audioTreatment: 'speech', volumeKeyframes: [{ time: 0, value: 0 }, { time: 2, value: 0 }] }];
  assert.equal(audioClips(p).length, 1, 'MP4 preparation still includes treated clips in its graph');
  const mp4Settings = { width: 320, height: 180, fps: 30, quality: 'draft' };
  const mp4Sources = { [voice.id]: voice.path }, mp4Output = path.join(dir, '音量0.mp4');
  assert.throws(() => buildExport(p, mp4Settings, mp4Sources, mp4Output), /自動調整した音声を準備できませんでした/);
  assert.doesNotThrow(() => buildExport(p, mp4Settings, mp4Sources, mp4Output, { [p.clips[0].id]: voice.path }));
  assert.equal(audioClips(p, { audibleOnly: true }).length, 0);
  assert.throws(() => buildMp3Audio(p, path.join(dir, '無音.mp3')), /書き出せる音声がありません/);
  await assert.rejects(exportMp3(p, path.join(dir, '無音.mp3')), /書き出せる音声がありません/);
  p.clips[0].volumeKeyframes[1].value = .5;
  assert.equal(audioClips(p, { audibleOnly: true }).length, 1, 'a rising envelope remains audible');
});

test('no audible clips, missing media, cancellation and source overwrite preserve existing files', async () => {
  const out = path.join(dir, '保護.mp3'), original = Buffer.from('existing user file');
  await fs.writeFile(out, original);
  const muted = project(); muted.clips = muted.clips.map(item => ({ ...item, audioMuted: true }));
  await assert.rejects(exportMp3(muted, out), /書き出せる音声がありません/);
  const missing = project(); missing.assets = missing.assets.map(item => item.id === voice.id ? { ...item, path: path.join(dir, 'missing.wav') } : item);
  await assert.rejects(exportMp3(missing, out), /MP3を書き出せませんでした/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(exportMp3(project(), out, { signal: controller.signal }), /キャンセル/);
  assert.deepEqual(await fs.readFile(out), original);
  assert.equal((await fs.readdir(dir)).some(name => name.startsWith('.luma-') && name.endsWith('.mp3')), false);
  const source = await inspectMedia(path.join(dir, '書き出し.mp3'), path.join(dir, 'mp3-cache'));
  const self = project(); self.assets = [source]; self.clips = [clip('self', source, 'audio', 'a', 0, 1)];
  await assert.rejects(exportMp3(self, source.path), /元の素材/);
});
