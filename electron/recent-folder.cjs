const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicWrite } = require('./persistence.cjs');

async function recentFolder(configFile, fallback) {
  try {
    const { folder } = JSON.parse(await fs.readFile(configFile, 'utf8'));
    if (typeof folder === 'string' && path.isAbsolute(folder) && (await fs.stat(folder)).isDirectory()) return folder;
  } catch {}
  return fallback;
}
const rememberFolder = (configFile, file) => atomicWrite(configFile, JSON.stringify({ folder: path.dirname(file) }));
module.exports = { recentFolder, rememberFolder };
