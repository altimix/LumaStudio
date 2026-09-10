const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');

(async () => {
  const dir = path.join(__dirname, '..', 'public', 'demo');
  const hashes = JSON.parse(await fs.readFile(path.join(dir, 'checksums.json'), 'utf8'));
  assert.equal(Object.keys(hashes).length, 7, 'Expected three videos, three thumbnails and one audio file');
  for (const [name, expected] of Object.entries(hashes)) {
    assert.equal(path.basename(name), name, 'Demo paths must stay in the fixture directory');
    const actual = createHash('sha256').update(await fs.readFile(path.join(dir, name))).digest('hex');
    assert.equal(actual, expected, `Demo checksum mismatch: ${name}`);
  }
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.length, 4);
  for (const asset of manifest) {
    assert.ok(hashes[asset.path]);
    assert.ok(!asset.playbackPath && !asset.thumbnailPath, 'Do not distribute machine-specific cache paths');
  }
  console.log('Bundled demo: 7 checksums and portable manifest verified.');
})().catch(error => { console.error(error); process.exitCode = 1; });
