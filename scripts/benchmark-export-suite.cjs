const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { inspectMedia, probe, run, ffmpeg, ffprobe } = require('../electron/media.cjs');
const { exportProject } = require('../electron/export.cjs');
const { summarize, compareReports } = require('./export-benchmark-report.cjs');

const settings = { width: 960, height: 540, fps: 24, quality: 'standard', encoder: 'cpu' };
const duration = 2;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const roundedSeconds = value => Math.round(value * 1000) / 1000;

function definitionHash(project) {
  // The source bytes are checked separately. Asset IDs depend on import paths
  // and mtimes, but the clip geometry and effect values define the workload.
  const { version, width, height, fps, tracks, markers, clips } = project;
  return sha256(JSON.stringify({ version, width, height, fps, tracks, markers,
    clips: clips.map(clip => ({ ...clip, assetId: 'SOURCE' })) }));
}

function projects(asset) {
  const base = { id: 'base', assetId: asset.id, trackId: 'video', kind: 'video', name: 'デモ映像',
    start: 0, in: 0, duration, speed: 1, scale: 1, x: 0, y: 0, rotation: 0,
    opacity: 1, volume: 1, exposure: 0, contrast: 1, saturation: 1,
    fadeIn: 0, fadeOut: 0 };
  const mosaic = { x: .5, y: .5, width: .3, height: .3, blockSize: .02 };
  const gaussianBlur = { x: .5, y: .5, width: .3, height: .3, sigma: .015 };
  const cuts = jump => Array.from({ length: 24 }, (_, index) => ({
    ...base, id: `cut-${index}`, start: index * duration / 24,
    in: index * duration / 24 + (jump && index % 2 ? 4 : 0),
    duration: duration / 24,
  }));
  const cases = {
    plain: [base],
    continuousCuts: cuts(false),
    jumpedCuts: cuts(true),
    mosaic: [{ ...base, mosaic }],
    gaussian: [{ ...base, gaussianBlur }],
    bothEffects: [{ ...base, mosaic, gaussianBlur }],
    rotatedGaussian: [{ ...base, rotation: 15, gaussianBlur }],
    twoTracks: [base, { ...base, id: 'overlay', trackId: 'overlay', start: .5, in: 2,
      duration: 1, scale: .4, x: 25, y: -15, opacity: .8, volume: 0 }],
  };
  return Object.fromEntries(Object.entries(cases).map(([name, clips]) => [name, {
    version: 1, id: `benchmark-${name}`, name: `書き出し計測: ${name}`,
    width: settings.width, height: settings.height, fps: settings.fps,
    assets: [asset], tracks: [
      { id: 'overlay', kind: 'video', name: '上段' },
      { id: 'video', kind: 'video', name: '映像' },
    ], markers: [], clips,
  }]));
}

async function measure(project, output) {
  let ffmpegSeconds = 0;
  const start = performance.now();
  await exportProject(project, settings, output, { spawnProcess(binary, args, options) {
    const launched = performance.now();
    const child = spawn(binary, args, options);
    child.once('close', () => { ffmpegSeconds += (performance.now() - launched) / 1000; });
    return child;
  } });
  const totalSeconds = (performance.now() - start) / 1000;
  if (!(ffmpegSeconds > 0) || ffmpegSeconds > totalSeconds) throw new Error('FFmpegの実行時間を記録できませんでした。');
  return { totalSeconds, ffmpegSeconds, otherSeconds: totalSeconds - ffmpegSeconds,
    bytes: (await fs.stat(output)).size };
}

async function verifyOutput(output) {
  const info = await probe(output);
  const framesText = (await run(ffmpeg, ['-v', 'error', '-i', output, '-map', '0:v:0',
    '-pix_fmt', 'rgba', '-f', 'framemd5', 'pipe:1'])).toString();
  const frames = framesText.split('\n').filter(line => /^0,/.test(line)).length;
  const sound = info.streams.some(stream => stream.codec_type === 'audio');
  const audioHash = sound ? sha256(await run(ffmpeg, ['-v', 'error', '-i', output,
    '-map', '0:a:0', '-ac', '2', '-ar', '48000', '-f', 's16le', 'pipe:1'])) : null;
  return { frames, videoHash: sha256(framesText), audioHash, duration: Number(info.format.duration) };
}

async function writeReportAtomically(reportPath, report) {
  const temporaryPath = `${reportPath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    await fs.rename(temporaryPath, reportPath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

async function benchmark(outputDir, iterations, only) {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10) throw new Error('測定回数は1〜10回で指定してください。');
  if (execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).trim()) {
    throw new Error('計測前に変更をコミットしてください。未コミットの作業ツリーは結果の実装を特定できません。');
  }
  await fs.mkdir(outputDir, { recursive: true });
  const runDir = await fs.mkdtemp(path.join(outputDir, 'run-'));
  const source = path.resolve('public/demo/01-journey.mp4');
  const asset = await inspectMedia(source, path.join(runDir, 'cache'), { skipCache: true });
  const suite = projects(asset);
  const names = only ? [only] : Object.keys(suite);
  if (names.some(name => !suite[name])) throw new Error(`未定義のケースです: ${only}`);
  const report = { schema: 3, gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    platform: process.platform, arch: process.arch, osRelease: os.release(),
    cpuModel: os.cpus()[0]?.model, logicalCpus: os.cpus().length, nodeVersion: process.version,
    ffmpegVersion: (await run(ffmpeg, ['-version'])).toString().split('\n')[0],
    ffmpegSha256: sha256(await fs.readFile(ffmpeg)), ffprobeSha256: sha256(await fs.readFile(ffprobe)),
    benchmarkScriptSha256: sha256(await fs.readFile(__filename)),
    sourceSha256: sha256(await fs.readFile(source)), source: 'public/demo/01-journey.mp4',
    settings, iterations, scenarios: [] };
  const samples = new Map(names.map(name => [name, []]));
  for (const name of names) {
    const warmup = path.join(runDir, `warmup-${name}.mp4`);
    await measure(suite[name], warmup);
    await fs.rm(warmup);
  }
  // Rotate case order on each pass so one case does not always run on a cold CPU.
  for (let iteration = 0; iteration < iterations; iteration++) {
    const order = [...names.slice(iteration % names.length), ...names.slice(0, iteration % names.length)];
    for (const name of order) {
      const output = path.join(runDir, `${name}-${iteration + 1}.mp4`);
      const timing = await measure(suite[name], output);
      samples.get(name).push({ iteration: iteration + 1, output, ...timing });
      console.log(`${name} ${iteration + 1}/${iterations}: ${roundedSeconds(timing.totalSeconds)} s`);
    }
  }
  for (const name of names) {
    const measured = samples.get(name);
    const verified = await Promise.all(measured.map(sample => verifyOutput(sample.output)));
    const first = verified[0];
    if (first.frames !== duration * settings.fps || !Number.isFinite(first.duration) ||
      Math.abs(first.duration - duration) > .05 || !first.audioHash ||
      verified.some(result => JSON.stringify(result) !== JSON.stringify(first))) {
      throw new Error(`${name}: フレーム数、音声、長さ、または反復間の画素が一致しません。`);
    }
    report.scenarios.push({ name, definitionHash: definitionHash(suite[name]), ...first, samples: measured.map(({ output, ...sample }) => ({
      ...sample, output: path.relative(outputDir, output),
    })) });
  }
  const reportPath = path.join(outputDir, 'results.json');
  await writeReportAtomically(reportPath, report);
  for (const item of report.scenarios) console.log(`${item.name}: median ${roundedSeconds(summarize(item.samples).medianSeconds)} s`);
  console.log(reportPath);
}

async function main(args) {
  if (args[0] === '--compare') {
    if (args.length !== 3) throw new Error('使い方: node scripts/benchmark-export-suite.cjs --compare 基準.json 候補.json');
    const baseline = JSON.parse(await fs.readFile(args[1], 'utf8'));
    const candidate = JSON.parse(await fs.readFile(args[2], 'utf8'));
    for (const item of compareReports(baseline, candidate)) {
      const time = summary => `${roundedSeconds(summary.medianSeconds)} s (範囲 ${roundedSeconds(summary.minSeconds)}–${roundedSeconds(summary.maxSeconds)}, MAD ${roundedSeconds(summary.medianAbsoluteDeviationSeconds)}, FFmpeg ${roundedSeconds(summary.medianFfmpegSeconds)})`;
      console.log(`${item.name}: ${time(item.baseline)} → ${time(item.candidate)}; ${item.changePercent}% | 映像 ${item.sameVideo ? '一致' : '差あり'} | 音声 ${item.sameAudio ? '一致' : '差あり'} | 長さ ${item.sameDuration ? '一致' : '差あり'}`);
    }
    return;
  }
  await benchmark(path.resolve(args[0] || 'test-results/export-suite'), Number(args[1] || 5), args[2]);
}

if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { projects, definitionHash, measure, verifyOutput, writeReportAtomically, benchmark };
