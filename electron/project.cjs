const path = require('node:path');
const { validateProject } = require('./export.cjs');

const MAX_PROJECT_BYTES = 15 * 1024 * 1024;
function serializeProject(p) {
  validateProject(p);
  const contents = JSON.stringify({ ...p, assets: p.assets.map(({ url, thumbnail, offline, playbackPath, thumbnailPath, ...a }) => a) }, null, 2);
  if (Buffer.byteLength(contents, 'utf8') > MAX_PROJECT_BYTES) throw new Error('プロジェクトファイルが大きすぎます。15 MiB以内にしてください。');
  return contents;
}

function parseProjectJson(text) {
  try { return JSON.parse(text); }
  catch (error) {
    if (error instanceof SyntaxError) throw new Error('プロジェクトのJSONが不正です。ファイルが途中で切れているか、保存内容が破損しています。');
    throw error;
  }
}

function assertReplacement(saved, fresh) {
  if (fresh.kind !== saved.kind || fresh.duration < saved.duration) {
    throw new Error('同じ種類で、元の素材以上の長さのファイルを選んでください。');
  }
  if (saved.hasAudio && !fresh.hasAudio) throw new Error('元の素材には音声があります。音声を含むファイルを選んでください。');
}

function isLocalProjectPath(file, platform = process.platform) {
  // Windows treats /Users/... as current-drive rooted; persisted POSIX paths
  // must instead remain offline until the user explicitly relinks them.
  if (platform === 'win32') return /^[a-z]:[\\/]/i.test(file) || /^\\\\[^\\]+\\[^\\]+/.test(file);
  return path.posix.isAbsolute(file);
}

async function hydrateProject(project, inspect, present) {
  validateProject(project, { allowForeignPaths: true });
  const assets = [];
  for (const saved of project.assets) {
    try {
      if (!isLocalProjectPath(saved.path)) throw new Error('別のOSの素材は再リンクしてください。');
      const fresh = await inspect(saved.path);
      assertReplacement(saved, fresh);
      const candidate = { ...fresh, id: saved.id, name: saved.name, revision: fresh.id };
      // Validate refreshed metadata and every source interval before exposing it.
      validateProject({ ...project, transitions: [], assets: [candidate], clips: project.clips.filter(c => c.assetId === saved.id) });
      assets.push(present(candidate));
    } catch {
      // Keep the saved edit and metadata so the user can relink a replaced file.
      assets.push({ ...saved, offline: true, url: '', thumbnail: '' });
    }
  }
  return validateProject({ ...project, assets });
}

module.exports = { MAX_PROJECT_BYTES, serializeProject, parseProjectJson, assertReplacement, hydrateProject, isLocalProjectPath };
