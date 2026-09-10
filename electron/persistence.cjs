const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function canonical(file) {
  let absolute;
  try { absolute = await fs.realpath(file); }
  catch (error) { if (error.code !== 'ENOENT') throw error; absolute = path.resolve(file); }
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

async function assertDestination(file, extension, sourcePaths) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('保存先が不正です。');
  const target = await canonical(file);
  for (const source of sourcePaths) {
    if (await canonical(source) === target) throw new Error('元の素材を保存先に指定することはできません。');
  }
  if (path.extname(file).toLowerCase() !== extension) throw new Error(`保存先の拡張子は ${extension} にしてください。`);
}

const pendingWrites = new Map();
function atomicWrite(file, contents) {
  const absolute = path.resolve(file), key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  // A retry of an older save must never replace a newer successful save.
  const previous = pendingWrites.get(key) || Promise.resolve();
  const write = previous.catch(() => {}).then(() => writeAtomic(absolute, contents));
  pendingWrites.set(key, write);
  return write.finally(() => { if (pendingWrites.get(key) === write) pendingWrites.delete(key); });
}
async function writeAtomic(file, contents) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), `.luma-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temp, contents, { encoding: 'utf8', flag: 'wx' });
    for (let retry = 0; ; retry++) {
      try { await fs.rename(temp, file); break; }
      catch (error) {
        // Windows scanners/readers can briefly deny rename. Keep the complete
        // original in place and retry the SAME temp file for at most ~2 seconds.
        if (process.platform !== 'win32' || retry >= 8 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
        await new Promise(resolve => setTimeout(resolve, Math.min(25 * 2 ** retry, 400)));
      }
    }
  } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
}

module.exports = { assertDestination, atomicWrite };
