const path = require('node:path');
const fs = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const folder = path.join(__dirname, '..', 'vendor', 'media', `${process.platform}-${process.arch}`).replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
const extension = process.platform === 'win32' ? '.exe' : '';
const binaries = { ffmpeg: path.join(folder, 'ffmpeg' + extension), ffprobe: path.join(folder, 'ffprobe' + extension) };

function checksum(file) {
  const hash = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (let length; (length = fs.readSync(fd, buffer, 0, buffer.length, null));) hash.update(buffer.subarray(0, length));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

// A portable Windows build runs from a temporary extraction directory. Keep
// its tools in userData so cleanup of that directory cannot break later audio
// decoding, thumbnail generation, or exports while the editor is still open.
function stageMediaBinaries(sourceFolder, userData, version, platform = process.platform) {
  if (platform !== 'win32' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) throw new Error('メディアツールの保存先が不正です。');
  const names = ['ffmpeg.exe', 'ffprobe.exe'];
  const sources = names.map(name => path.join(sourceFolder, name));
  let hashes;
  try { hashes = sources.map(checksum); }
  catch (error) { throw new Error(`同梱メディアツールを読み込めません。配布EXEを再取得してください: ${error.message}`); }
  const digest = createHash('sha256').update(hashes.join(':')).digest('hex').slice(0, 24);
  const targetFolder = path.join(userData, 'media-tools', version, digest);
  try { fs.mkdirSync(targetFolder, { recursive: true }); }
  catch (error) { throw new Error(`メディアツールを保存できません。保存先の空き容量とアクセス権を確認してください: ${error.message}`); }
  const targets = names.map(name => path.join(targetFolder, name));
  for (let index = 0; index < names.length; index++) {
    const target = targets[index];
    try { if (checksum(target) === hashes[index]) continue; } catch { /* Copy a missing or damaged tool. */ }
    const temporary = target + '.' + randomUUID() + '.tmp';
    try {
      fs.copyFileSync(sources[index], temporary);
      if (checksum(temporary) !== hashes[index]) throw new Error('コピーしたファイルの照合に失敗しました。');
      try { fs.renameSync(temporary, target); }
      catch (error) {
        // Another instance may have installed the same immutable version.
        if (checksum(target) !== hashes[index]) throw error;
      }
    } catch (error) { throw new Error(`メディアツールを保存できません。保存先の空き容量とアクセス権を確認してください: ${error.message}`); }
    finally { fs.rmSync(temporary, { force: true }); }
  }
  return { ffmpeg: targets[0], ffprobe: targets[1] };
}

function preparePortableMedia(userData, version) {
  const staged = stageMediaBinaries(folder, userData, version);
  Object.assign(binaries, staged);
  Object.assign(module.exports, staged);
  return staged;
}

module.exports = { ...binaries, stageMediaBinaries, preparePortableMedia };
