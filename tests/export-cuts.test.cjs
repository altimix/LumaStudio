const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ffmpeg, run, inspectMedia } = require('../electron/media.cjs');
const { buildExport, exportProject } = require('../electron/export.cjs');

let folder, red, blue;
const settings = { width: 320, height: 180, fps: 24, quality: 'draft', encoder: 'cpu' };

before(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-cut-export-'));
  for (const [name, color, tone] of [['red', 'red', 440], ['blue', 'blue', 660]]) {
    const file = path.join(folder, `${name} 映像.mp4`);
    await run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=320x180:r=24:d=2`,
      '-f', 'lavfi', '-i', `sine=frequency=${tone}:duration=2:sample_rate=48000`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file]);
    const asset = await inspectMedia(file, path.join(folder, `${name}-cache`));
    if (name === 'red') red = asset;
    else blue = asset;
  }
});
after(async () => { if (folder) await fs.rm(folder, { recursive: true, force: true }); });

function clip(asset, id, start, sourceIn, duration = 1) {
  return { id, assetId: asset.id, trackId: 'video', kind: 'video', name: id,
    start, in: sourceIn, duration, speed: 1, scale: 1, x: 0, y: 0,
    rotation: 0, opacity: 1, volume: 1, exposure: 0, contrast: 1,
    saturation: 1, fadeIn: 0, fadeOut: 0 };
}
function project(clips, assets = [red, blue]) {
  return { version: 1, id: 'cuts', name: 'カットの検証', width: 320, height: 180,
    fps: 24, assets, tracks: [{ id: 'video', kind: 'video', name: '映像' }],
    markers: [], clips };
}
function graph(p, exportSettings = settings) {
  const sources = Object.fromEntries(p.assets.map(asset => [asset.id, asset.path]));
  const { args } = buildExport(p, exportSettings, sources, path.join(folder, 'graph.mp4'));
  return { args, filters: args[args.indexOf('-filter_complex') + 1] };
}
async function frames(file) {
  return run(ffmpeg, ['-v', 'error', '-i', file, '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
}
async function audioRms(file, time) {
  const pcm = await run(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', file,
    '-t', '0.05', '-vn', '-ac', '1', '-f', 'f32le', 'pipe:1']);
  let energy = 0;
  for (let i = 0; i < pcm.length; i += 4) energy += pcm.readFloatLE(i) ** 2;
  return Math.sqrt(energy / (pcm.length / 4));
}

test('continuous frame-aligned splits share one video decode and keep original audio cuts', async () => {
  const clips = Array.from({ length: 24 }, (_, i) => clip(red, `split${i}`, i / 12, i / 12, 1 / 12));
  const p = project(clips, [red]);
  const { args, filters } = graph(p);
  assert.equal(args.filter(arg => arg === '-i').length, 2 + 1 + 24);
  assert.equal((filters.match(/\[\d+:v\]setpts=/g) || []).length, 1);
  assert.ok(!filters.includes('overlay='), filters);
  const output = path.join(folder, 'splits.mp4');
  await exportProject(p, settings, output);
  const pixels = await frames(output);
  assert.equal(pixels.length, 48 * 3);
  for (let frame = 0; frame < 48; frame++) assert.ok(pixels[frame * 3] > 180, `black frame ${frame}`);
  assert.ok(await audioRms(output, 0.9) > 0.02);
  assert.ok(await audioRms(output, 1.1) > 0.02);
});

test('full-frame cuts between different H.264 sources use concat with exact boundaries', async () => {
  const p = project([clip(red, 'a', 0, 0), clip(blue, 'b', 1, 0)]);
  const { filters } = graph(p);
  assert.match(filters, /concat=n=2:v=1:a=0/);
  assert.ok(!filters.includes('overlay='));
  const output = path.join(folder, 'two-sources.mp4');
  await exportProject(p, settings, output);
  const pixels = await frames(output);
  assert.equal(pixels.length, 48 * 3);
  for (let frame = 0; frame < 48; frame++) {
    const pixel = pixels.subarray(frame * 3, frame * 3 + 3);
    assert.ok(frame < 24 ? pixel[0] > 180 && pixel[2] < 30 : pixel[2] > 180 && pixel[0] < 30,
      `wrong color at frame ${frame}: ${[...pixel]}`);
  }
  assert.ok(await audioRms(output, 0.9) > 0.02);
  assert.ok(await audioRms(output, 1.1) > 0.02);
});

test('short alternating cuts retain every ordered frame', async () => {
  for (const frameCount of [1, 2]) {
    const clips = Array.from({ length: 12 }, (_, i) =>
      ({ ...clip(i % 2 ? blue : red, `frame${i}`, i * frameCount / 24, 0, frameCount / 24), audioMuted: true }));
    const p = project(clips), { filters } = graph(p);
    if (frameCount === 1) assert.ok(filters.includes('overlay='));
    else assert.match(filters, /concat=n=12:v=1:a=0/);
    const output = path.join(folder, `${frameCount}-frame-cuts.mp4`);
    await exportProject(p, settings, output);
    const pixels = await frames(output);
    assert.equal(pixels.length, 12 * frameCount * 3);
    for (let frame = 0; frame < 12 * frameCount; frame++) {
      const pixel = pixels.subarray(frame * 3, frame * 3 + 3);
      assert.ok(Math.floor(frame / frameCount) % 2 ? pixel[2] > 180 && pixel[0] < 30 : pixel[0] > 180 && pixel[2] < 30,
        `wrong frame ${frame} in ${frameCount}-frame cuts: ${[...pixel]}`);
    }
  }
});

test('effects, gaps, and sub-frame output cuts retain the compositing path', () => {
  const base = [clip(red, 'a', 0, 0), clip(blue, 'b', 1, 0)];
  for (const clips of [
    [{ ...base[0], mosaic: { x: .5, y: .5, width: 1, height: 1, blockSize: .02 } }, base[1]],
    [base[0], { ...base[1], start: 1.25 }],
    [base[0], { ...base[1], scale: 0.9 }],
  ]) assert.ok(graph(project(clips)).filters.includes('overlay='));
  const split = project([clip(red, 'a', 0, 0, 1 / 12), clip(red, 'b', 1 / 12, 1 / 12, 1 / 12)], [red]);
  assert.ok(graph(split, { ...settings, fps: 30 }).filters.includes('overlay='));
});
