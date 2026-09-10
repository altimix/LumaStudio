const { validateTreatment } = require('../shared/audio-treatment.mjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { ffmpeg } = require('./media-binaries.cjs');
const RATE = 48000, STEP = 48, FACTOR = 16, MAX_BINS = 8192, PEAK_BYTES = 4;
const building = new Map();

// Stream all channels independently: an anti-phase stereo signal must not vanish.
async function scan(file, channels, consume, { start = 0, duration, signal } = {}) {
  const seek = Math.max(0, start - 1), trim = start - seek;
  const args = ['-v', 'error', ...(seek ? ['-ss', String(seek)] : []), '-i', file, '-map', '0:a:0', '-vn',
    '-af', `aresample=${RATE}:async=1:first_pts=0${duration === undefined ? '' : `,atrim=start=${trim}:duration=${duration}`}`,
    '-ar', String(RATE), '-f', 'f32le', 'pipe:1'];
  const child = spawn(ffmpeg, args, { windowsHide: true, signal });
  let stderr = '', carry = Buffer.alloc(0), frame = 0;
  const completion = new Promise((resolve, reject) => {
    child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(stderr || '音声波形を作成できません。')));
  });
  completion.catch(() => {});
  child.stderr.on('data', b => { stderr = (stderr + b).slice(-2000); });
  try {
    for await (const chunk of child.stdout) {
      const data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const bytes = data.length - data.length % (channels * 4), peaks = new Float32Array(bytes / (channels * 4));
      for (let i = 0; i < peaks.length; i++) {
        let peak = 0;
        for (let c = 0; c < channels; c++) { const value = Math.abs(data.readFloatLE((i * channels + c) * 4)); if (Number.isFinite(value)) peak = Math.max(peak, value); }
        // Float WAV and decoded lossy sources can exceed full scale. Retain
        // their amplitude here; only the final display values are normalized.
        peaks[i] = peak;
      }
      await consume(peaks, frame); frame += peaks.length;
      carry = Buffer.from(data.subarray(bytes));
    }
    await completion; return frame;
  } catch (error) { child.kill(); await completion.catch(() => {}); throw error; }
}

async function readIndex(directory, id) {
  const meta = JSON.parse(await fs.readFile(path.join(directory, `${id}.wave-v4.json`), 'utf8'));
  if (meta.version !== 4 || !Number.isFinite(meta.max) || meta.max < 0 || !Number.isInteger(meta.channels) || meta.channels < 1 || meta.channels > 64 || !Array.isArray(meta.levels) || !meta.levels.length || meta.levels.length > 12) throw Error('波形キャッシュが不正です。');
  for (let i = 0; i < meta.levels.length; i++) {
    const level = meta.levels[i];
    if (level.step !== STEP * FACTOR ** i || !Number.isSafeInteger(level.count) || level.count < 0 || (await fs.stat(levelPath(directory, id, i))).size !== level.count * PEAK_BYTES) throw Error('波形キャッシュが不完全です。');
  }
  return meta;
}
const levelPath = (directory, id, level) => path.join(directory, `${id}.wave-v4-${level}.bin`);
async function buildIndex(file, directory, id, duration, channels, signal) {
  await fs.mkdir(directory, { recursive: true });
  const suffix = `.${randomUUID()}.tmp`, levels = [];
  const count = Math.max(1, Math.min(12, Math.ceil(Math.log(Math.max(1, duration * RATE / STEP)) / Math.log(FACTOR)) + 1));
  const temporary = [], writes = []; let max = 0, peak = 0, samples = 0;
  const metaFile = path.join(directory, `${id}.wave-v4.json`);
  function emit(i, value) {
    const l = levels[i]; l.buffer.writeFloatLE(value, l.used * PEAK_BYTES); l.used++; l.count++;
    if (l.used === 4096) { writes.push([l.file, l.buffer]); l.buffer = Buffer.alloc(4096 * PEAK_BYTES); l.used = 0; }
    l.peak = Math.max(l.peak, value); l.group++;
    if (l.group === FACTOR) { if (i + 1 < levels.length) emit(i + 1, l.peak); l.peak = 0; l.group = 0; }
  }
  async function flush() { for (const [file, data] of writes.splice(0)) await file.write(data); }
  try {
    for (let i = 0; i < count; i++) { const name = levelPath(directory, id, i) + suffix; temporary.push(name); levels.push({ file: await fs.open(name, 'wx'), buffer: Buffer.alloc(4096 * PEAK_BYTES), used: 0, count: 0, peak: 0, group: 0 }); }
    const frames = await scan(file, channels, async values => {
      for (const value of values) { max = Math.max(max, value); peak = Math.max(peak, value); if (++samples === STEP) { emit(0, peak); peak = 0; samples = 0; } }
      await flush();
    }, {signal});
    if (samples) emit(0, peak);
    for (let i = 0; i < levels.length; i++) { const l = levels[i]; if (l.group && i + 1 < levels.length) emit(i + 1, l.peak); if (l.used) writes.push([l.file, l.buffer.subarray(0, l.used * PEAK_BYTES)]); }
    await flush();
    for (let i = 0; i < levels.length; i++) { await levels[i].file.close(); await fs.rename(temporary[i], levelPath(directory, id, i)); }
    const meta = { version: 4, channels, max, frames, levels: levels.map((l, i) => ({ step: STEP * FACTOR ** i, count: l.count })) };
    temporary.push(metaFile + suffix); await fs.writeFile(metaFile + suffix, JSON.stringify(meta)); await fs.rename(metaFile + suffix, metaFile);
    return meta;
  } finally { await Promise.allSettled(levels.map(l => l.file.close())); await Promise.allSettled(temporary.map(name => fs.rm(name, { force: true }))); }
}
async function ensureWaveform(file, directory, id, duration, channels, signal) {
  if (!/^[a-f0-9]{24}$/.test(id) || !Number.isInteger(channels) || channels < 1 || channels > 64) throw Error('音声波形の素材情報が不正です。');
  signal?.throwIfAborted();
  const key=path.join(directory,id);let entry=building.get(key);
  if(!entry||entry.controller.signal.aborted){
    entry={controller:new AbortController(),consumers:new Set(),persistent:false};
    const current=entry;
    entry.promise=readIndex(directory,id).catch(()=>{
      current.controller.signal.throwIfAborted();
      return buildIndex(file,directory,id,duration,channels,current.controller.signal);
    });
    building.set(key,entry);
    entry.promise.finally(()=>{if(building.get(key)===current)building.delete(key);}).catch(()=>{});
  }
  if(!signal){entry.persistent=true;return entry.promise;}
  const current=entry,consumer={};current.consumers.add(consumer);
  return new Promise((resolve,reject)=>{
    const release=()=>{signal.removeEventListener('abort',abort);current.consumers.delete(consumer);};
    const abort=()=>{release();reject(signal.reason);if(!current.persistent&&!current.consumers.size)current.controller.abort();};
    signal.addEventListener('abort',abort,{once:true});
    current.promise.then(value=>{release();resolve(value);},error=>{release();reject(error);});
    if(signal.aborted)abort();
  });
}
async function indexPeaks(directory, id, meta, start, end, bins) {
  const perBin = (end - start) * RATE / bins;
  let index = 0; while (index + 1 < meta.levels.length && meta.levels[index + 1].step <= perBin) index++;
  const level = meta.levels[index], begin = Math.floor(start * RATE / level.step), finish = Math.min(level.count, Math.ceil(end * RATE / level.step));
  const peaks = new Float32Array(bins); if (finish <= begin) return peaks;
  const file = await fs.open(levelPath(directory, id, index));
  try {
    const buffer = Buffer.alloc((finish - begin) * PEAK_BYTES); await file.read(buffer, 0, buffer.length, begin * PEAK_BYTES);
    for (let i = 0; i < finish - begin; i++) {
      const from = Math.max(0, Math.floor(((begin + i) * level.step - start * RATE) / perBin));
      const to = Math.min(bins - 1, Math.ceil(((begin + i + 1) * level.step - start * RATE) / perBin) - 1);
      const value = buffer.readFloatLE(i * PEAK_BYTES);
      for (let bin = from; bin <= to; bin++) peaks[bin] = Math.max(peaks[bin], value);
    }
  } finally { await file.close(); }
  return peaks;
}
function normalize(peaks, max) { const scale = max > 0 ? max : 1; return peaks.map(value => Math.min(1, value / scale)); }
async function overview(directory, id, meta, duration) { return Array.from(normalize(await indexPeaks(directory, id, meta, 0, duration, 2048), meta.max)); }

function createWaveformReader(directory, prepare) {
  const assets = new Map(), pending = new Map(), cache = new Map(), queue = [], controllers = new Set(); let active = 0, closed = false;
  function pump() {
    while (!closed && active < 2 && queue.length) {
      const job = queue.shift(), controller = job.controller; if(controller.signal.aborted)continue; controllers.add(controller); active++;
      let timeout;
      (async () => {
        const { asset, start, end, bins, options } = job, id = asset.revision || asset.id;
        const stat = await fs.stat(asset.path);
        const { createHash } = require('node:crypto');
        if (createHash('sha256').update(path.resolve(asset.path) + stat.size + stat.mtimeMs).digest('hex').slice(0, 24) !== id) throw Error('素材が変更されています。再リンクしてください。');
        let meta = await readIndex(directory(), id), peaks, file=asset.path, indexId=id;
        const fine=(end-start)*RATE/bins<STEP;
        if(options.treatment){
          file=await prepare(asset.path,options.treatment,controller.signal);
          if(!fine){
            const processedStat=await fs.stat(file);
            indexId=createHash('sha256').update(path.resolve(file)+processedStat.size+processedStat.mtimeMs).digest('hex').slice(0,24);
            // Build the processed pyramid once, without a visible-range deadline.
            // Overview requests then read only screen-sized peak blocks.
            meta=await ensureWaveform(file,directory(),indexId,asset.duration,2,controller.signal);
          }
        }
        if (fine) {
          peaks = new Float32Array(bins);
          // Full-source treatment owns its preparation deadline; only bound the visible scan here.
          timeout = setTimeout(() => controller.abort(), 30000);
          await scan(file, options.treatment?2:meta.channels, (values, offset) => {
            for (let i = 0; i < values.length; i++) { const bin = Math.floor((offset + i) / RATE / (end - start) * bins); if (bin < bins) peaks[bin] = Math.max(peaks[bin], values[i]); }
          }, { start, duration: end - start, signal: controller.signal });
        } else peaks = await indexPeaks(directory(), indexId, meta, start, end, bins);
        controller.signal.throwIfAborted(); const result = options.absolute ? peaks : normalize(peaks, meta.max); cache.set(job.key, result); while (cache.size > 128) cache.delete(cache.keys().next().value); return result;
      })().then(job.resolve, job.reject).finally(() => { clearTimeout(timeout); active--; controllers.delete(controller); if(pending.get(job.key)===job)pending.delete(job.key); pump(); });
    }
  }
  return {
    register(url, asset) { assets.set(url, asset); },
    read(url, start, end, bins, options = {}, signal) {
      if(signal?.aborted)return Promise.reject(signal.reason);
      try{if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['absolute','treatment'].includes(k))||(options.absolute!==undefined&&typeof options.absolute!=='boolean')||(options.treatment&&!prepare))throw Error('波形表示設定が不正です。');validateTreatment(options.treatment);}catch(error){return Promise.reject(error);}
      options={absolute:!!options.absolute,treatment:options.treatment};
      const asset = typeof url === 'string' && assets.get(url);
      if (closed || !asset?.hasAudio || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > asset.duration + 1e-7 || !Number.isInteger(bins) || bins < 1 || bins > MAX_BINS) return Promise.reject(Error('音声波形の取得範囲が不正です。'));
      const key = JSON.stringify([url, start, end, bins, options]);
      if (cache.has(key)) { const value = cache.get(key); cache.delete(key); cache.set(key, value); return Promise.resolve(value); }
      let job=pending.get(key);
      if(!job){
        if (pending.size >= 32) return Promise.reject(Error('波形を準備しています。'));
        job={key,asset,start,end,bins,options,controller:new AbortController(),consumers:new Set()};
        job.result=new Promise((resolve,reject)=>{job.resolve=resolve;job.reject=reject;});
        pending.set(key,job);queue.push(job);
      }
      const consumer={};job.consumers.add(consumer);
      const result=new Promise((resolve,reject)=>{
        let settled=false;
        const finish=(error,value)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);job.consumers.delete(consumer);if(error)reject(error);else resolve(value);};
        const abort=()=>{
          finish(signal.reason);
          if(!job.consumers.size){job.controller.abort();if(pending.get(key)===job)pending.delete(key);const index=queue.indexOf(job);if(index>=0){queue.splice(index,1);job.reject(job.controller.signal.reason);}}
        };
        signal?.addEventListener('abort',abort,{once:true});
        job.result.then(value=>finish(null,value),error=>finish(error));
      });pump();return result;
    },
    close() { closed = true; for (const controller of controllers) controller.abort(); for (const job of queue.splice(0)) job.reject(Error('波形の読み込みを終了しました。')); assets.clear(); cache.clear(); },
  };
}
module.exports = { ensureWaveform, overview, createWaveformReader };
