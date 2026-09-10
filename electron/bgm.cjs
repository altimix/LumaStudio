const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { atomicWrite } = require('./persistence.cjs');
const extensions = /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i;
const identity = (file,stat) => createHash('sha256').update(file + stat.size + stat.mtimeMs).digest('hex').slice(0,24);
const samePath = (a,b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

async function validatePath(file, root, directory = false) {
  const stat = await fs.lstat(file), real = await fs.realpath(file), relative = path.relative(root, real);
  if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile()) || !samePath(real, file) || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('BGMファイルが変更または移動されています。');
  return stat;
}

function createBgmLibrary({ configFile, candidates, probe, inspect, present }) {
  let folder, initialized = false, scan;
  let known = new Map();
  const loading = new Map();
  const initialFolder = async () => {
    if (initialized) return; initialized = true;
    try { const data = JSON.parse(await fs.readFile(configFile, 'utf8')); if (typeof data.folder === 'string' && path.isAbsolute(data.folder)) folder = data.folder; } catch {}
    if (folder) return;
    for (const candidate of candidates.filter(Boolean)) {
      try { if ((await fs.stat(candidate)).isDirectory()) { folder = candidate; break; } } catch {}
    }
  };
  async function list(selectedFolder) {
    if (selectedFolder !== undefined && (typeof selectedFolder !== 'string' || !path.isAbsolute(selectedFolder))) throw new Error('BGMフォルダが不正です。');
    if (scan) {
      if (selectedFolder === undefined) return scan;
      throw new Error('BGMを読み込み中です。完了後にもう一度お試しください。');
    }
    scan = scanFolder(selectedFolder);
    try { return await scan; } finally { scan = undefined; }
  }
  async function scanFolder(selectedFolder) {
    try {
      await initialFolder();
      const target = selectedFolder ?? folder;
      if (!target) return { folder: null, tracks: [], errors: [], truncated: false };
      const root = await fs.realpath(target);
      if (!(await fs.stat(root)).isDirectory()) throw new Error('BGMフォルダを選んでください。');
      const tracks = [], errors = [], next = new Map(); let directories = 0, visited = 0, truncated = false;
      async function walk(directory, depth) {
        if (++directories > 256) { truncated = true; return; }
        await validatePath(directory, root, true);
        const entries = await fs.readdir(directory, { withFileTypes: true });
        entries.sort((a,b) => a.name.localeCompare(b.name, 'ja'));
        for (const entry of entries) {
          if (tracks.length >= 2000 || ++visited > 20000) { truncated = true; return; }
          if (entry.isSymbolicLink()) continue;
          const file = path.join(directory, entry.name);
          if (entry.isDirectory()) {
            if (depth >= 8) { truncated = true; continue; }
            try { await walk(file, depth + 1); } catch { errors.push(`${entry.name}: フォルダを読み込めません。`); }
          } else if (entry.isFile() && extensions.test(entry.name)) {
            try {
              const stat = await validatePath(file, root), info = await probe(file), duration = Number(info.format?.duration || info.streams?.find(s => s.codec_type === 'audio')?.duration);
              if (identity(file, await validatePath(file, root)) !== identity(file, stat)) throw new Error('音楽が変更されています。');
              if (!info.streams?.some(s => s.codec_type === 'audio') || info.streams.some(s => s.codec_type === 'video' && !s.disposition?.attached_pic) || !Number.isFinite(duration) || duration <= 0) throw new Error('読み込める音楽がありません。');
              const id = identity(file,stat);
              next.set(id, {file,root}); tracks.push({ id, name: entry.name, relativePath: path.relative(root,file), duration });
            } catch { errors.push(`${path.relative(root,file)}: 音楽を読み込めません。`); }
          }
        }
      }
      await walk(root, 0);
      if (selectedFolder !== undefined) { await fs.mkdir(path.dirname(configFile), { recursive: true }); await atomicWrite(configFile, JSON.stringify({ folder: root })); }
      folder = root; known = next;
      return { folder: root, tracks, errors, truncated };
    } catch (error) { throw new Error('BGMフォルダを読み込めません。フォルダを選び直してください。' + (error.code === 'ENOENT' ? ' フォルダが見つかりません。' : '')); }
  }
  async function load(id) {
    if (typeof id !== 'string' || !known.has(id)) throw new Error('曲を選び直すか、BGM一覧を更新してください。');
    const entry = known.get(id);
    const revalidate = async () => {
      try {
        const stat = await validatePath(entry.file, entry.root);
        if (known.get(id) !== entry || identity(entry.file,stat) !== id) throw Error();
      } catch { throw new Error('曲が変更または移動されています。BGM一覧を更新して選び直してください。'); }
    };
    if (!loading.has(id)) loading.set(id, (async () => {
      await revalidate();
      const asset = await inspect(entry.file);
      if (asset.kind !== 'audio') throw new Error('音楽ファイルを選んでください。');
      await revalidate();
      if (asset.id !== id || !samePath(asset.path,entry.file)) throw new Error('曲が変更されています。BGM一覧を更新してください。');
      return present(asset);
    })());
    const promise = loading.get(id);
    try { return await promise; } finally { if (loading.get(id) === promise) loading.delete(id); }
  }
  return { list, load };
}
module.exports = { createBgmLibrary };
