const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { atomicWrite } = require('./persistence.cjs');
const entries = require('../shared/bundled-bgm.json');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
// Portable Windows extracts resources into a temporary directory. Persist these
// application-owned copies so saved projects keep valid paths after relaunch.
async function prepareBundledBgm(source, destination) {
  await fs.mkdir(destination, { recursive: true });
  for (const entry of entries) {
    const target = path.join(destination, entry.name);
    const existing = await fs.readFile(target).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (existing && digest(existing) === entry.sha256) continue;
    // These are app-owned copies. Repair only from a verified packaged source.
    const bytes = await fs.readFile(path.join(source, entry.name));
    if (digest(bytes) !== entry.sha256) throw new Error('初期BGMが破損しています: ' + entry.name);
    await atomicWrite(target, bytes);
  }
}
module.exports = { prepareBundledBgm };
