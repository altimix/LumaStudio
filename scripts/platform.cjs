const path = require('node:path');
function packageTarget(platform = process.platform, arch = process.arch) {
  if (platform === 'win32' && arch === 'x64') return ['--win', 'portable', '--x64'];
  if (platform === 'darwin' && ['arm64', 'x64'].includes(arch)) return ['--mac', 'zip', `--${arch}`];
  throw new Error(`未対応のビルド環境です: ${platform}/${arch}`);
}
function packagedExecutable(root, platform = process.platform, arch = process.arch) {
  packageTarget(platform, arch);
  return platform === 'darwin'
    ? path.join(root, 'release', arch === 'arm64' ? 'mac-arm64' : 'mac', 'Luma Studio.app', 'Contents', 'MacOS', 'Luma Studio')
    : path.join(root, 'release', 'win-unpacked', 'Luma Studio.exe');
}
function assertMachArchitecture(header, arch) {
  const cpu = { arm64: 0x0100000c, x64: 0x01000007 }[arch];
  if (!cpu || header.length < 8 || header.readUInt32LE(0) !== 0xfeedfacf || header.readUInt32LE(4) !== cpu)
    throw new Error(`同梱バイナリがMac ${arch}用ではありません。対象Macでnpm ciを実行してください。`);
}
function ffprobeExclusions(platform = process.platform, arch = process.arch) {
  packageTarget(platform, arch);
  if (platform === 'darwin' && arch === 'arm64') return ['!node_modules/ffprobe-static/bin/**/*'];
  return [
    ...['darwin', 'linux', 'win32'].filter(os => os !== platform).map(os => `!node_modules/ffprobe-static/bin/${os}/**/*`),
    `!node_modules/ffprobe-static/bin/${platform}/${platform === 'win32' ? 'ia32' : 'arm64'}/**/*`,
  ];
}
module.exports = { packageTarget, packagedExecutable, assertMachArchitecture, ffprobeExclusions };
