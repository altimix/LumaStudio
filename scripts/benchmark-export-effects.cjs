const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { inspectMedia, probe, run, ffmpeg } = require('../electron/media.cjs');
const { exportProject } = require('../electron/export.cjs');

async function main() {
  const outputDir = path.resolve(process.argv[2] || 'test-results/export-effects-benchmark');
  const iterations = Number(process.argv[3] || 2);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10) throw new Error('測定回数は1〜10回で指定してください。');
  await fs.mkdir(outputDir, { recursive: true });
  const source = path.resolve('public/demo/01-journey.mp4');
  const asset = await inspectMedia(source, path.join(outputDir, 'asset-cache'));
  const common = { assetId: asset.id, trackId: 'video', kind: 'video', name: 'デモ映像', speed: 1, scale: 1, x: 0, y: 0, rotation: 0, opacity: 1, volume: 0, exposure: 0, contrast: 1, saturation: 1, fadeIn: 0, fadeOut: 0, audioMuted: true };
  const clip = { ...common, id: 'video', start: 0, in: 0, duration: 2 };
  const mosaic = { x: .5, y: .5, width: .3, height: .3, blockSize: .02 };
  const projects = {
    plain: [clip],
    mosaic: [{ ...clip, mosaic }],
    cuts: [{ ...clip, id: 'first', duration: 1 }, { ...clip, id: 'second', in: 1, start: 1, duration: 1 }],
  };
  const settings = { width: 1280, height: 720, fps: 30, quality: 'standard', encoder: 'cpu' };
  const results = [];
  for (const [scenario, clips] of Object.entries(projects)) {
    const project = { version: 1, id: `benchmark-${scenario}`, name: scenario, width: 1280, height: 720, fps: 30, assets: [asset], tracks: [{ id: 'video', kind: 'video', name: 'Video' }], markers: [], clips };
    for (let index = 0; index < iterations; index++) {
      const output = path.join(outputDir, `${scenario}-${index}.mp4`);
      const started = performance.now();
      await exportProject(project, settings, output);
      const seconds = (performance.now() - started) / 1000;
      const info = await probe(output);
      const frames = (await run(ffmpeg, ['-v', 'error', '-i', output, '-map', '0:v:0', '-pix_fmt', 'yuv420p', '-f', 'framemd5', 'pipe:1'])).toString();
      const result = { scenario, iteration: index + 1, seconds, frames: frames.split('\n').filter(line => /^0,/.test(line)).length, videoHash: createHash('sha256').update(frames).digest('hex'), duration: Number(info.format.duration), bytes: (await fs.stat(output)).size };
      results.push(result);
      console.log(JSON.stringify(result));
    }
  }
  await fs.writeFile(path.join(outputDir, 'results.json'), JSON.stringify({ platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, source, settings, results }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
