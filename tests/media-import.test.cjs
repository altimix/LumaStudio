const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createMediaImporter } = require('../electron/media-import.cjs');
const { run } = require('../electron/media.cjs');

test('import cancellation retains only completed assets and releases the importer for retry', async () => {
  const updates = []; let started;
  const waiting = new Promise(resolve => { started = resolve; });
  const importer = createMediaImporter(async (file, { signal, onStage }) => {
    onStage('音声波形を作成しています');
    if (file.endsWith('second.mp4')) { started(); await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); }
    return { path: file };
  }, value => value, data => updates.push(data));
  const first = path.resolve('first.mp4');
  const task = importer.run([first, path.resolve('second.mp4'), path.resolve('third.mp4')]);
  await waiting; await assert.rejects(importer.run([first]), /前の素材/); importer.cancel();
  const result = await task;
  assert.deepEqual(result, { assets: [{ path: first }], errors: [], cancelled: true });
  assert.equal(updates.at(-1).stage, '音声波形を作成しています'); assert.equal(updates.at(-1).index, 2);
  assert.equal(importer.busy, false); assert.equal((await importer.run([first])).cancelled, false);
});

test('import errors do not discard completed files and bad inputs are rejected', async () => {
  const importer = createMediaImporter(async file => { if (file.endsWith('bad.mp4')) throw Error('壊れた素材'); return file; }, value => value, () => {});
  await assert.rejects(importer.run(['relative.mp4']), /不正/);
  const result = await importer.run([path.resolve('bad.mp4'), path.resolve('good.mp4')]);
  assert.equal(result.assets.length, 1); assert.match(result.errors[0], /壊れた素材/); assert.equal(result.cancelled, false);
});

test('media subprocess cancellation waits for child close and rejects as aborted', async () => {
  const controller = new AbortController();
  const pending = run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { signal: controller.signal });
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(pending, error => error.name === 'AbortError');
  await assert.rejects(run(process.execPath, ['-e', 'process.exit(0)'], { signal: controller.signal }), error => error.name === 'AbortError');
});
