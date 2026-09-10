const fs = require('node:fs/promises');
const { atomicWrite } = require('./persistence.cjs');

function createRecoveryStore(file) {
  let generation = 0;
  let queue = Promise.resolve();
  const enqueue = action => { queue = queue.catch(() => {}).then(action); return queue; };
  return {
    write(contents) {
      const current = generation;
      return enqueue(() => current === generation ? atomicWrite(file, contents) : undefined);
    },
    clear(expectedSavedAt) {
      if (expectedSavedAt !== undefined) return enqueue(async () => {
        let snapshot;
        try { snapshot = JSON.parse(await fs.readFile(file, 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') return; throw error; }
        if (snapshot.savedAt === expectedSavedAt) await fs.rm(file, { force: true });
      });
      generation++;
      // Removal waits for an in-flight write; older queued writes cannot resurrect it.
      return enqueue(() => fs.rm(file, { force: true }));
    },
  };
}

module.exports = { createRecoveryStore };
