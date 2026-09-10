const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ffmpeg, run } = require('./media.cjs');

async function blackVideo(directory, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 128 || width > 7680 || height < 128 || height > 4320 || width%2 || height%2) throw Error('ブラックビデオの画面サイズが不正です。');
  const folder = path.join(directory, randomUUID());
  await fs.mkdir(folder, { recursive: true });
  const file = path.join(folder, 'ブラックビデオ.png');
  try {
    await run(ffmpeg, ['-v','error','-f','lavfi','-i',`color=c=black:s=${width}x${height},format=rgb24`,'-frames:v','1','-update','1',file]);
    return file;
  } catch(error) { await fs.rm(file,{force:true}).catch(()=>{}); await fs.rmdir(folder).catch(()=>{}); throw error; }
}
module.exports = { blackVideo };
