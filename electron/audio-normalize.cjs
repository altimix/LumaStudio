const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { ffmpeg, probe } = require('./media.cjs');
const { progressReader, audioProgress } = require('./audio-progress.cjs');
const { atomicWrite } = require('./persistence.cjs');
const { validateTreatment } = require('../shared/audio-treatment.mjs');

function processAudio(args, signal, onProgress) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-nostats', ...(onProgress ? ['-progress', 'pipe:1', '-stats_period', '0.25'] : []), ...args], { windowsHide: true });
    let log = ''; const abort = () => child.kill(); signal?.addEventListener('abort', abort, { once: true });
    if (onProgress) child.stdout.on('data', progressReader(onProgress)); else child.stdout.resume();
    child.stderr.on('data', b => { log = (log + b).slice(-16000); });
    child.on('error', error => { signal?.removeEventListener('abort', abort); reject(error); });
    child.on('close', code => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(new Error('音声の自動調整を中止しました。'));
      else if (code) reject(new Error('音声の自動調整に失敗しました。素材と空き容量を確認してください。'));
      else resolve(log);
    });
  });
}
function readLoudness(log, measurement = 'input') {
  let raw; try { raw = JSON.parse(log.slice(log.lastIndexOf('{'))); } catch { throw new Error('音声の音量を測定できませんでした。'); }
  const result = Object.fromEntries(['input_i', 'input_lra', 'input_tp', 'input_thresh', 'target_offset'].map(key => [key, Number(raw[measurement === 'output' ? key.replace(/^input_/, 'output_') : key])]));
  if (!Object.values(result).every(Number.isFinite) || result.input_i < -70 || result.input_i > 0 || result.input_lra < 0 || result.input_lra > 99 || Math.abs(result.target_offset) > 99) throw new Error('音声が無音、短すぎる、または小さすぎるため自動調整できません。');
  return result;
}
function preprocessing(treatment) {
  validateTreatment(treatment);
  const base = 'aresample=48000:async=1:first_pts=0,aformat=channel_layouts=stereo';
  return treatment === 'speech' ? `${base},highpass=f=80,acompressor=threshold=0.08:ratio=3:attack=10:release=180:knee=2.8:makeup=1:link=maximum` : base;
}
function createAudioProcessor(directory) {
  const pending = new Map(); let closed = false;
  async function build(file, treatment, key, signal, options) {
    const dir = typeof directory === 'function' ? directory() : directory;
    await fs.mkdir(dir, { recursive: true });
    const output = path.join(dir, `${key}.flac`), reportPath = path.join(dir, `${key}.json`);
    try {
      const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
      if (report.key === key && report.treatment === treatment && Number.isFinite(report.inputLufs) && Number.isFinite(report.outputLufs) && Number.isFinite(report.peak) && (await fs.stat(output)).size > 32) {
        options.publish({ phase: 'cached', progress: 1, processedSeconds: 0, durationSeconds: options.duration || null });
        return { ...report, file: output };
      }
    } catch { /* A missing or incomplete cache is rebuilt from the original. */ }
    const partial = path.join(dir, `${key}-${randomUUID()}.partial.flac`), corrected = partial.replace('.partial.flac', '.corrected.flac');
    try {
      let duration = options.duration;
      if (!(duration > 0)) {
        const info = await probe(file); duration = Number(info.format?.duration || info.streams?.find(stream => stream.codec_type === 'audio')?.duration);
      }
      signal.throwIfAborted();
      const progress = audioProgress(Number.isFinite(duration) && duration > 0 ? duration : null, options.publish);
      const pass = async (phase, args) => {
        progress(phase);
        const log = await processAudio(args, signal, value => progress(phase, value.seconds, value.done));
        progress(phase, duration || 0, true); return log;
      };
      const pre = preprocessing(treatment), lra = treatment === 'speech' ? 7 : 11;
      const base = ['-i', file, '-map', '0:a:0', '-vn'];
      const target = `loudnorm=I=-16:LRA=${lra}:TP=-1.5`;
      const outputArgs = ['-ar', '48000', '-ac', '2', '-c:a', 'flac', '-compression_level', '0', '-sample_fmt', 's32', partial];
      const measuredFilter = value => `${pre},${target}:measured_I=${value.input_i}:measured_LRA=${value.input_lra}:measured_TP=${value.input_tp}:measured_thresh=${value.input_thresh}:offset=${value.target_offset}:linear=true:print_format=json`;
      let stats, measured;
      if (treatment === 'speech') {
        // The conversation preset already controls dynamics. Render loudnorm's
        // dynamic pass directly instead of throwing its normalized output away.
        // It measures input AND output during this one decode of the source.
        const log = await pass('speech', ['-y', ...base, '-af', `${pre},${target}:print_format=json`, ...outputArgs]);
        stats = readLoudness(log); measured = readLoudness(log, 'output');
        // An isolated peak can leave too little headroom to raise the overall
        // level. Only then spend a measured second pass to retain target accuracy.
        const possibleGain = Math.min(-16 - measured.input_i, -1.5 - measured.input_tp);
        if (Math.abs(-16 - measured.input_i - possibleGain) > .3) {
          measured = readLoudness(await pass('refining', ['-y', ...base, '-af', measuredFilter(stats), ...outputArgs]), 'output');
        }
      } else {
        // Keep measured linear normalization for music whose dynamics should be
        // preserved. Its output statistics still avoid a third full analysis.
        stats = readLoudness(await pass('analysis', [...base, '-af', `${pre},${target}:print_format=json`, '-f', 'null', '-']));
        measured = readLoudness(await pass('processing', ['-y', ...base, '-af', measuredFilter(stats), ...outputArgs]), 'output');
      }
      // Dynamic loudnorm can miss its integrated target for abrupt level changes.
      // Correct the measured result with a constant gain within true-peak headroom.
      const correction = Math.min(-16 - measured.input_i, -1.5 - measured.input_tp);
      if (Math.abs(correction) > 0.1) {
        await pass('correction', ['-y', '-i', partial, '-af', `volume=${correction}dB`, '-c:a', 'flac', '-compression_level', '0', '-sample_fmt', 's32', corrected]);
        await fs.rename(corrected, partial); measured.input_i += correction; measured.input_tp += correction;
      }
      signal.throwIfAborted();
      progress('saving');
      const report = { key, treatment, inputLufs: stats.input_i, outputLufs: measured.input_i, peak: measured.input_tp };
      await fs.rename(partial, output); await atomicWrite(reportPath, JSON.stringify(report));
      progress('complete');
      return { file: output, ...report };
    } finally { await fs.rm(partial, { force: true }).catch(() => {}); await fs.rm(corrected, { force: true }).catch(() => {}); }
  }
  return {
    async get(file, treatment, signal, options = {}) {
      validateTreatment(treatment); signal?.throwIfAborted(); if (closed) throw new Error('音声処理は終了しました。');
      if (!treatment) return { file };
      const stat = await fs.stat(file);
      signal?.throwIfAborted(); if (closed) throw new Error('音声処理は終了しました。');
      const key = createHash('sha256').update(JSON.stringify(['audio-treatment-v1', path.resolve(file), stat.size, stat.mtimeMs, treatment])).digest('hex');
      let job = pending.get(key);
      while (job?.controller.signal.aborted) {
        await job.promise.catch(() => {}); signal?.throwIfAborted();
        if (closed) throw new Error('音声処理は終了しました。');
        job = pending.get(key);
      }
      if (!job) {
        // Bounded process count; different modes/assets do not create unlimited FFmpeg jobs.
        if (pending.size >= 2) throw new Error('音声を準備しています。前の処理が終わってから再実行してください。');
        job = { controller: new AbortController(), users: 0, listeners: new Set(), progress: { phase: 'preparing', progress: 0, processedSeconds: 0, durationSeconds: options.duration || null } };
        const publish = value => {
          job.progress = value;
          for (const listener of job.listeners) { try { listener(value); } catch { /* A closed progress recipient must not cancel shared work. */ } }
        };
        job.promise = build(file, treatment, key, job.controller.signal, { duration: options.duration, publish }).finally(() => { if (pending.get(key) === job) pending.delete(key); });
        pending.set(key, job);
      }
      job.users++;
      if (typeof options.onProgress === 'function') {
        job.listeners.add(options.onProgress);
        try { options.onProgress(job.progress); } catch { /* Progress is optional. */ }
      }
      return new Promise((resolve, reject) => {
        let finished = false;
        const done = (fn, value) => { if (finished) return; finished = true; signal?.removeEventListener('abort', abort); job.listeners.delete(options.onProgress); job.users--; if (!job.users) job.controller.abort(); fn(value); };
        const abort = () => done(reject, new Error('音声の自動調整を中止しました。'));
        signal?.addEventListener('abort', abort, { once: true });
        job.promise.then(value => done(resolve, value), error => done(reject, error));
        if (signal?.aborted) abort();
      });
    },
    close() { closed = true; for (const job of pending.values()) job.controller.abort(); }
  };
}
module.exports = { createAudioProcessor, readLoudness, preprocessing, processAudio };
