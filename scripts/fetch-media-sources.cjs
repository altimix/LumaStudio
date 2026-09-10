const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const entries = require('../shared/media-sources.json');
(async () => {
  const folder = path.join(__dirname, '..', '.local', 'media-sources');
  await fs.mkdir(folder, { recursive: true });
  for (const entry of entries) {
    const file = path.join(folder, entry.name);
    let bytes = await fs.readFile(file).catch(() => null);
    const hash = data => crypto.createHash('sha256').update(data).digest('hex');
    if (bytes && hash(bytes) === entry.sha256) continue;
    // Keep the archive bytes intact even when the origin labels a .tar.gz
    // response with Content-Encoding: gzip. fetch transparently decodes it.
    const download = file + '.download-' + process.pid;
    try {
      execFileSync('curl', ['--fail', '--location', '--retry', '2', '--silent', '--show-error', '--output', download, entry.url], { stdio: 'inherit' });
      bytes = await fs.readFile(download);
      if (hash(bytes) !== entry.sha256) throw new Error(`Source checksum mismatch: ${entry.name}; received ${hash(bytes)} (${bytes.length} bytes), expected ${entry.sha256}`);
      await fs.rename(download, file);
    } finally { await fs.rm(download, { force: true }); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
