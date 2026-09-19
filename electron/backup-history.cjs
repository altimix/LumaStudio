const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { atomicWrite } = require('./persistence.cjs');
const { MAX_PROJECT_BYTES } = require('./project.cjs');
const { validateProject } = require('./export.cjs');
const VALID_ID = /^[a-f0-9]{24}-\d{13}-[a-f0-9-]{36}\.luma$/;
function createBackupHistory(directory, limit = 10) {
  let queue = Promise.resolve();
  const enqueue = action => { queue = queue.catch(() => {}).then(action); return queue; };
  const read = async id => {
    if (typeof id !== 'string' || !VALID_ID.test(id)) throw Error('バックアップの識別子が不正です。');
    const file = path.join(directory, id);
    if ((await fs.stat(file)).size > MAX_PROJECT_BYTES + 1000) throw Error('バックアップが大きすぎます。');
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    validateProject(value.project, { allowForeignPaths: true });
    if (typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt))) throw Error('バックアップの日時が不正です。');
    return value;
  };
  const ids = async () => (await fs.readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; })).filter(id => VALID_ID.test(id)).sort().reverse();
  return {
    write(contents, { deduplicate = false } = {}) { return enqueue(async () => {
      if (Buffer.byteLength(contents, 'utf8') > MAX_PROJECT_BYTES + 1000) throw Error('バックアップが大きすぎます。');
      const snapshot = JSON.parse(contents); validateProject(snapshot.project, { allowForeignPaths: true });
      if (typeof snapshot.savedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.savedAt))) throw Error('バックアップの日時が不正です。');
      const prefix = createHash('sha256').update(snapshot.project.id).digest('hex').slice(0, 24);
      if (deduplicate) {
        for (const item of (await ids()).filter(item => item.startsWith(`${prefix}-`))) {
          try {
            const existing = await read(item);
            if (existing.savedAt === snapshot.savedAt && JSON.stringify(existing.project) === JSON.stringify(snapshot.project)) return;
          } catch { /* A damaged snapshot cannot stand in for the legacy recovery. */ }
        }
      }
      const id = `${prefix}-${Date.now()}-${randomUUID()}.luma`;
      await atomicWrite(path.join(directory, id), contents);
      const entries = [];
      for (const item of (await ids()).filter(item => item.startsWith(`${prefix}-`))) {
        try { const snapshot = await read(item); entries.push({ id: item, savedAt: snapshot.savedAt }); } catch { /* Damaged files do not consume a recoverable generation. */ }
      }
      // Imported legacy snapshots keep their original age and cannot evict newer edits.
      // Prefer the completed write only when timestamps are identical.
      entries.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt) || (a.id === id ? -1 : b.id === id ? 1 : b.id.localeCompare(a.id)));
      await Promise.all(entries.slice(limit).map(item => fs.rm(path.join(directory, item.id), { force: true })));
    }); },
    list() { return enqueue(async () => {
      const result = [];
      for (const id of await ids()) {
        try { const value = await read(id); result.push({ id, projectId: value.project.id, name: value.project.name, savedAt: value.savedAt, clips: value.project.clips.length }); }
        catch { /* One damaged snapshot must not hide other recoverable versions. */ }
      }
      return result.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
    }); },
    read(id) { return enqueue(() => read(id)); },
  };
}
module.exports = { createBackupHistory };
