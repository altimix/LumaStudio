const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { assertDestination } = require('./persistence.cjs');
const { validateProject } = require('./export.cjs');
const { totalTime, buildMp3Audio, runAudio } = require('./timeline-audio.cjs');

async function exportMp3(p, output, { audioPaths = {}, signal, onProgress = () => {} } = {}) {
  validateProject(p);
  if (signal?.aborted) throw new Error('書き出しをキャンセルしました。');
  await assertDestination(output, '.mp3', p.assets.map(asset => asset.path));
  const partial = path.join(path.dirname(output), `.luma-${randomUUID()}.mp3`);
  const args = buildMp3Audio(p, partial, audioPaths);
  const duration = totalTime(p);
  try {
    onProgress({ status: 'rendering', progress: 0, output });
    await runAudio(args, signal, {
      duration,
      onProgress: progress => onProgress({ status: 'rendering', progress, output }),
      cancelMessage: '書き出しをキャンセルしました。',
      failureMessage: 'MP3を書き出せませんでした',
    });
    if (signal?.aborted) throw new Error('書き出しをキャンセルしました。');
    await fs.rename(partial, output);
    onProgress({ status: 'complete', progress: 1, output });
    return output;
  } catch (error) {
    if (signal?.aborted) throw new Error('書き出しをキャンセルしました。');
    throw error;
  } finally { await fs.rm(partial, { force: true }).catch(() => {}); }
}

module.exports = { exportMp3 };
