const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { assertReplacement, hydrateProject } = require('../electron/project.cjs');
const { validateProject } = require('../electron/export.cjs');

function fixture() {
  const asset = { id: 'saved', name: 'clip.mp4', path: path.resolve('clip.mp4'), kind: 'video', duration: 8, width: 1280, height: 720, fps: 30, hasAudio: true, waveform: [], size: 1, codec: 'h264' };
  return { version: 1, id: 'p', name: 'Saved project', width: 1280, height: 720, fps: 30, assets: [asset], tracks: [{ id: 'track', kind: 'video' }], markers: [], clips: [{ id: 'clip', assetId: 'saved', trackId: 'track', name: 'clip', kind: 'video', start: 0, in: 2, duration: 3, speed: 2, scale: 1, x: 0, y: 0, rotation: 0, opacity: 1, volume: 1, exposure: 0, contrast: 1, saturation: 1, fadeIn: 0, fadeOut: 0 }] };
}

for (const [label, patch] of [['different kind', { kind: 'audio' }], ['shorter source', { duration: 4 }], ['invalid refreshed metadata', { waveform: null }]]) {
  test(`opening a ${label} replacement preserves a valid, relinkable offline edit`, async () => {
    const p = fixture(); let registered = false;
    const result = await hydrateProject(p, async () => ({ ...p.assets[0], ...patch }), a => { registered = true; return a; });
    assert.equal(registered, false);
    assert.equal(result.assets[0].offline, true);
    assert.equal(result.assets[0].duration, 8);
    assert.deepEqual(result.clips, p.clips);
    assert.equal(validateProject(result), result);
  });
}
test('a valid replacement refreshes metadata while retaining persisted asset references', async () => {
  const p = fixture();p.assets[0].name='日本語の表示名';
  const result = await hydrateProject(p, async () => ({ ...p.assets[0], id: 'fresh', name:'internal-file.mp4', width: 1920, duration: 10 }), a => ({ ...a, url: 'media://local/asset/saved' }));
  assert.equal(result.assets[0].id, 'saved'); assert.equal(result.assets[0].revision, 'fresh');
  assert.equal(result.assets[0].name,'日本語の表示名');assert.equal(result.assets[0].path,p.assets[0].path);
  assert.equal(result.assets[0].width, 1920); assert.equal(result.assets[0].offline, undefined);
  assert.equal(validateProject(result), result);
});

test('relink does not shorten a source even within the old duration tolerance', () => {
  const saved = fixture().assets[0];
  assert.throws(() => assertReplacement(saved, { ...saved, duration: 7.98 }), /元の素材以上/);
  assert.doesNotThrow(() => assertReplacement(saved, { ...saved }));
});
test('a silent replacement cannot invalidate an audio-treated project or discard its soundtrack', async () => {
  const p = fixture(); p.clips[0].audioTreatment = 'speech';
  const replacement = { ...p.assets[0], hasAudio:false };
  assert.throws(() => assertReplacement(p.assets[0],replacement), /音声を含む/);
  const result = await hydrateProject(p,async()=>replacement,()=>{throw Error('Must not expose silent replacement');});
  assert.equal(result.assets[0].offline,true); assert.equal(result.assets[0].hasAudio,true);
  assert.equal(result.clips[0].audioTreatment,'speech'); assert.equal(validateProject(result),result);
});

test('hydration validates cross-asset transitions only on the complete project',async()=>{
  for(const missing of [false,true]){const p=fixture();p.assets.push({...p.assets[0],id:'second',path:path.resolve('second.mp4')});p.clips.push({...p.clips[0],id:'second-clip',assetId:'second',start:2});p.transitions=[{id:'transition',fromId:'clip',toId:'second-clip',video:'pagePeel',audio:'constantPower'}];
    const result=await hydrateProject(p,async file=>{const asset=p.assets.find(a=>a.path===file);if(missing&&asset.id==='second')throw Error('missing');return {...asset,id:asset.id+'-refreshed'};},a=>({...a,url:'media://local/asset/'+a.id}));
    assert.equal(result.assets[0].offline,undefined);assert.equal(!!result.assets[1].offline,missing);assert.deepEqual(result.transitions,p.transitions);assert.equal(validateProject(result),result);
  }
});


test('malformed track flags and names are rejected before reading media', async () => {
  for (const field of ['muted', 'hidden', 'locked', 'solo']) {
    for (const value of ['false', 'true', 0, 1, null, {}, []]) {
      const p = fixture(); p.tracks[0][field] = value;
      let inspected = false;
      await assert.rejects(hydrateProject(p, async () => { inspected = true; return p.assets[0]; }, a => a), /トラック/);
      assert.equal(inspected, false);
    }
  }
  for (const value of [null, 12, {}, []]) {
    const p = fixture(); p.tracks[0].name = value;
    assert.throws(() => validateProject(p), /トラック名/);
  }
  assert.doesNotThrow(() => validateProject(fixture()), 'legacy omitted flags remain supported');
  const p = fixture(); Object.assign(p.tracks[0], { name: '日本語トラック', muted: false, hidden: false, locked: true, solo: false });
  assert.equal(validateProject(p), p);
});

test('Windows media paths hydrate offline on macOS without filesystem access', { skip: process.platform === 'win32' }, async () => {
  for (const file of [String.raw`C:\Users\me\日本語 clip.mp4`, String.raw`\\server\share\clip.mp4`]) {
    const p = fixture(); p.assets[0].path = file;
    assert.throws(() => validateProject(p), /絶対パス/);
    let inspected = false; let registered = false;
    const result = await hydrateProject(p, () => { inspected = true; throw new Error('missing'); }, a => { registered = true; return a; });
    assert.equal(inspected, false); assert.equal(registered, false);
    assert.equal(result.assets[0].offline, true);
    assert.equal(result.assets[0].path, file);
    assert.deepEqual(result.clips, p.clips);
    assert.equal(validateProject(result), result);
  }
});

test('invalid or duplicate marker IDs are rejected before hydration', async () => {
  for (const id of [undefined, null, 1, '', '  ']) {
    const p = fixture(); p.markers = [{ id, time: 1, label: 'marker' }];
    assert.throws(() => validateProject(p), /マーカーが不正/);
  }
  const p = fixture(); p.markers = [{ id: 'same', time: 1, label: 'A' }, { id: 'same', time: 2, label: 'B' }];
  let inspected = false;
  await assert.rejects(hydrateProject(p, () => { inspected = true; }, a => a), /マーカーが不正/);
  assert.equal(inspected, false);
  p.markers[1].id = 'other'; assert.equal(validateProject(p), p);
});
