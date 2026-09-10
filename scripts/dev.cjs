const { spawn } = require('node:child_process');
const path = require('node:path');
const root = path.join(__dirname, '..');
const vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'], { cwd: root, stdio: 'inherit', windowsHide: true });
let desktop;
async function launch() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch('http://127.0.0.1:5173')).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  const env = { ...process.env, LUMA_DEV_URL: 'http://127.0.0.1:5173' };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = spawn(require('electron'), ['.'], { cwd: root, env, stdio: 'inherit', windowsHide: true });
  desktop.on('exit', () => { vite.kill(); process.exit(); });
}
process.on('SIGINT', () => { desktop?.kill(); vite.kill(); process.exit(); });
launch();
