const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ffmpeg, run, inspectMedia, probe } = require('../electron/media.cjs');
const { exportProject } = require('../electron/export.cjs');
const { directCopyClip, directCopySource, copyUnchangedMovie } = require('../electron/export-direct-copy.cjs');

let dir, asset;
const settings = { width: 320, height: 180, fps: 10, quality: 'standard', encoder: 'auto' };
before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-direct-copy-'));
  const source = path.join(dir, '原本 [video] & sound.mp4');
  await run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=10:d=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2:sample_rate=48000',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2',
    '-t', '2', '-movflags', '+faststart', source]);
  asset = await inspectMedia(source, path.join(dir, 'cache'), { skipCache: true });
});
after(async () => { if (dir) await fs.rm(dir, { recursive: true, force: true }); });

function project(patch = {}) {
  const clip = { id: 'c1', assetId: asset.id, trackId: 'v1', name: asset.name, kind: 'video',
    start: 0, in: 0, duration: asset.duration, speed: 1, x: 0, y: 0, scale: 1, rotation: 0,
    opacity: 1, exposure: 0, contrast: 1, saturation: 1, volume: 1, fadeIn: 0, fadeOut: 0,
    text: '', fontSize: 94, color: '#fff', textStyle: 'hero', ...patch };
  return { version: 1, id: 'p', name: 'Direct copy', width: 320, height: 180, fps: 10,
    assets: [asset], clips: [clip], markers: [], tracks: [{ id: 'v1', name: 'Video 1', kind: 'video',
      hidden: false, muted: false, locked: false, solo: false }] };
}

function importedProject() {
  const p = project({ audioDetached: true, linkId: 'linked-av' });
  p.tracks.push({ id: 'a1', name: 'Audio 1', kind: 'audio', hidden: false,
    muted: false, locked: false, solo: false });
  p.clips.push({ ...p.clips[0], id: 'a1', trackId: 'a1', kind: 'audio',
    name: `${asset.name}（音声）`, audioDetached: undefined });
  return p;
}

test('an untouched MP4 skips encoder detection and preserves video and audio bytes', async () => {
  const p = project(), output = path.join(dir, '複製.mp4');
  assert.ok(directCopyClip(p, settings));
  assert.equal((await directCopySource(p, settings)).path, asset.path);
  await fs.writeFile(output, 'previous output');
  const progress = [];
  await exportProject(p, settings, output, { encoders: { resolve: () => { throw Error('encoder detected'); } },
    onProgress: item => progress.push(item) });
  assert.deepEqual(await fs.readFile(output), await fs.readFile(asset.path));
  assert.match(progress.at(-1).encoderLabel, /再圧縮なし/);
  const info = await probe(output);
  assert.equal(info.streams.find(stream => stream.codec_type === 'video').nb_frames, '20');
  assert.equal(info.streams.find(stream => stream.codec_type === 'audio').sample_rate, '48000');
  const audio = file => run(ffmpeg, ['-v', 'error', '-i', file, '-vn', '-f', 'f32le', '-ar', '48000', '-ac', '2', 'pipe:1']);
  assert.deepEqual(await audio(output), await audio(asset.path));
});

test('the linked video and audio created by a normal import use direct copy', async () => {
  const p = importedProject(), output = path.join(dir, 'リンクした無編集.mp4');
  assert.ok(directCopyClip(p, settings));
  assert.equal((await directCopySource(p, settings)).path, asset.path);
  await exportProject(p, settings, output, { encoders: { resolve: () => {
    throw Error('encoder detected');
  } } });
  assert.deepEqual(await fs.readFile(output), await fs.readFile(asset.path));
});

test('edits to either half of the linked pair keep the normal export path', () => {
  const edits = [
    p => { p.clips[1].volume = .8; },
    p => { p.clips[1].fadeIn = .2; },
    p => { p.clips[1].audioTreatment = 'normalize'; },
    p => { p.clips[1].audioMuted = true; },
    p => { p.clips[1].start = .1; },
    p => { p.clips[1].linkId = 'other'; },
    p => { p.tracks[1].muted = true; },
  ];
  for (const edit of edits) {
    const p = importedProject(); edit(p);
    assert.equal(directCopyClip(p, settings), null);
  }
});

test('edits and manual encoder selection keep the normal export path', async () => {
  for (const patch of [{ volume: .8 }, { crop: { top: .1, right: 0, bottom: 0, left: 0 } },
    { start: .1 }, { in: .1 }, { audioDetached: true },
    { mosaic: { x: .5, y: .5, width: .3, height: .3, blockSize: .05 } }]) {
    assert.equal(directCopyClip(project(patch), settings), null);
  }
  assert.equal(directCopyClip(project(), { ...settings, fps: 24 }), null);
  assert.equal(directCopyClip(project(), { ...settings, encoder: 'cpu' }), null);
  const output = path.join(dir, '音量変更.mp4');
  let resolved = 0;
  await exportProject(project({ volume: .8 }), settings, output, { encoders: { resolve: async () => {
    resolved++; return { id: 'cpu', label: 'CPU' };
  } } });
  assert.equal(resolved, 1);
  assert.notDeepEqual(await fs.readFile(output), await fs.readFile(asset.path));
  assert.equal((await probe(output)).streams.find(stream => stream.codec_type === 'audio').codec_name, 'aac');
});

test('real VFR timestamps and rotation metadata prevent the copy route', async () => {
  const vfrFile = path.join(dir, 'variable-frame-rate.mp4');
  await run(ffmpeg, ['-v', 'error', '-y', '-i', asset.path,
    '-vf', 'setpts=PTS+0.01/TB*mod(N\\,2)', '-fps_mode', 'vfr', '-enc_time_base', '1:3000',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'copy', vfrFile]);
  const rotatedFile = path.join(dir, 'rotated.mp4');
  await run(ffmpeg, ['-v', 'error', '-y', '-display_rotation:v:0', '90',
    '-i', asset.path, '-c', 'copy', rotatedFile]);
  for (const file of [vfrFile, rotatedFile]) {
    const changed = await inspectMedia(file, path.join(dir, 'media-cache'), { skipCache: true });
    const p = project();
    p.assets = [changed];
    p.clips[0].assetId = changed.id;
    p.clips[0].duration = changed.duration;
    assert.ok(directCopyClip(p, settings));
    assert.equal(await directCopySource(p, settings), null, file);
  }
});

test('cancellation and source destination protection preserve existing files', async () => {
  const output = path.join(dir, '保持.mp4');
  await fs.writeFile(output, 'existing content');
  const controller = new AbortController();
  await assert.rejects(copyUnchangedMovie(asset, output, { signal: controller.signal,
    onProgress: item => { if (item.progress > 0) controller.abort(); } }), /キャンセル/);
  assert.equal(await fs.readFile(output, 'utf8'), 'existing content');
  assert.ok(!(await fs.readdir(dir)).some(name => name.startsWith('.luma-')));
  const original = await fs.readFile(asset.path);
  await assert.rejects(copyUnchangedMovie(asset, asset.path), /元の素材/);
  assert.deepEqual(await fs.readFile(asset.path), original);
});
