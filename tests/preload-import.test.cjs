const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
test('preload imports require native File resolution and never call renderer array methods', async () => {
  let api; const calls = [], genuineFile = {};
  const electron = {
    contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
    ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve(); } },
    webUtils: { getPathForFile: file => file === genuineFile ? '/allowed/media.mp4' : '' },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8'), { require: () => electron });
  assert.throws(() => api.importMedia(['/arbitrary.mp4']), /ファイル選択/);
  const forged = [{}]; forged.map = () => ['/arbitrary.mp4'];
  assert.throws(() => api.importDroppedFiles(forged), /実際のファイル/);
  assert.equal(calls.length, 0);
  await api.importMedia(); await api.importDroppedFiles([genuineFile]);
  assert.equal(calls[0][0], 'import'); assert.equal(calls[0].length, 1);
  assert.equal(calls[1][0], 'import-dropped'); assert.deepEqual(Array.from(calls[1][1]), ['/allowed/media.mp4']);
});
