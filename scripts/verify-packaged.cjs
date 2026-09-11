const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { packagedExecutable } = require('./platform.cjs');
const root = path.join(__dirname, '..');
// Verify the meter, monitor gestures and transition playback first, retaining every existing suite.
const suites = [...(process.platform === 'darwin' ? ['verify-macos.cjs'] : []), 'verify-help.cjs', 'verify-clean-start.cjs', 'verify-project-operations.cjs', 'verify-black-video.cjs', 'verify-startup-project.cjs', 'verify-audio-meter.cjs', 'verify-preview-transform.cjs', 'verify-transitions.cjs', 'verify-selection.cjs', 'verify-gap-ripple.cjs', 'verify-volume-automation.cjs', 'verify-bgm.cjs', 'verify-desktop.cjs', 'verify-recovery.cjs', 'verify-file-safety.cjs', 'verify-save-on-exit.cjs', 'verify-keyframes.cjs', 'verify-shortcuts.cjs', 'verify-timeline-follow.cjs', 'verify-playhead-navigation.cjs', 'verify-media-library.cjs', 'verify-audio.cjs', 'verify-normalization.cjs', 'verify-youtube.cjs', 'verify-text.cjs', 'verify-inline-text.cjs', 'verify-gpu.cjs', 'verify-beginners.cjs', 'verify-rate.cjs', 'verify-drawing.cjs', 'verify-linked-av.cjs'];
const start = process.argv[2] ? suites.indexOf(process.argv[2]) : 0;
if (start < 0) throw new Error('不明な検証スクリプトです。');
for (const script of suites.slice(start)) {
  const result = spawnSync(process.execPath, [path.join(__dirname, script)], {
    cwd: root, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, LUMA_DEMO_FIXTURE: script === 'verify-clean-start.cjs' ? '0' : '1', LUMA_TEST_FIXTURES: path.join(root, 'public', 'demo'), LUMA_VERIFY_EXE: packagedExecutable(root) },
  });
  if (result.error) console.error(result.error);
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
