const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { ffmpeg, run, inspectMedia, probe } = require('../electron/media.cjs');
const { exportProject } = require('../electron/export.cjs');

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const settings = { width: 960, height: 540, fps: 24, quality: 'standard' };

async function trial(seconds, directory) {
  const source = path.join(directory, `source-${seconds}.mp4`);
  await run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i',
    `testsrc2=s=${settings.width}x${settings.height}:r=${settings.fps}:d=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}:sample_rate=48000`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2',
    '-t', String(seconds), '-movflags', '+faststart', source]);
  const asset = await inspectMedia(source, path.join(directory, 'cache'), { skipCache: true });
  const sourceBytes = await fs.readFile(source);
  const clip = { id: 'clip', assetId: asset.id, trackId: 'video', name: asset.name, kind: 'video',
    start: 0, in: 0, duration: asset.duration, speed: 1, x: 0, y: 0, scale: 1, rotation: 0,
    opacity: 1, exposure: 0, contrast: 1, saturation: 1, volume: 1, fadeIn: 0, fadeOut: 0,
    text: '', fontSize: 94, color: '#ffffff', textStyle: 'hero' };
  const project = { version: 1, id: 'benchmark', name: 'Direct copy', width: settings.width,
    height: settings.height, fps: settings.fps, assets: [asset], clips: [clip], markers: [],
    tracks: [{ id: 'video', name: 'Video 1', kind: 'video', muted: false, hidden: false, locked: false, solo: false }] };
  const runs = { cpu: [], copy: [] };
  for (let iteration = -1; iteration < 5; iteration++) {
    for (const kind of iteration % 2 ? ['copy', 'cpu'] : ['cpu', 'copy']) {
      const output = path.join(directory, `${seconds}-${kind}.mp4`);
      const start = performance.now();
      await exportProject(project, { ...settings, encoder: kind === 'copy' ? 'auto' : 'cpu' }, output);
      const elapsed = (performance.now() - start) / 1000;
      if (kind === 'copy' && !(await fs.readFile(output)).equals(sourceBytes)) {
        throw new Error('The direct-copy output differs from its source.');
      }
      if (iteration >= 0) runs[kind].push(Number(elapsed.toFixed(3)));
    }
  }
  const copied = await probe(path.join(directory, `${seconds}-copy.mp4`));
  const encoded = await probe(path.join(directory, `${seconds}-cpu.mp4`));
  const summary = info => ({ duration: Number(info.format.duration),
    frames: Number(info.streams.find(stream => stream.codec_type === 'video').nb_frames),
    audioRate: Number(info.streams.find(stream => stream.codec_type === 'audio').sample_rate) });
  if (JSON.stringify(summary(copied)) !== JSON.stringify(summary(encoded))) {
    throw new Error('The CPU and copy outputs have different duration, frame count, or audio rate.');
  }
  return { seconds, sourceBytes: (await fs.stat(source)).size, runs,
    median: { cpu: median(runs.cpu), copy: median(runs.copy) }, output: summary(copied) };
}

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-direct-copy-benchmark-'));
  try {
    const cases = [];
    for (const seconds of [2, 8]) cases.push(await trial(seconds, directory));
    console.log(JSON.stringify({ machine: { platform: process.platform, arch: process.arch,
      cpu: os.cpus()[0]?.model, cores: os.cpus().length }, resolution: '960x540', fps: 24,
      cases }, null, 2));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
