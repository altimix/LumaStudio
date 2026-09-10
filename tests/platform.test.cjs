const { test } = require('node:test');
const assert = require('node:assert/strict');
const { packageTarget, packagedExecutable, assertMachArchitecture, ffprobeExclusions } = require('../scripts/platform.cjs');
test('native packaging preserves Windows and supports both Mac architectures', () => {
  assert.deepEqual(packageTarget('win32', 'x64'), ['--win', 'portable', '--x64']);
  for (const arch of ['arm64', 'x64']) {
    assert.deepEqual(packageTarget('darwin', arch), ['--mac', 'zip', `--${arch}`]);
    assert.match(packagedExecutable('/project', 'darwin', arch).split(require('node:path').sep).join('/'), /Luma Studio\.app\/Contents\/MacOS\/Luma Studio$/);
  }
  assert.match(packagedExecutable('/project', 'darwin', 'arm64'), /mac-arm64/);
  assert.throws(() => packageTarget('linux', 'x64'), /未対応/);
});

test('rejects a mislabeled Intel FFprobe on Apple Silicon', () => {
  const header = Buffer.alloc(8); header.writeUInt32LE(0xfeedfacf); header.writeUInt32LE(0x01000007, 4);
  assert.throws(() => assertMachArchitecture(header, 'arm64'), /対象Mac/);
  assert.doesNotThrow(() => assertMachArchitecture(header, 'x64'));
  header.writeUInt32LE(0x0100000c, 4);
  assert.doesNotThrow(() => assertMachArchitecture(header, 'arm64'));
});

test('only packages the target FFprobe binary', () => {
  assert.deepEqual(ffprobeExclusions('darwin', 'arm64'), ['!node_modules/ffprobe-static/bin/**/*']);
  assert.ok(ffprobeExclusions('win32', 'x64').includes('!node_modules/ffprobe-static/bin/darwin/**/*'));
  assert.ok(ffprobeExclusions('win32', 'x64').includes('!node_modules/ffprobe-static/bin/win32/ia32/**/*'));
  assert.ok(ffprobeExclusions('darwin', 'x64').includes('!node_modules/ffprobe-static/bin/darwin/arm64/**/*'));
});
