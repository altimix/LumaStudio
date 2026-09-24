const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { inspectMedia, probe } = require('../electron/media.cjs');
const { exportProject, buildExport } = require('../electron/export.cjs');

const folder = path.resolve(process.argv[2] || 'test-results/export-cuts');
const source = path.resolve('public/demo/01-journey.mp4');

async function main() {
  await fs.mkdir(folder, { recursive: true });
  const asset = await inspectMedia(source, path.join(folder, 'cache'));
  const results = [];
  for (const fps of [24, 30]) {
    for (const scenario of ['single', 'continuous', 'jump']) {
      const cuts = scenario === 'single' ? 1 : 24;
      const clip = {
        id: 'clip', assetId: asset.id, trackId: 'video', kind: 'video', name: 'デモ映像',
        start: 0, in: 0, duration: 2, speed: 1, scale: 1, x: 0, y: 0,
        rotation: 0, opacity: 1, volume: 1, exposure: 0, contrast: 1,
        saturation: 1, fadeIn: 0, fadeOut: 0, audioMuted: true,
      };
      const clips = Array.from({ length: cuts }, (_, i) => ({
        ...clip, id: `clip${i}`, start: i * 2 / cuts,
        in: i * 2 / cuts + (scenario === 'jump' && i % 2 ? 4 : 0),
        duration: 2 / cuts,
      }));
      const project = {
        version: 1, id: 'cut-benchmark', name: 'カット書き出し速度比較',
        width: 960, height: 540, fps, assets: [asset],
        tracks: [{ id: 'video', kind: 'video', name: '映像' }], markers: [], clips,
      };
      const settings = { width: 960, height: 540, fps, quality: 'standard', encoder: 'cpu' };
      const output = path.join(folder, `${fps}fps-${scenario}.mp4`);
      const { args } = buildExport(project, settings, { [asset.id]: source }, output);
      const graph = args[args.indexOf('-filter_complex') + 1];
      const started = performance.now();
      await exportProject(project, settings, output);
      const seconds = (performance.now() - started) / 1000;
      const info = await probe(output);
      const frames = Number(info.streams.find(stream => stream.codec_type === 'video')?.nb_frames);
      const result = { fps, scenario, cuts, seconds, graph: graph.includes('concat=') ? 'concat' : graph.includes('overlay=') ? 'overlay' : 'direct', frames };
      if (frames !== 2 * fps) throw new Error(`${scenario} ${fps} FPS: ${frames} frames instead of ${2 * fps}`);
      results.push(result);
      console.log(JSON.stringify(result));
    }
  }
  await fs.writeFile(path.join(folder, 'results.json'), JSON.stringify(results, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
