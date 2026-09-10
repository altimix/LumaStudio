const path = require('node:path');
const { validateProject } = require('./export.cjs');

function assertReplacement(saved, fresh) {
  if (fresh.kind !== saved.kind || fresh.duration < saved.duration) {
    throw new Error('同じ種類で、元の素材以上の長さのファイルを選んでください。');
  }
  if (saved.hasAudio && !fresh.hasAudio) throw new Error('元の素材には音声があります。音声を含むファイルを選んでください。');
}

async function hydrateProject(project, inspect, present) {
  validateProject(project, { allowForeignPaths: true });
  const assets = [];
  for (const saved of project.assets) {
    try {
      if (!path.isAbsolute(saved.path)) throw new Error('別のOSの素材は再リンクしてください。');
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

module.exports = { assertReplacement, hydrateProject };
