const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createRecoveryStore } = require('../electron/recovery.cjs');

test('clearing recovery removes the snapshot and pending writes cannot restore it', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-recovery-test-')); const file = path.join(dir, 'autosave.luma');
  try {
    const recovery = createRecoveryStore(file); await recovery.write('saved snapshot');
    const pending = recovery.write('stale pending snapshot'); const cleared = recovery.clear();
    await Promise.all([pending, cleared]); await assert.rejects(fs.access(file));
    await recovery.clear(); // Clearing an already consumed recovery is idempotent.
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('a fresh project autosave survives a clear queued for the previous project', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-recovery-test-')); const file = path.join(dir, 'autosave.luma');
  try {
    const recovery = createRecoveryStore(file);
    await Promise.all([recovery.write('project A'), recovery.clear(), recovery.write('project B')]);
    assert.equal(await fs.readFile(file, 'utf8'), 'project B');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('dismissing an old recovery candidate cannot remove a newer autosave', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-recovery-test-')); const file = path.join(dir, 'autosave.luma');
  try {
    const recovery = createRecoveryStore(file);
    await recovery.write(JSON.stringify({ savedAt: 'old', project: 'A' }));
    await Promise.all([recovery.write(JSON.stringify({ savedAt: 'new', project: 'B' })), recovery.clear('old')]);
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).project, 'B');
    await recovery.clear('new'); await assert.rejects(fs.access(file));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
