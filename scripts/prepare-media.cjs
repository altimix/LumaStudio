const fs = require('node:fs/promises'), path = require('node:path'), { execFileSync } = require('node:child_process'), { createHash } = require('node:crypto');
(async () => {
  const root = path.join(__dirname, '..'), platform = `${process.platform}-${process.arch}`;
  if (!['darwin-arm64', 'win32-x64'].includes(platform)) throw new Error('Prebuilt tools are available for Mac arm64 and Windows x64.');
  const folder = path.join(root, '.local', 'media-download'), name = `${platform}.tar.gz`;
  await fs.mkdir(folder, { recursive: true });
  const base = 'https://github.com/altimix/LumaStudio/releases/download/media-tools-v1/';
  const sumsResponse = await fetch(base + 'SHA256SUMS.txt');
  if (!sumsResponse.ok) throw new Error('Media tool checksums unavailable. Use npm run build:media to build from source.');
  const line = (await sumsResponse.text()).split('\n').find(line => line.trim().endsWith('  ' + name));
  if (!line) throw new Error('Missing media-tool checksum');
  const response = await fetch(base + name);
  if (!response.ok) throw new Error('Media tool download failed');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== line.split(/\s+/)[0]) throw new Error('Media tool checksum mismatch');
  const archive = path.join(folder, name); await fs.writeFile(archive, bytes);
  execFileSync('tar', ['-xf', archive, '-C', root], { stdio: 'inherit' });
  require('./check-media.cjs');
})().catch(error => { console.error(error); process.exitCode = 1; });
