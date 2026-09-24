const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { inspectMedia, probe } = require('../electron/media.cjs');
const { buildExport, exportProject } = require('../electron/export.cjs');

async function main() {
  const folder = path.resolve(process.argv[2] || 'test-results/export-gaussian');
  await fs.mkdir(folder, { recursive: true });
  const source = path.resolve('public/demo/01-journey.mp4');
  const asset = await inspectMedia(source, path.join(folder, 'cache'));
  const clip = { id: 'blur', assetId: asset.id, trackId: 'video', kind: 'video', name: 'ガウスぼかし',
    start: 0, in: 0, duration: 2, speed: 1, scale: 1, x: 0, y: 0,
    rotation: 0, opacity: 1, volume: 1, exposure: 0, contrast: 1,
    saturation: 1, fadeIn: 0, fadeOut: 0, audioMuted: true,
    gaussianBlur: { x: .5, y: .5, width: .3, height: .3, sigma: .015 } };
  const project = { version: 1, id: 'gaussian-benchmark', name: 'ガウス書き出し速度比較',
    width: 960, height: 540, fps: 24, assets: [asset],
    tracks: [{ id: 'video', kind: 'video', name: '映像' }], markers: [], clips: [clip] };
  const settings = { width: 960, height: 540, fps: 24, quality: 'standard', encoder: 'cpu' };
  const output = path.join(folder, 'gaussian.mp4');
  const { args } = buildExport(project, settings, { [asset.id]: source }, output);
  const graph = args[args.indexOf('-filter_complex') + 1];
  const started = performance.now();
  await exportProject(project, settings, output);
  const seconds = (performance.now() - started) / 1000;
  const info = await probe(output);
  const frames = Number(info.streams.find(stream => stream.codec_type === 'video')?.nb_frames);
  if (frames !== 48) throw new Error(`Expected 48 frames, got ${frames}`);
  const result = { seconds, frames, mode: graph.includes('hstack=inputs=3') ? 'region' : 'full-frame-blend', bytes: (await fs.stat(output)).size };
  await fs.writeFile(path.join(folder, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
