const path = require('node:path');
function createMediaImporter(inspect, present, progress) {
  let controller;
  return {
    get busy() { return !!controller; },
    cancel() { controller?.abort(); },
    async run(paths, options = {}) {
      if (controller) throw new Error('前の素材を読み込み中です。');
      if (!Array.isArray(paths) || paths.length > 100 || paths.some(file => typeof file !== 'string' || !path.isAbsolute(file))) throw new Error('読み込み先が不正です。');
      controller = new AbortController(); const current = controller;
      const assets = [], errors = [];
      try {
        for (const [i, file] of paths.entries()) {
          if (current.signal.aborted) break;
          const report = stage => progress({ index: i + 1, total: paths.length, completed: i, name: path.basename(file), stage });
          try {
            report('素材を解析しています');
            const asset = await inspect(file, { ...options, signal: current.signal, onStage: report });
            current.signal.throwIfAborted(); assets.push(present(asset));
          } catch (error) {
            if (current.signal.aborted) break;
            errors.push(`${path.basename(file)}: ${String(error.message || error).slice(-350)}`);
          }
        }
        return { assets, errors, cancelled: current.signal.aborted };
      } finally { if (controller === current) controller = undefined; }
    },
  };
}
module.exports = { createMediaImporter };
