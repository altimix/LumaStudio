const { spawn } = require('node:child_process');
const path = require('node:path');
const { packageTarget, assertMachArchitecture } = require('./platform.cjs');

require('./check-media.cjs');
const target = packageTarget();
const root=path.join(__dirname,'..');
const fs=require('node:fs');
if (process.platform === 'darwin') {
  const { ffmpeg, ffprobe } = require('../electron/media.cjs');
  for (const binary of [ffmpeg, ffprobe]) {
    const fd = fs.openSync(binary, 'r'), header = Buffer.alloc(8);
    try { fs.readSync(fd, header, 0, 8, 0); assertMachArchitecture(header, process.arch); }
    finally { fs.closeSync(fd); }
  }
}
async function packageApp() {
await require('./prepare-bgm.cjs').prepareBgm();
const child=spawn(process.execPath,[path.join(root,'node_modules','electron-builder','cli.js'),...target,'--publish','never','--config',path.join(__dirname,'electron-builder.cjs')],{
  cwd:root,stdio:'inherit',windowsHide:true,
  env:{...process.env,ELECTRON_BUILDER_COMPRESSION_LEVEL:process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL||'9'}
});
await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`パッケージ作成に失敗しました (${code})`)));
});
if (process.platform === 'darwin') require('./verify-macos-signature.cjs').verifyMacArchive(root);

}
packageApp().catch(error => { console.error(error); process.exitCode = 1; });
