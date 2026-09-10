const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const entries = require('../shared/media-sources.json');
(async () => {
  const folder = path.join(__dirname, '..', '.local', 'media-sources');
  await fs.mkdir(folder, { recursive: true });
  for (const entry of entries) {
    const file = path.join(folder, entry.name);
    let bytes = await fs.readFile(file).catch(() => null);
    const hash = data => crypto.createHash('sha256').update(data).digest('hex');
    if (bytes && hash(bytes) === entry.sha256) continue;
    const response = await fetch(entry.url);
    if (!response.ok) throw new Error(`Download failed: ${entry.name} (${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (hash(bytes) !== entry.sha256) throw new Error('Source checksum mismatch: ' + entry.name);
    await fs.writeFile(file, bytes);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
