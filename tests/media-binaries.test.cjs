const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { stageMediaBinaries } = require('../electron/media-binaries.cjs');

test('portable media tools survive removal of the extraction directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-portable-media-'));
  try {
    const source = path.join(root, 'extracted', 'vendor', 'media', 'win32-x64');
    const userData = path.join(root, 'user-data');
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(path.join(source, 'ffmpeg.exe'), 'ffmpeg-version-one');
    await fs.writeFile(path.join(source, 'ffprobe.exe'), 'ffprobe-version-one');
    const first = stageMediaBinaries(source, userData, '1.10.2', 'win32');
    assert.equal(await fs.readFile(first.ffmpeg, 'utf8'), 'ffmpeg-version-one');
    assert.equal(await fs.readFile(first.ffprobe, 'utf8'), 'ffprobe-version-one');
    await fs.rm(path.join(root, 'extracted'), { recursive: true });
    assert.equal(await fs.readFile(first.ffmpeg, 'utf8'), 'ffmpeg-version-one');
    assert.equal(await fs.readFile(first.ffprobe, 'utf8'), 'ffprobe-version-one');
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(path.join(source, 'ffmpeg.exe'), 'ffmpeg-version-two');
    await fs.writeFile(path.join(source, 'ffprobe.exe'), 'ffprobe-version-one');
    const second = stageMediaBinaries(source, userData, '1.10.2', 'win32');
    assert.notEqual(second.ffmpeg, first.ffmpeg, 'updated tools use their own immutable location');
    assert.equal(await fs.readFile(first.ffmpeg, 'utf8'), 'ffmpeg-version-one');
    assert.equal(await fs.readFile(second.ffmpeg, 'utf8'), 'ffmpeg-version-two');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
