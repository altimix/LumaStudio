const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { serializeProject, assertReplacement } = require('./project.cjs');
const { assertMediaRevision } = require('./media.cjs');

const isMediaRelative = value => typeof value === 'string' && /^media\/[^/\\\0]+$/.test(value) && !['.', '..'].includes(value.slice(6));
function resolveProjectMedia(project, projectFile) {
  if (!Array.isArray(project?.assets)) return project;
  return { ...project, assets: project.assets.map(asset => {
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) throw Error('素材の形式が不正です。');
    if (asset.relativePath === undefined) return asset;
    if (!isMediaRelative(asset.relativePath)) throw Error('素材の相対パスが不正です。');
    return { ...asset, path: path.resolve(path.dirname(projectFile), asset.relativePath) };
  }) };
}
function serializeAt(project, projectFile) {
  const directory = path.dirname(projectFile);
  return serializeProject({ ...project, assets: project.assets.map(asset => {
    const { relativePath: old, ...rest } = asset;
    const relative = path.relative(directory, asset.path).split(path.sep).join('/');
    return { ...rest, ...(isMediaRelative(relative) ? { relativePath: relative } : {}) };
  }) });
}
async function collectProject(project, directory) {
  // Validate before any copy, and use a unique destination which cannot replace an existing folder.
  const clean = JSON.parse(serializeProject(project));
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw Error('保存先フォルダが不正です。');
  const used = new Set(project.clips.map(clip => clip.assetId).filter(Boolean));
  if (project.youtube?.thumbnailAssetId) used.add(project.youtube.thumbnailAssetId);
  clean.assets = clean.assets.filter(asset => used.has(asset.id));
  const parent = await fs.realpath(directory), token = randomUUID().slice(0, 8);
  const name = (project.name || 'プロジェクト').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 60);
  const destination = path.join(parent, `${name}-${token}`), temporary = await fs.mkdtemp(path.join(parent, '.luma-collect-'));
  try {
    await fs.mkdir(path.join(temporary, 'media'));
    for (const [index, asset] of clean.assets.entries()) {
      const original = project.assets.find(item => item.id === asset.id);
      if (original.offline) throw Error(`素材が見つかりません：${asset.name}`);
      await assertMediaRevision(original);
      const filename = `${index + 1}-${path.basename(asset.path).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(-120)}`;
      const relativePath = `media/${filename}`;
      await fs.copyFile(asset.path, path.join(temporary, relativePath), fs.constants.COPYFILE_EXCL);
      await assertMediaRevision(original);
      // Original revision no longer describes the copy. Hydration measures its new identity.
      asset.path = path.join(destination, relativePath); asset.relativePath = relativePath;
    }
    await fs.writeFile(path.join(temporary, 'project.luma'), serializeProject(clean), { flag: 'wx' });
    await fs.rename(temporary, destination);
    return path.join(destination, 'project.luma');
  } catch (error) { await fs.rm(temporary, { recursive: true, force: true }); throw error; }
}
async function relinkFolder(project, folder, inspect) {
  serializeProject(project);
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const assets = [], unresolved = [];
  for (const saved of project.assets.filter(asset => asset.offline)) {
    const basename = path.win32.basename(saved.path.replace(/\//g, '\\')).toLowerCase();
    const candidates = entries.filter(entry => entry.isFile() && entry.name.toLowerCase() === basename);
    if (candidates.length !== 1) { unresolved.push(`${saved.name}：${candidates.length ? '同名の候補が複数あります' : '同名のファイルがありません'}`); continue; }
    try {
      const fresh = await inspect(path.join(folder, candidates[0].name));
      assertReplacement(saved, fresh);
      if (Math.abs(saved.duration - fresh.duration) > 1e-6 || saved.hasAudio !== fresh.hasAudio) throw Error('長さまたは音声の有無が一致しません');
      if (saved.size !== fresh.size || (saved.width && (saved.width !== fresh.width || saved.height !== fresh.height))) throw Error('サイズまたは解像度が一致しません');
      assets.push({ ...fresh, id: saved.id, name: saved.name, revision: fresh.id });
    } catch (error) { unresolved.push(`${saved.name}：${error.message}`); }
  }
  return { assets, unresolved };
}
module.exports = { resolveProjectMedia, serializeAt, collectProject, relinkFolder };
