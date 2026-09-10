const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
test('repairs an app-owned BGM copy only from a verified source', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-bundled-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), destination = path.join(root, 'copy');
  await fs.mkdir(source); await fs.mkdir(destination);
  const original = Buffer.from('verified test music'), name = 'BGM001.mp3';
  const entries = [{ name, sha256: createHash('sha256').update(original).digest('hex') }];
  const module = { exports: {} };
  vm.runInNewContext(await fs.readFile(path.join(__dirname, '../electron/bundled-bgm.cjs'), 'utf8'), {
    module, Buffer, require: id => id === '../shared/bundled-bgm.json' ? entries : id === './persistence.cjs' ? require('../electron/persistence.cjs') : require(id),
  });
  const { prepareBundledBgm } = module.exports;
  const target = path.join(destination, name), packaged = path.join(source, name);
  await fs.writeFile(packaged, original); await fs.writeFile(target, 'corrupt');
  await prepareBundledBgm(source, destination);
  assert.deepEqual(await fs.readFile(target), original);
  const before = (await fs.stat(target)).mtimeMs;
  await prepareBundledBgm(source, destination);
  assert.equal((await fs.stat(target)).mtimeMs, before);
  await fs.writeFile(target, 'damaged copy'); await fs.writeFile(packaged, 'damaged source');
  await assert.rejects(prepareBundledBgm(source, destination), /初期BGMが破損/);
  assert.equal(await fs.readFile(target, 'utf8'), 'damaged copy');
  assert.deepEqual(await fs.readdir(destination), [name]);
});
