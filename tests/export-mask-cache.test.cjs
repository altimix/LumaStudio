const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const lockfile = require('proper-lockfile');
const { writeFrameSequence } = require('../electron/frame-sequence.cjs');
const { createExportMaskCache, maskCacheKey, maskImplementationFingerprint, fileHash, inspectMaskSequence } = require('../electron/export-mask-cache.cjs');
const { ffmpeg, run, inspectMedia } = require('../electron/media.cjs');
const { exportProject } = require('../electron/export.cjs');
const { setVisualKey } = require('../shared/visual-keyframes.mjs');

const expected = { width: 16, height: 16, frames: 2 };
const pgm = Buffer.concat([Buffer.from('P5\n16 16\n255\n'), Buffer.alloc(16 * 16, 128)]);
async function makeSequence(file) {
  await writeFrameSequence(file, { fps: 10, frames: 2, format: 'pgm', frame: () => pgm });
}

test('completed masks survive reuse and damaged data is rebuilt', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-mask-cache-'));
  const cache = createExportMaskCache(dir);
  const key = maskCacheKey({ clip: { id: 'mask', x: .5 }, fps: 10 });
  let builds = 0;
  const build = file => { builds++; return makeSequence(file); };
  try {
    const first = await cache.getOrCreate(key, expected, build);
    assert.equal(first.hit, false);
    assert.equal(builds, 1);
    const active = await cache.clear();
    assert.equal(active.inUse, true);
    assert.ok(active.remainingBytes > 0);
    assert.ok((await fs.stat(first.file)).isFile());
    await cache.release();
    const restarted = createExportMaskCache(dir);
    const reused = await restarted.getOrCreate(key, expected, build);
    assert.equal(reused.hit, true);
    assert.equal(builds, 1);
    await restarted.release();
    await fs.writeFile(reused.file, 'damaged');
    const repaired = await cache.getOrCreate(key, expected, build);
    assert.equal(repaired.hit, false);
    assert.equal(builds, 2);
    assert.notEqual(repaired.file, reused.file, 'repair publishes a new filename even for identical source frames');
    await cache.release();
    await assert.rejects(fs.stat(reused.file), { code:'ENOENT' });
    assert.notEqual(maskCacheKey({ clip: { id: 'mask', x: .6 }, fps: 10 }), key);
    assert.notEqual(maskCacheKey({ clip: { id: 'mask', x: .5 }, fps: 24 }), key);
    await fs.writeFile(path.join(dir, `${'a'.repeat(64)}.json`), 'damaged manifest');
    const cleared = await cache.clear();
    assert.equal(cleared.remainingBytes, 0);
    assert.equal(cleared.inUse, false);
    assert.equal((await fs.readdir(dir)).some(name => name.endsWith('.mkv')), false);
    assert.equal((await fs.readdir(dir)).some(name => name.endsWith('.json') && !name.startsWith('.lease')), false);
  } finally {
    await cache.release();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('cancellation leaves no reusable partial mask', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-canceled-mask-'));
  const cache = createExportMaskCache(dir);
  const controller = new AbortController();
  try {
    await assert.rejects(cache.getOrCreate(maskCacheKey({ canceled:true }), expected, async file => {
      await makeSequence(file);
      controller.abort();
    }, controller.signal), { name:'AbortError' });
    assert.equal((await fs.readdir(dir)).some(name => name.endsWith('.mkv') || /^[a-f0-9]{64}\.json$/.test(name)), false);
  } finally {
    await cache.release();
    await fs.rm(dir, { recursive:true, force:true });
  }
});

test('failed rebuilding removes a corrupted entry instead of keeping it referenced', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-failed-repair-mask-'));
  const cache = createExportMaskCache(dir), key = maskCacheKey({ repairFails:true });
  try {
    const first = await cache.getOrCreate(key, expected, makeSequence);
    await cache.release();
    await fs.writeFile(first.file, 'corrupted');
    await assert.rejects(cache.getOrCreate(key, expected, async () => { throw new Error('build failed'); }), /build failed/);
    await cache.release();
    await assert.rejects(fs.stat(first.file), { code:'ENOENT' });
    await assert.rejects(fs.stat(path.join(dir, `${key}.json`)), { code:'ENOENT' });
  } finally {
    await cache.release();
    await fs.rm(dir, { recursive:true, force:true });
  }
});

test('mask validation and hashing stop when export is cancelled', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-cancel-mask-validation-'));
  try {
    const video = path.join(dir, 'long-mask.mkv');
    await writeFrameSequence(video, { fps:24, frames:800, format:'pgm', frame:() => pgm });
    const probeController = new AbortController();
    const inspection = inspectMaskSequence(video, { width:16, height:16, frames:800 }, probeController.signal);
    setImmediate(() => probeController.abort());
    await assert.rejects(inspection, { name:'AbortError' });
    const largeFile = path.join(dir, 'large-mask.bin');
    await fs.writeFile(largeFile, Buffer.alloc(16 * 1024 * 1024));
    const hashController = new AbortController();
    const hashing = fileHash(largeFile, hashController.signal);
    setImmediate(() => hashController.abort());
    await assert.rejects(hashing, { name:'AbortError' });
  } finally {
    await fs.rm(dir, { recursive:true, force:true });
  }
});

test('implementation fingerprint hashing stops on cancellation and can be retried', async () => {
  const controller = new AbortController();
  const fingerprint = maskImplementationFingerprint(controller.signal);
  queueMicrotask(() => controller.abort());
  await assert.rejects(fingerprint, { name:'AbortError' });
  assert.match(await maskImplementationFingerprint(), /^[a-f0-9]{64}$/);
});

test('another cache instance cannot clear a mask in use', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-leased-mask-'));
  const cache = createExportMaskCache(dir), other = createExportMaskCache(dir);
  try {
    const result = await cache.getOrCreate(maskCacheKey({ leased:true }), expected, async file => {
      const beforeFirstFrame = await other.clear();
      assert.equal(beforeFirstFrame.remainingBytes, 0);
      assert.equal(beforeFirstFrame.inUse, true, 'an empty leased build is still active');
      await makeSequence(file);
      const building = await other.clear();
      assert.equal(building.inUse, true);
      assert.ok(building.remainingBytes > 0, 'include protected temporary files in the size');
      assert.ok((await fs.stat(file)).isFile());
    });
    const completed = await other.clear();
    assert.equal(completed.inUse, true);
    assert.ok(completed.remainingBytes > 0);
    assert.ok((await fs.stat(result.file)).isFile());
    await cache.release();
    const cleared = await other.clear();
    assert.equal(cleared.remainingBytes, 0);
    assert.equal(cleared.inUse, false);
  } finally {
    await cache.release();
    await other.release();
    await fs.rm(dir, { recursive:true, force:true });
  }
});

test('two app processes can publish the same mask key concurrently', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-concurrent-mask-'));
  const key = maskCacheKey({ concurrent:true });
  const script = `
    const fs=require('node:fs/promises'),path=require('node:path');
    const {createExportMaskCache}=require(process.argv[1]);
    const {writeFrameSequence}=require(process.argv[2]);
    const dir=process.argv[3],key=process.argv[4],cache=createExportMaskCache(dir);
    const pgm=Buffer.concat([Buffer.from('P5\\n16 16\\n255\\n'),Buffer.alloc(256,128)]);
    (async()=>{try{
      const result=await cache.getOrCreate(key,{width:16,height:16,frames:2},async file=>{
        await fs.writeFile(path.join(dir,'ready-'+process.pid),'');
        const deadline=Date.now()+30000;
        while((await fs.readdir(dir)).filter(name=>name.startsWith('ready-')).length<2){
          if(Date.now()>deadline)throw Error('second process did not begin the build');
          await new Promise(resolve=>setTimeout(resolve,20));
        }
        await writeFrameSequence(file,{fps:10,frames:2,format:'pgm',frame:()=>pgm});
      });
      console.log(result.file);
    }finally{await cache.release()}})().catch(error=>{console.error(error);process.exitCode=1});
  `;
  const runChild = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script,
      path.resolve('electron/export-mask-cache.cjs'), path.resolve('electron/frame-sequence.cjs'), dir, key],
    { windowsHide:true });
    let stdout='', stderr='';
    child.stdout.on('data', bytes => { stdout += bytes; });
    child.stderr.on('data', bytes => { stderr += bytes; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || `child exited ${code}`)));
  });
  const cache = createExportMaskCache(dir);
  try {
    const paths = await Promise.all([runChild(), runChild()]);
    assert.equal(paths.length, 2);
    const current = await cache.getOrCreate(key, expected, makeSequence);
    assert.equal(current.hit, true);
    assert.ok((await fs.stat(current.file)).isFile());
  } finally {
    await cache.release();
    await fs.rm(dir, { recursive:true, force:true });
  }
});

test('cache clearing waits for another process holding the write lock', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-locked-mask-'));
  const cache = createExportMaskCache(dir);
  const unlock = await lockfile.lock(dir, { stale:30000, update:10000 });
  let finished = false;
  try {
    const clearing = cache.clear().then(() => { finished = true; });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(finished, false);
    await unlock();
    await clearing;
    assert.equal(finished, true);
  } finally {
    await lockfile.unlock(dir).catch(() => {});
    await cache.release();
    await fs.rm(dir, { recursive:true, force:true });
  }
});

test('unused cache entries expire after thirty days', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-expired-mask-'));
  const cache = createExportMaskCache(dir), key = maskCacheKey({ expired:true });
  try {
    const result = await cache.getOrCreate(key, expected, makeSequence);
    await cache.release();
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await fs.utimes(path.join(dir, `${key}.json`), old, old);
    await cache.prune();
    await assert.rejects(fs.stat(result.file), { code:'ENOENT' });
  } finally {
    await cache.release();
    await fs.rm(dir, { recursive:true, force:true });
  }
});

test('an undeletable stale cache file cannot stop a new mask export', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-held-stale-mask-'));
  const cache = createExportMaskCache(dir), oldKey = maskCacheKey({ stale:true });
  const originalRemove = fs.rm;
  try {
    const stale = await cache.getOrCreate(oldKey, expected, makeSequence);
    await cache.release();
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await fs.utimes(path.join(dir, `${oldKey}.json`), old, old);
    fs.rm = async (file, options) => {
      if (file === stale.file) throw Object.assign(new Error('temporarily held'), { code:'EPERM' });
      return originalRemove(file, options);
    };
    const key = maskCacheKey({ next:true });
    const current = await cache.getOrCreate(key, expected, makeSequence);
    assert.ok((await fs.stat(current.file)).isFile(), 'the current export keeps its completed mask');
    await assert.rejects(fs.stat(path.join(dir, `${key}.json`)), { code:'ENOENT' });
    fs.rm = originalRemove;
    await cache.release();
    await assert.rejects(fs.stat(stale.file), { code:'ENOENT' });
    await assert.rejects(fs.stat(current.file), { code:'ENOENT' });
  } finally {
    fs.rm = originalRemove;
    await cache.release();
    await fs.rm(dir, { recursive:true, force:true });
  }
});

test('oversized masks are used for the current export and discarded afterwards', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-large-mask-cache-'));
  const cache = createExportMaskCache(dir, { maxBytes: 1 });
  try {
    const result = await cache.getOrCreate(maskCacheKey({ large:true }), expected, makeSequence);
    assert.equal(result.hit, false);
    assert.ok((await fs.stat(result.file)).size > 1);
    await cache.release();
    await assert.rejects(fs.stat(result.file), { code:'ENOENT' });
    assert.equal((await fs.readdir(dir)).some(name => name.endsWith('.json') && !name.startsWith('.lease')), false);
  } finally {
    await cache.release();
    await fs.rm(dir, { recursive:true, force:true });
  }
});

test('re-exported animated masks reuse verified frames without changing video or audio', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-mask-export-'));
  const cacheDir = path.join(dir, 'export-masks'), cache = createExportMaskCache(cacheDir);
  try {
    const source = path.join(dir, 'source.mp4');
    await fs.copyFile(path.resolve('public/demo/01-journey.mp4'), source);
    const asset = await inspectMedia(source, path.join(dir, 'media'));
    const mask = { type: 'rectangle', x: .25, y: .5, width: .25, height: .5, feather: .05, inverted: false };
    let clip = { id:'video', assetId:asset.id, trackId:'video', kind:'video', name:'動くマスク',
      start:0, in:0, duration:1, speed:1, x:0, y:0, scale:1, rotation:0, opacity:1,
      exposure:0, contrast:1, saturation:1, volume:1, fadeIn:0, fadeOut:0, videoMask:mask };
    clip = setVisualKey(setVisualKey(clip, 0), .5, { videoMask:{ ...mask, x:.75 } });
    const project = { version:1, id:'mask-cache', name:'動くマスク', width:960, height:540, fps:24,
      assets:[asset], tracks:[{ id:'video', kind:'video', name:'映像' }], markers:[], clips:[clip] };
    const settings = { width:960, height:540, fps:24, quality:'standard', encoder:'cpu' };
    const outputA = path.join(dir, 'first.mp4'), outputB = path.join(dir, 'second.mp4');
    await exportProject(project, settings, outputA, { maskCache:cache });
    const entries = (await fs.readdir(cacheDir)).filter(name => name.endsWith('.mkv'));
    assert.equal(entries.length, 1);
    const cached = path.join(cacheDir, entries[0]), before = (await fs.stat(cached)).mtimeMs;
    await exportProject(project, settings, outputB, { maskCache:cache });
    assert.equal((await fs.stat(cached)).mtimeMs, before);
    for (const args of [ ['-map','0:v:0','-pix_fmt','rgba','-f','framemd5','pipe:1'],
      ['-map','0:a:0','-ac','2','-ar','48000','-f','s16le','pipe:1'] ]) {
      const decode = file => run(ffmpeg, ['-v','error','-i',file,...args]);
      assert.deepEqual(await decode(outputB), await decode(outputA));
    }
    const cacheEntries = async () => (await fs.readdir(cacheDir)).filter(name => name.endsWith('.mkv')).length;
    await exportProject(project, { ...settings, fps:30 }, path.join(dir, 'fps-changed.mp4'), { maskCache:cache });
    assert.equal(await cacheEntries(), 2);
    await exportProject(project, { ...settings, width:1280, height:720 }, path.join(dir, 'size-changed.mp4'), { maskCache:cache });
    assert.equal(await cacheEntries(), 3);
    const changedMask = structuredClone(project);
    changedMask.clips[0].visualKeyframes.at(-1).values.videoMask.x = .65;
    await exportProject(changedMask, settings, path.join(dir, 'mask-changed.mp4'), { maskCache:cache });
    assert.equal(await cacheEntries(), 4);
    const controller = new AbortController();
    await assert.rejects(exportProject(project, settings, outputB, { signal:controller.signal,
      maskCache:{ getOrCreate:async () => { controller.abort(); controller.signal.throwIfAborted(); }, release:async () => {} },
    }), /書き出しをキャンセルしました/);
    assert.ok((await fs.stat(outputB)).size > 0);
    const originalRemove = fs.rm;
    let stranded, released = 0;
    fs.rm = async (file, options) => {
      if (options?.recursive && path.basename(String(file)).startsWith('luma-render-')) {
        stranded = file;
        throw new Error('simulated temporary cleanup failure');
      }
      return originalRemove(file, options);
    };
    try {
      await assert.rejects(exportProject(project, settings, outputB, { maskCache:{
        getOrCreate:async () => { throw new Error('simulated preparation failure'); },
        release:async () => { released++; },
      } }), /simulated temporary cleanup failure/);
      assert.equal(released, 1, 'cache lease must be released even when temp cleanup fails');
      assert.ok((await fs.stat(outputB)).size > 0);
    } finally {
      fs.rm = originalRemove;
      if (stranded) await fs.rm(stranded, { recursive:true, force:true });
    }
    await fs.appendFile(source, Buffer.from('changed'));
    await assert.rejects(exportProject(project, settings, outputB, { maskCache:cache }), /変更または削除/);
    assert.ok((await fs.stat(outputB)).size > 0);
  } finally {
    await cache.release();
    await fs.rm(dir, { recursive:true, force:true });
  }
});
