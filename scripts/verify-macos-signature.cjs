const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function verifyBundle(app) {
  const checked = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      // Framework aliases must not be traversed twice or escape the bundle.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) {
        const header = Buffer.alloc(4), fd = fs.openSync(file, 'r');
        try { fs.readSync(fd, header, 0, 4, 0); } finally { fs.closeSync(fd); }
        if (!['cffaedfe', 'cefaedfe', 'feedfacf', 'feedface', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(header.toString('hex'))) continue;
        run('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', file]);
        checked.push(path.relative(app, file));
      }
    }
  }
  walk(app);
  if (!checked.some(file => file.endsWith('/ffmpeg')) || !checked.some(file => file.endsWith('/ffprobe')))
    throw new Error('署名検証対象にFFmpeg / FFprobeがありません。');
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', app]);
  const seal = path.join(app, 'Contents', '_CodeSignature', 'CodeResources');
  if (!fs.existsSync(seal)) throw new Error('アプリのリソース署名がありません。');
  return checked;
}

function verifyMacArchive(root = path.join(__dirname, '..')) {
  if (process.platform !== 'darwin') throw new Error('Macの署名検証はmacOSで実行してください。');
  const { version } = require(path.join(root, 'package.json'));
  const archive = path.join(root, 'release', `Luma-Studio-${version}-macOS-${process.arch}.zip`);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'luma-signature-'));
  try {
    run('/usr/bin/ditto', ['-x', '-k', archive, temporary]);
    const app = path.join(temporary, 'Luma Studio.app');
    const checked = verifyBundle(app);
    // Prove the verifier detects a resource change, not just a valid Mach-O header.
    const resource = path.join(app, 'Contents', 'Resources', 'app.asar');
    const fd = fs.openSync(resource, 'r+');
    try {
      const byte = Buffer.alloc(1);
      if (fs.readSync(fd, byte, 0, 1, 0) !== 1) throw new Error('app.asarが空です。');
      byte[0] ^= 0xff;
      fs.writeSync(fd, byte, 0, 1, 0);
    } finally { fs.closeSync(fd); }
    let rejected = false;
    try { run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]); }
    catch (error) { if (error.status !== 0 && Number.isInteger(error.status)) rejected = true; else throw error; }
    if (!rejected) throw new Error('改変したアプリが署名検証を通過しました。');
    const report = { archive: path.basename(archive), passed: true, checked, tamperedResourceRejected: true,
      notarized: false, gatekeeperExceptionTested: false };
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    fs.writeFileSync(path.join(root, 'test-results', 'macos-signature.json'), JSON.stringify(report, null, 2));
    console.log(`Mac配布ZIPの署名検証に成功: ${checked.length}個の実行コード、リソース改変の拒否`);
    return report;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

module.exports = { verifyBundle, verifyMacArchive };
if (require.main === module) verifyMacArchive();
