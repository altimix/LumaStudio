const fs = require('node:fs/promises'), path = require('node:path'), { createHash } = require('node:crypto');
const entries = require('../shared/bundled-bgm.json');
const root = path.join(__dirname, '..'), output = path.join(root, '.local', 'bundled-bgm');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function prepareBgm() {
  await fs.mkdir(output, { recursive: true });
  for (const entry of entries) {
    const target = path.join(output, entry.name);
    let bytes = await fs.readFile(target).catch(() => null);
    if (bytes && hash(bytes) === entry.sha256) continue;
    bytes = await fs.readFile(path.join(root, 'bgm', entry.name)).catch(() => null);
    if (!bytes || hash(bytes) !== entry.sha256) {
      const response = await fetch(`https://github.com/altimix/LumaStudio/releases/download/build-bgm-v1/${entry.name}`);
      if (!response.ok) throw new Error(`BGM download failed: ${entry.name} (${response.status})`);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    if (hash(bytes) !== entry.sha256) throw new Error('BGMチェックサム不一致: ' + entry.name);
    await fs.writeFile(target, bytes);
  }
  console.log('初期BGM 001〜005のチェックサムを確認しました。');
}
module.exports = { prepareBgm };
if (require.main === module) prepareBgm().catch(error => { console.error(error); process.exitCode = 1; });
