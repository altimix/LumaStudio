const fs = require('node:fs/promises');
const path = require('node:path');
const { assertDestination, atomicWrite } = require('./persistence.cjs');
const { recentFolder, rememberFolder } = require('./recent-folder.cjs');

function frameName(name, time, fps) {
  const frame = Math.max(0, Math.round(time * fps));
  const seconds = Math.floor(frame / fps);
  const stamp = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60, frame % fps].map(n => String(n).padStart(2, '0')).join('-');
  let safe = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '') || '無題';
  while (Buffer.byteLength(safe, 'utf8') > 160) safe = Array.from(safe).slice(0, -1).join('');
  return `${safe}_${stamp}`;
}

async function unusedPath(folder, name, extension) {
  for (let i = 0; i < 10000; i++) {
    const file = path.join(folder, `${name}${i ? `_${String(i).padStart(3, '0')}` : ''}.${extension}`);
    try { await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return file; throw error; }
  }
  throw new Error('同名の画像が多すぎます。別の保存先を選んでください。');
}

function createFrameSaver({ configFile, defaultFolder, dialog, nativeImage, sourcePaths, importImage, onSaved = () => {} }) {
  let busy = false;
  return async request => {
    if (busy) throw new Error('写真の保存が完了するまでお待ちください。');
    busy = true;
    try {
      const { name, time, fps, width, height, format, addToProject, png } = request || {};
      if (typeof name !== 'string' || name.length > 256 || !Number.isFinite(time) || time < 0 || !Number.isSafeInteger(Math.round(time * fps)) || (!Number.isInteger(fps) || fps < 1 || fps > 120) || ![width,height].every(n => Number.isInteger(n) && n >= 2 && n % 2 === 0) || width > 7680 || height > 4320 || !['png','jpg'].includes(format) || typeof addToProject !== 'boolean' || typeof png !== 'string' || png.length > 180 * 1024 * 1024 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(png)) throw new Error('保存する写真の指定が不正です。');
      const bytes = Buffer.from(png.slice('data:image/png;base64,'.length), 'base64');
      if (bytes.length < 33 || bytes.subarray(0,8).toString('hex') !== '89504e470d0a1a0a' || bytes.subarray(12,16).toString() !== 'IHDR' || bytes.readUInt32BE(16) !== width || bytes.readUInt32BE(20) !== height) throw new Error('保存する写真のサイズが不正です。');
      const image = nativeImage.createFromDataURL(png);
      const size = image.getSize();
      if (image.isEmpty() || size.width !== width || size.height !== height) throw new Error('保存する写真のサイズが不正です。');
      const contents = format === 'jpg' ? image.toJPEG(95) : image.toPNG();
      if (!contents.length) throw new Error('写真を作成できませんでした。');
      const folder = await recentFolder(configFile, defaultFolder);
      const result = await dialog({ title: '現在のコマを写真として保存', defaultPath: await unusedPath(folder, frameName(name,time,fps),format), filters: [{ name: format === 'jpg' ? 'JPEG画像' : 'PNG画像', extensions: format === 'jpg' ? ['jpg','jpeg'] : ['png'] }] });
      if (result.canceled || !result.filePath) return null;
      const output = result.filePath, extension = path.extname(output).toLowerCase();
      if (!(format === 'jpg' ? ['.jpg','.jpeg'] : ['.png']).includes(extension)) throw new Error(`保存先の拡張子は ${format === 'jpg' ? '.jpg または .jpeg' : '.png'} にしてください。`);
      await assertDestination(output, extension, sourcePaths());
      await atomicWrite(output, contents);
      onSaved(output);
      const warnings = [];
      try { await rememberFolder(configFile, output); }
      catch { warnings.push('写真は保存しましたが、保存先フォルダを記憶できませんでした。'); }
      let asset;
      if (addToProject) {
        try { asset = await importImage(output); }
        catch { warnings.push('写真は保存しましたが、素材への追加に失敗しました。「素材を読み込む」から追加してください。'); }
      }
      return { path: output, asset, warning: warnings.join('\n') };
    } finally { busy = false; }
  };
}

module.exports = { frameName, unusedPath, createFrameSaver };
