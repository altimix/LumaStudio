const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
(async () => {
  const dir = path.join(__dirname, '..', 'release');
  const version = require('../package.json').version;
  const name = process.platform === 'darwin' ? `Luma-Studio-${version}-macOS-${process.arch}.zip` : `Luma-Studio-${version}-Windows.exe`;
  const digest = createHash('sha256').update(await fs.readFile(path.join(dir, name))).digest('hex');
  await fs.writeFile(path.join(dir, 'SHA256SUMS.txt'), `${digest}  ${name}\n`);
  console.log(`${name}: ${digest}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
