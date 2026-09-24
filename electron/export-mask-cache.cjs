const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const lockfile = require('proper-lockfile');
const { ffmpeg, ffprobe, run } = require('./media.cjs');
const { atomicWrite } = require('./persistence.cjs');

const MAX_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_CACHE_BYTES = 512 * 1024 * 1024;
const MAX_ENTRY_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const LEASE_AGE_MS = 2 * 60 * 60 * 1000;
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const legacyVideoName = /^[a-f0-9]{64}-[a-f0-9]{64}\.mkv$/;
const cacheVideoName = /^[a-f0-9]{64}-[a-f0-9]{64}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.mkv$/;
const temporaryVideoName = /^\.[a-f0-9]{64}-[a-f0-9-]{36}\.mkv$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const maskCacheKey = details => hash(JSON.stringify({ version: 2, ...details }));
let implementationFingerprint;
async function maskImplementationFingerprint(signal) {
  signal?.throwIfAborted();
  if (implementationFingerprint) return implementationFingerprint;
  const files = [ffmpeg, __filename, path.join(__dirname, 'export.cjs'), path.join(__dirname, 'frame-sequence.cjs'),
    path.join(__dirname, 'visual-animation.cjs'), path.join(__dirname, '..', 'shared', 'video-mask.mjs'),
    path.join(__dirname, '..', 'shared', 'visual-keyframes.mjs')];
  const fingerprints = await Promise.all(files.map(file => fileHash(file, signal)));
  signal?.throwIfAborted();
  implementationFingerprint = hash(fingerprints.join(':'));
  return implementationFingerprint;
}

async function fileHash(file, signal) {
  signal?.throwIfAborted();
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file, { signal })) {
    signal?.throwIfAborted();
    digest.update(chunk);
  }
  signal?.throwIfAborted();
  return digest.digest('hex');
}

async function inspectMaskSequence(file, expected, signal) {
  signal?.throwIfAborted();
  const result = JSON.parse((await run(ffprobe, ['-v', 'error', '-count_frames', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height,pix_fmt,nb_read_frames', '-of', 'json', file], { signal })).toString());
  signal?.throwIfAborted();
  const stream = result.streams?.[0];
  if (stream?.codec_name !== 'ffv1' || stream.width !== expected.width || stream.height !== expected.height ||
      stream.pix_fmt !== 'gray' || Number(stream.nb_read_frames) !== expected.frames) {
    throw new Error('動くマスクのキャッシュ動画が不正です。');
  }
}

function createExportMaskCache(directory, { maxBytes = MAX_CACHE_BYTES } = {}) {
  const root = typeof directory === 'function' ? directory : () => directory;
  const held = new Set();
  const ephemeral = new Set();
  const leaseName = `.lease-${process.pid}-${randomUUID()}.json`;
  let leaseTimer;
  async function synchronized(action) {
    const dir = root();
    await fs.mkdir(dir, { recursive: true });
    let compromised;
    const unlock = await lockfile.lock(dir, { stale:30000, update:10000,
      retries:{ retries:100, minTimeout:20, maxTimeout:100, factor:1 },
      onCompromised:error => { compromised = error; } });
    try {
      const result = await action();
      if (compromised) throw compromised;
      return result;
    } finally { await unlock(); }
  }
  async function lease() {
    if (!held.size) return;
    await synchronized(() => atomicWrite(path.join(root(), leaseName), JSON.stringify([...held])));
  }
  function keep(file) {
    held.add(path.basename(file));
    if (!leaseTimer) {
      leaseTimer = setInterval(() => { void lease().catch(() => {}); }, 5 * 60 * 1000);
      leaseTimer.unref?.();
    }
    return lease();
  }
  async function protectedNames() {
    const dir = root(), protectedFiles = new Set(held);
    for (const name of await fs.readdir(dir).catch(() => [])) {
      if (!/^\.lease-\d+-[a-f0-9-]+\.json$/.test(name)) continue;
      const file = path.join(dir, name), stat = await fs.stat(file).catch(() => null);
      if (!stat || Date.now() - stat.mtimeMs > LEASE_AGE_MS) {
        await fs.rm(file, { force: true }).catch(() => {});
        continue;
      }
      try {
        const listed = JSON.parse(await fs.readFile(file, 'utf8'));
        if (Array.isArray(listed)) for (const item of listed) if (typeof item === 'string' && (
          legacyVideoName.test(item) || cacheVideoName.test(item) || temporaryVideoName.test(item)
        )) protectedFiles.add(item);
      } catch { /* An incomplete lease cannot name a cache entry. */ }
    }
    return protectedFiles;
  }
  async function entries() {
    const dir = root(), result = [];
    for (const name of await fs.readdir(dir).catch(() => [])) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      try {
        const report = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
        if (report.version !== 2 || !hex(report.key) || !hex(report.digest) || report.key !== name.slice(0, -5) ||
            !cacheVideoName.test(report.file) || !report.file.startsWith(`${report.key}-${report.digest}-`)) continue;
        const video = report.file, stat = await fs.stat(path.join(dir, video));
        if (!stat.isFile()) continue;
        result.push({ report: path.join(dir, name), video: path.join(dir, video), name: video, size: stat.size, time: (await fs.stat(path.join(dir, name))).mtimeMs });
      } catch { /* Damaged manifests are excluded from reuse. */ }
    }
    return result;
  }
  async function pruneLocked(limit = maxBytes, removeOrphans = false) {
    const protectedFiles = await protectedNames();
    const items = await entries();
    const referenced = new Set(items.map(item => item.name));
    const dir = root();
    for (const name of await fs.readdir(dir).catch(() => [])) {
      if (!(legacyVideoName.test(name) || cacheVideoName.test(name) || temporaryVideoName.test(name)) ||
          referenced.has(name) || protectedFiles.has(name)) continue;
      const file = path.join(dir, name), stat = await fs.stat(file).catch(() => null);
      if (stat && (removeOrphans || Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1000)) {
        await fs.rm(file, { force: true });
      }
    }
    let total = items.reduce((sum, item) => sum + item.size, 0);
    for (const item of items.sort((a, b) => a.time - b.time)) {
      if (protectedFiles.has(item.name)) continue;
      if (total <= limit && Date.now() - item.time <= MAX_ENTRY_AGE_MS) continue;
      await fs.rm(item.report, { force: true });
      await fs.rm(item.video, { force: true });
      total -= item.size;
    }
    return total;
  }
  const prune = (limit = maxBytes, removeOrphans = false) => synchronized(() => pruneLocked(limit, removeOrphans));
  async function getOrCreate(key, expected, build, signal) {
    if (!hex(key) || !Number.isInteger(expected?.frames) || expected.frames < 1 ||
        !Number.isInteger(expected.width) || expected.width < 1 ||
        !Number.isInteger(expected.height) || expected.height < 1) throw new Error('マスクキャッシュの条件が不正です。');
    signal?.throwIfAborted();
    const dir = root();
    await fs.mkdir(dir, { recursive: true });
    const reportPath = path.join(dir, `${key}.json`);
    let observedManifest, invalidManifest = false;
    try {
      observedManifest = await fs.readFile(reportPath, 'utf8');
      let report;
      try { report = JSON.parse(observedManifest); }
      catch (error) { invalidManifest = true; throw error; }
      if (!report || typeof report !== 'object' || report.version !== 2 || report.key !== key || !hex(report.digest) ||
          !cacheVideoName.test(report.file) || !report.file.startsWith(`${key}-${report.digest}-`) ||
          report.frames !== expected.frames || report.width !== expected.width || report.height !== expected.height) {
        invalidManifest = true; throw new Error('cache');
      }
      const file = path.join(dir, report.file);
      await keep(file);
      const stat = await fs.stat(file).catch(() => null);
      if (!stat?.isFile() || stat.size !== report.bytes || stat.size < 1 || stat.size > Math.min(MAX_ENTRY_BYTES, maxBytes) ||
          await fileHash(file, signal).catch(error => { if (signal?.aborted) throw error; return null; }) !== report.digest) {
        invalidManifest = true; throw new Error('cache');
      }
      signal?.throwIfAborted();
      await fs.utimes(reportPath, new Date(), new Date()).catch(() => {});
      return { file, hit: true };
    } catch (error) {
      if (invalidManifest) await synchronized(async () => {
        if (await fs.readFile(reportPath, 'utf8').catch(() => null) === observedManifest) {
          await fs.rm(reportPath, { force: true });
        }
      });
      if (signal?.aborted) throw error;
    }
    const temporary = path.join(dir, `.${key}-${randomUUID()}.mkv`);
    let retainTemporary = false;
    try {
      await keep(temporary);
      await build(temporary);
      signal?.throwIfAborted();
      await inspectMaskSequence(temporary, expected, signal);
      const stat = await fs.stat(temporary);
      if (!stat.isFile() || stat.size < 1) throw new Error('動くマスクのキャッシュ動画が不正です。');
      if (stat.size > Math.min(MAX_ENTRY_BYTES, maxBytes)) {
        ephemeral.add(temporary);
        retainTemporary = true;
        return { file: temporary, hit: false };
      }
      const digest = await fileHash(temporary, signal), name = `${key}-${digest}-${randomUUID()}.mkv`, file = path.join(dir, name);
      await keep(file);
      await fs.rename(temporary, file);
      await atomicWrite(reportPath, JSON.stringify({ version: 2, key, digest, file: name, bytes: stat.size, ...expected }));
      await prune();
      return { file, hit: false };
    } finally { if (!retainTemporary) await fs.rm(temporary, { force: true }).catch(() => {}); }
  }
  async function release() {
    held.clear();
    for (const file of ephemeral) await fs.rm(file, { force: true }).catch(() => {});
    ephemeral.clear();
    if (leaseTimer) { clearInterval(leaseTimer); leaseTimer = undefined; }
    await synchronized(() => fs.rm(path.join(root(), leaseName), { force: true })).catch(() => {});
    await prune(maxBytes, true);
  }
  async function clear() {
    return synchronized(async () => {
      await pruneLocked(0, true);
      const protectedFiles = await protectedNames();
      const protectedReports = new Set((await entries()).filter(item => protectedFiles.has(item.name)).map(item => path.basename(item.report)));
      for (const name of await fs.readdir(root()).catch(() => [])) {
        if (/^[a-f0-9]{64}\.json$/.test(name) && !protectedReports.has(name)) {
          await fs.rm(path.join(root(), name), { force: true });
        }
      }
      let remainingBytes = 0;
      for (const name of protectedFiles) {
        const stat = await fs.stat(path.join(root(), name)).catch(() => null);
        if (stat?.isFile()) remainingBytes += stat.size;
      }
      // A leased build may not have written its first byte yet.
      return { remainingBytes, inUse: protectedFiles.size > 0 };
    });
  }
  return { getOrCreate, release, clear, prune };
}

module.exports = { createExportMaskCache, maskCacheKey, maskImplementationFingerprint, fileHash, inspectMaskSequence };
