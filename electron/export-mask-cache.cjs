const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { ffmpeg, ffprobe, run } = require('./media.cjs');
const { atomicWrite } = require('./persistence.cjs');

const MAX_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_CACHE_BYTES = 512 * 1024 * 1024;
const MAX_ENTRY_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const LEASE_AGE_MS = 2 * 60 * 60 * 1000;
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const maskCacheKey = details => hash(JSON.stringify({ version: 1, ...details }));
let implementationFingerprint;
function maskImplementationFingerprint() {
  if (!implementationFingerprint) implementationFingerprint = (async () => {
    const files = [ffmpeg, __filename, path.join(__dirname, 'export.cjs'), path.join(__dirname, 'frame-sequence.cjs'),
      path.join(__dirname, 'visual-animation.cjs'), path.join(__dirname, '..', 'shared', 'video-mask.mjs'),
      path.join(__dirname, '..', 'shared', 'visual-keyframes.mjs')];
    return hash((await Promise.all(files.map(fileHash))).join(':'));
  })();
  return implementationFingerprint;
}

async function fileHash(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

async function inspectMaskSequence(file, expected) {
  const result = JSON.parse((await run(ffprobe, ['-v', 'error', '-count_frames', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height,pix_fmt,nb_read_frames', '-of', 'json', file])).toString());
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
  async function lease() {
    if (!held.size) return;
    const dir = root();
    await fs.mkdir(dir, { recursive: true });
    await atomicWrite(path.join(dir, leaseName), JSON.stringify([...held]));
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
          /^[a-f0-9]{64}-[a-f0-9]{64}\.mkv$/.test(item) || /^\.[a-f0-9]{64}-[a-f0-9-]{36}\.mkv$/.test(item)
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
        if (report.version !== 1 || !hex(report.key) || !hex(report.digest) || report.key !== name.slice(0, -5)) continue;
        const video = `${report.key}-${report.digest}.mkv`, stat = await fs.stat(path.join(dir, video));
        if (!stat.isFile()) continue;
        result.push({ report: path.join(dir, name), video: path.join(dir, video), name: video, size: stat.size, time: (await fs.stat(path.join(dir, name))).mtimeMs });
      } catch { /* Damaged manifests are excluded from reuse. */ }
    }
    return result;
  }
  async function prune(limit = maxBytes, removeOrphans = false) {
    const protectedFiles = await protectedNames();
    const items = await entries();
    const referenced = new Set(items.map(item => item.name));
    const dir = root();
    for (const name of await fs.readdir(dir).catch(() => [])) {
      if (!(/^[a-f0-9]{64}-[a-f0-9]{64}\.mkv$/.test(name) || /^\.[a-f0-9]{64}-[a-f0-9-]{36}\.mkv$/.test(name)) ||
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
  async function getOrCreate(key, expected, build, signal) {
    if (!hex(key) || !Number.isInteger(expected?.frames) || expected.frames < 1 ||
        !Number.isInteger(expected.width) || expected.width < 1 ||
        !Number.isInteger(expected.height) || expected.height < 1) throw new Error('マスクキャッシュの条件が不正です。');
    signal?.throwIfAborted();
    const dir = root();
    await fs.mkdir(dir, { recursive: true });
    const reportPath = path.join(dir, `${key}.json`);
    try {
      const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
      if (report.version !== 1 || report.key !== key || !hex(report.digest) ||
          report.frames !== expected.frames || report.width !== expected.width || report.height !== expected.height) throw new Error('cache');
      const file = path.join(dir, `${key}-${report.digest}.mkv`);
      await keep(file);
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size !== report.bytes || stat.size < 1 || stat.size > Math.min(MAX_ENTRY_BYTES, maxBytes) ||
          await fileHash(file) !== report.digest) throw new Error('cache');
      signal?.throwIfAborted();
      await fs.utimes(reportPath, new Date(), new Date()).catch(() => {});
      return { file, hit: true };
    } catch (error) {
      if (signal?.aborted) throw error;
    }
    const temporary = path.join(dir, `.${key}-${randomUUID()}.mkv`);
    let retainTemporary = false;
    try {
      await keep(temporary);
      await build(temporary);
      signal?.throwIfAborted();
      await inspectMaskSequence(temporary, expected);
      const stat = await fs.stat(temporary);
      if (!stat.isFile() || stat.size < 1) throw new Error('動くマスクのキャッシュ動画が不正です。');
      if (stat.size > Math.min(MAX_ENTRY_BYTES, maxBytes)) {
        ephemeral.add(temporary);
        retainTemporary = true;
        return { file: temporary, hit: false };
      }
      const digest = await fileHash(temporary), file = path.join(dir, `${key}-${digest}.mkv`);
      await keep(file);
      await fs.rename(temporary, file);
      await atomicWrite(reportPath, JSON.stringify({ version: 1, key, digest, bytes: stat.size, ...expected }));
      await prune();
      return { file, hit: false };
    } finally { if (!retainTemporary) await fs.rm(temporary, { force: true }).catch(() => {}); }
  }
  async function release() {
    held.clear();
    for (const file of ephemeral) await fs.rm(file, { force: true }).catch(() => {});
    ephemeral.clear();
    if (leaseTimer) { clearInterval(leaseTimer); leaseTimer = undefined; }
    await fs.rm(path.join(root(), leaseName), { force: true }).catch(() => {});
    await prune(maxBytes, true);
  }
  async function clear() {
    await prune(0, true);
    const protectedFiles = await protectedNames();
    const protectedReports = new Set((await entries()).filter(item => protectedFiles.has(item.name)).map(item => path.basename(item.report)));
    for (const name of await fs.readdir(root()).catch(() => [])) {
      if (/^[a-f0-9]{64}\.json$/.test(name) && !protectedReports.has(name)) {
        await fs.rm(path.join(root(), name), { force: true });
      }
    }
    return { remainingBytes: (await entries()).reduce((sum, item) => sum + item.size, 0) };
  }
  return { getOrCreate, release, clear, prune };
}

module.exports = { createExportMaskCache, maskCacheKey, maskImplementationFingerprint, fileHash, inspectMaskSequence };
