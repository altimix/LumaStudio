const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { assertDestination, atomicWrite } = require('../electron/persistence.cjs');
let dir;
before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-persistence-')); });
after(async () => { if (dir) await fs.rm(dir, { recursive: true, force: true }); });

test('refuses source-media destinations for project saves and exports', async () => {
  const source = path.join(dir, '元の素材.mp4'); await fs.writeFile(source, 'original-media');
  await assert.rejects(assertDestination(source, '.luma', [source]), /元の素材/);
  await assert.rejects(assertDestination(source, '.mp4', [source]), /元の素材/);
  assert.equal(await fs.readFile(source, 'utf8'), 'original-media');
});

test('recognizes source media through a directory junction or symlink', async () => {
  const actual = path.join(dir, 'actual'); const alias = path.join(dir, 'alias');
  await fs.mkdir(actual); await fs.writeFile(path.join(actual, 'source.mp4'), 'media');
  await fs.symlink(actual, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(assertDestination(path.join(alias, 'source.mp4'), '.mp4', [path.join(actual, 'source.mp4')]), /元の素材/);
});

test('enforces the output extension and accepts a new project beside offline media', async () => {
  await assert.rejects(assertDestination(path.join(dir, 'movie.mov'), '.mp4', []), /拡張子/);
  await assert.rejects(assertDestination('relative.luma', '.luma', []), /保存先/);
  await assertDestination(path.join(dir, '新規.LUMA'), '.luma', [path.join(dir, 'offline.mp4')]);
});

test('atomic save preserves unrelated .tmp files and cleans its own temporary files', async () => {
  const target = path.join(dir, 'project.luma');
  await fs.writeFile(target, 'old-project'); await fs.writeFile(target + '.tmp', 'user-file');
  await atomicWrite(target, '{"version":1}');
  assert.equal(await fs.readFile(target, 'utf8'), '{"version":1}');
  assert.equal(await fs.readFile(target + '.tmp', 'utf8'), 'user-file');
  assert.ok(!(await fs.readdir(dir)).some(name => /^\.luma-.*\.tmp$/.test(name)));
});

test('a failed replacement leaves the existing destination and no partial file', async () => {
  const target = path.join(dir, 'keep-directory'); await fs.mkdir(target);
  await fs.writeFile(path.join(target, 'keep.txt'), 'keep');
  await assert.rejects(atomicWrite(target, 'new-content'));
  assert.equal(await fs.readFile(path.join(target, 'keep.txt'), 'utf8'), 'keep');
  assert.ok(!(await fs.readdir(dir)).some(name => /^\.luma-.*\.tmp$/.test(name)));
});

test('Windows sharing failures retry the same complete temp file without removing the original', { skip: process.platform !== 'win32' }, async () => {
  const target = path.join(dir, '一時ロック.luma'); await fs.writeFile(target, 'original');
  const rename = fs.rename, temps = new Set(); let injected = 0;
  fs.rename = async (source, destination) => {
    if (destination === target) {
      temps.add(source); assert.equal(await fs.readFile(source, 'utf8'), 'complete replacement');
      if (injected < 3) {
        assert.equal(await fs.readFile(target, 'utf8'), 'original');
        throw Object.assign(new Error('temporary sharing violation'), { code: ['EPERM', 'EACCES', 'EBUSY'][injected++] });
      }
    }
    return rename(source, destination);
  };
  try { await atomicWrite(target, 'complete replacement'); }
  finally { fs.rename = rename; }
  assert.equal(injected, 3); assert.equal(temps.size, 1); assert.equal(await fs.readFile(target, 'utf8'), 'complete replacement');
  assert.ok(!(await fs.readdir(dir)).some(name => /^\.luma-.*\.tmp$/.test(name)));
});

test('persistent Windows denial is bounded and leaves the old file intact', { skip: process.platform !== 'win32' }, async () => {
  const target = path.join(dir, '解除されないロック.luma'); await fs.writeFile(target, 'keep');
  const rename = fs.rename, denied = Object.assign(new Error('permanent denial'), { code: 'EPERM' }); let attempts = 0;
  fs.rename = async (source, destination) => { if (destination !== target) return rename(source, destination); attempts++; assert.equal(await fs.readFile(target, 'utf8'), 'keep'); throw denied; };
  try { await assert.rejects(atomicWrite(target, 'new'), error => error === denied); }
  finally { fs.rename = rename; }
  assert.equal(attempts, 9); assert.equal(await fs.readFile(target, 'utf8'), 'keep');
  assert.ok(!(await fs.readdir(dir)).some(name => /^\.luma-.*\.tmp$/.test(name)));
});

test('non-sharing errors fail immediately and do not poison a later save to the same destination', async () => {
  const target = path.join(dir, '回復できる保存.luma'); await fs.writeFile(target, 'keep');
  const rename = fs.rename, failure = Object.assign(new Error('I/O failure'), { code: 'EIO' }); let attempts = 0;
  fs.rename = async (source, destination) => { if (destination !== target) return rename(source, destination); attempts++; throw failure; };
  try { await assert.rejects(atomicWrite(target, 'bad'), error => error === failure); }
  finally { fs.rename = rename; }
  assert.equal(attempts, 1); assert.equal(await fs.readFile(target, 'utf8'), 'keep');
  await atomicWrite(target, 'next valid save'); assert.equal(await fs.readFile(target, 'utf8'), 'next valid save');
  assert.ok(!(await fs.readdir(dir)).some(name => /^\.luma-.*\.tmp$/.test(name)));
});

test('an older Windows retry cannot overwrite a newer queued save', { skip: process.platform !== 'win32' }, async () => {
  const target = path.join(dir, '連続した保存.luma'); await fs.writeFile(target, 'initial');
  const rename = fs.rename; let denied = false; const published = [];
  fs.rename = async (source, destination) => {
    if (destination !== target) return rename(source, destination);
    const content = await fs.readFile(source, 'utf8');
    if (content === 'older' && !denied) { denied = true; throw Object.assign(new Error('sharing violation'), { code: 'EBUSY' }); }
    await rename(source, destination); published.push(content);
  };
  try { await Promise.all([atomicWrite(target, 'older'), atomicWrite(target, 'newer')]); }
  finally { fs.rename = rename; }
  assert.equal(denied, true); assert.deepEqual(published, ['older', 'newer']); assert.equal(await fs.readFile(target, 'utf8'), 'newer');
  assert.ok(!(await fs.readdir(dir)).some(name => /^\.luma-.*\.tmp$/.test(name)));
});
test('inaccessible offline sources do not block saves but destinations remain strict', async t => {
  const realpath = fs.realpath.bind(fs), source = path.join(dir, 'offline', 'clip.mp4'), output = path.join(dir, 'edit.luma');
  t.mock.method(fs, 'realpath', async file => { if (file === source) throw Object.assign(new Error('permission'), { code: 'EACCES' }); return realpath(file); });
  await assertDestination(output, '.luma', [source]);
  await assert.rejects(assertDestination(source, '.mp4', []), /permission/);
});
