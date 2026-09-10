const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { ffmpeg, run, inspectMedia, probe, assertMediaRevision } = require('../electron/media.cjs');
test('TIFF imports use a full-size PNG playback proxy without modifying the source', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-tiff-'));
  try {
    const file = path.join(dir, '日本語 画像.tiff');
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=640x360', '-frames:v', '1', file]);
    const original = await fs.readFile(file), asset = await inspectMedia(file, path.join(dir, 'cache'));
    assert.equal(asset.kind, 'image'); assert.equal(asset.proxy, true); assert.equal(asset.path, file);
    assert.match(asset.playbackPath, /\.png$/);
    const bytes = await fs.readFile(asset.playbackPath);
    assert.deepEqual([...bytes.subarray(0, 8)], [137,80,78,71,13,10,26,10]);
    const info = await probe(asset.playbackPath); assert.equal(info.streams[0].width, 640); assert.equal(info.streams[0].height, 360);
    assert.deepEqual(await fs.readFile(file), original);
    await assertMediaRevision(asset);
    const stat = await fs.stat(file); await fs.utimes(file, stat.atime, new Date(stat.mtimeMs + 2000));
    await assert.rejects(assertMediaRevision(asset), /変更または削除/);
    await fs.rm(file); await assert.rejects(assertMediaRevision(asset), /変更または削除/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
