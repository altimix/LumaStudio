const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { ffmpeg, run, inspectMedia } = require('../electron/media.cjs');
const { volumeAt } = require('../shared/volume-automation.mjs');
const root = path.join(__dirname, '..');
async function verify() {
  const results = path.join(root, 'test-results'); await fs.mkdir(results, { recursive: true }); await fs.mkdir(path.join(root, '.local'), { recursive: true });
  const profile = await fs.mkdtemp(path.join(root, '.local', 'volume-profile-')), source = path.join(profile, '声と音楽.wav');
  await run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=72', '-ac', '2', '-c:a', 'pcm_s16le', source]);
  const asset = await inspectMedia(source, path.join(profile, 'media-cache'));
  const musicFile = path.join(profile, '細かな発音と音楽.wav');
  await run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', "aevalsrc=exprs='0.5*sin(2*PI*1000*t)*pow(max(0,sin(2*PI*2.3*t)),3)':s=48000:d=72", '-ac', '2', '-c:a', 'pcm_s16le', musicFile]);
  const music = await inspectMedia(musicFile, path.join(profile, 'media-cache'));
  const base = { id: 'voice', assetId: asset.id, trackId: 'voice', kind: 'audio', name: 'メイン音声', start: 0, in: 0, duration: 6, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, exposure: 0, contrast: 1, saturation: 1, text: '', fontSize: 94, color: '#ffffff', textStyle: 'hero' };
  const tracks = ['メイン音声', 'ミュージック', 'ナレーション'].map((name, i) => ({ id: ['voice', 'music', 'narration'][i], kind: 'audio', name, muted: i > 0, hidden: false, locked: false, solo: false }));
  const project = { version: 1, id: 'volume-edit', name: '音量と波形の検証', width: 320, height: 180, fps: 30, assets: [asset,music], clips: tracks.map((t, i) => ({ ...base, id: t.id, assetId: i ? music.id : asset.id, trackId: t.id, name: t.name, duration: i ? 72 : 6 })), tracks, markers: [] };
  const file = path.join(results, '音量と波形.luma'); await fs.writeFile(file, JSON.stringify(project));
  const env = { ...process.env, LUMA_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.LUMA_VERIFY_EXE, app = await electron.launch({ executablePath, args: executablePath ? [] : [root], env, timeout: 60000 });
  const page = await app.firstWindow(), checks = [], errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 60000 }); await page.locator('.media-card').first().waitFor({ timeout: 60000 });
    await app.evaluate(({ dialog, BrowserWindow }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); BrowserWindow.getAllWindows()[0].setSize(1600, 1000); }, file);
    await page.keyboard.press('Control+o'); await page.locator('[data-clip-id="voice"]').waitFor();
    // CI can launch at a smaller initial desktop size. Make both edited rows visible.
    const divider=await page.getByRole('separator',{name:'タイムラインの高さを変更'}).boundingBox(),panel=await page.locator('.timeline-container').boundingBox();
    await page.mouse.move(divider.x+divider.width/2,divider.y+divider.height/2);await page.mouse.down();await page.mouse.move(divider.x+divider.width/2,divider.y+divider.height/2+panel.height-340);await page.mouse.up();
    const clip = id => page.locator(`[data-clip-id="${id}"]`), nodes = () => clip('voice').locator('.volume-node');
    const save = async () => {
      const before=(await fs.stat(file)).mtimeMs;
      await page.getByRole('button', { name: 'プロジェクトを保存 (Ctrl+S)', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('.unsaved-dot'));
      const deadline=Date.now()+10000;while((await fs.stat(file)).mtimeMs===before){assert.ok(Date.now()<deadline);await new Promise(r=>setTimeout(r,20));}
      return JSON.parse(await fs.readFile(file, 'utf8'));
    };
    const keys = async () => (await save()).clips.find(c => c.id === 'voice').volumeKeyframes;
    const zoom = async value => { await page.getByRole('slider', { name: 'タイムラインのズーム', exact: true }).evaluate((el, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, String(value)); };
    await zoom(140); await clip('voice').click({ position: { x: 25, y: 10 } });
    await fs.writeFile(file,JSON.stringify({...project,name:'短い素材の座標検証',clips:project.clips.map(c=>c.id==='voice'?{...c,duration:10/30}:c)}));
    await page.keyboard.press('Control+o');await page.getByText('短い素材の座標検証',{exact:true}).first().waitFor();await zoom(8);
    const shortBox=await clip('voice').locator('.clip-volume-line').boundingBox();
    assert.ok(shortBox.width<6,'fixture uses the minimum-width clip');
    await page.keyboard.down('ControlOrMeta');await page.mouse.click(shortBox.x+shortBox.width/2,shortBox.y+8+.75*(shortBox.height-16));await page.keyboard.up('ControlOrMeta');
    assert.ok(Math.abs((await keys())[1].time-5/30)<1e-9,'minimum-width clip midpoint adds at the middle frame');
    const shortNode=await clip('voice').locator('.volume-node.active').boundingBox();
    await page.mouse.move(shortNode.x+shortNode.width/2,shortNode.y+shortNode.height/2);await page.mouse.down();
    await page.mouse.move(shortNode.x+shortNode.width/2+1,shortNode.y+shortNode.height/2-4,{steps:4});await page.mouse.up();
    const shortMoved=(await keys())[1].time;
    const expectedShort=Math.min(10/30-1e-7,Math.round((5/30+(10/30)/shortBox.width)*30)/30);
    assert.ok(Math.abs(shortMoved-expectedShort)<1e-8,'short clip drag uses its rendered seconds-per-pixel scale');
    checks.push('minimum-width clip creation and dragging map rendered pixels to exact frame times');
    await fs.writeFile(file,JSON.stringify(project));await page.keyboard.press('Control+o');await page.getByText(project.name,{exact:true}).first().waitFor();await zoom(140);await clip('voice').click({position:{x:25,y:10}});
    const fullCurve=Array.from({length:64},(_,i)=>({time:(i+1)/12,value:.5}));
    await fs.writeFile(file,JSON.stringify({...project,name:'64ポイントの検証',clips:project.clips.map(c=>c.id==='voice'?{...c,volumeKeyframes:fullCurve}:c)}));
    await page.keyboard.press('Control+o');await page.getByText('64ポイントの検証',{exact:true}).first().waitFor();await clip('voice').click({position:{x:25,y:10}});
    assert.equal(await nodes().count(),66,'virtual boundary handles do not consume the 64 stored-point limit');
    const nearby=await nodes().nth(20).boundingBox();
    await page.mouse.click(nearby.x+nearby.width/2+2,nearby.y+nearby.height/2);
    assert.equal(await clip('voice').locator('.volume-node.active').getAttribute('data-volume-index'),'20','overlapping targets select the nearest point, not the last painted point');
    await nodes().nth(20).focus();await page.keyboard.press('ArrowUp');
    assert.equal(await nodes().nth(20).getAttribute('aria-valuenow'),'51');assert.equal((await keys()).length,64);
    await nodes().first().focus();await page.keyboard.press('ArrowUp');
    assert.equal((await keys()).length,64,'adding a missing boundary at the limit is safely rejected');assert.equal(errors.length,0);
    await fs.writeFile(file,JSON.stringify(project));await page.keyboard.press('Control+o');await page.getByText(project.name,{exact:true}).first().waitFor();await clip('voice').click({position:{x:25,y:10}});
    assert.equal(await nodes().count(),2,'unkeyed clips expose both endpoint handles');
    for(const side of ['first','last']){
      const handle=await nodes()[side]().boundingBox(),bounds=await clip('voice').boundingBox();
      const center=handle.x+handle.width/2, edge=side==='first'?bounds.x:bounds.x+bounds.width;
      assert.ok(Math.abs(center-edge)<2,'endpoint center matches the clip boundary');
      assert.ok(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.classList.contains('volume-node'),{x:center,y:handle.y+handle.height/2}),'the exact endpoint center receives gain gestures through the clip border');
      assert.ok(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.classList.contains('trim-handle'),{x:side==='first'?bounds.x+3:bounds.x+bounds.width-3,y:bounds.y+8}),'title band preserves trimming');
      assert.ok(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.classList.contains('volume-node'),{x:center+(side==='first'?12:-12),y:handle.y+handle.height/2}),'transparent target is grabbable beyond the visible radius');
    }

    const boundary=await nodes().first().boundingBox();
    await page.mouse.move(boundary.x+boundary.width/2+12,boundary.y+boundary.height/2);
    await page.mouse.down();await page.mouse.move(boundary.x+boundary.width/2+12,boundary.y+boundary.height/2-4,{steps:4});await page.mouse.up();
    const boundaryEdit=await save();
    assert.equal(boundaryEdit.clips[0].volumeKeyframes[0].time,0,'dragging the invisible endpoint target retains exact time zero');
    assert.ok(boundaryEdit.clips[0].volumeKeyframes[0].value>1);
    assert.equal(boundaryEdit.clips[0].duration,6,'endpoint gain drag does not trim the clip');
    await clip('voice').focus();await page.keyboard.press('Control+z');
    assert.ok(!(await save()).clips[0].volumeKeyframes?.length);
    checks.push('exact boundary positions, wide invisible targets, nearest-point selection, independent trim band and endpoint drag/Undo');

    await clip('voice').focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');
    await page.locator('.inspector-tabs').getByRole('button',{name:'オーディオ',exact:true}).click();
    const addAtHead=page.getByRole('button',{name:'再生ヘッドに音量ポイントを追加',exact:true});
    await addAtHead.click();
    await page.waitForFunction(()=>document.activeElement?.classList.contains('volume-node'));
    assert.equal(await nodes().count(),3);
    assert.equal(await clip('voice').locator('.volume-node.active').getAttribute('data-volume-index'),'1');
    assert.ok(Math.abs((await keys())[1].time-1/30)<1e-9,'inspector adds at exact rounded frame time');
    await clip('voice').locator('.volume-node.active').focus();await page.keyboard.press('ArrowUp');
    await page.waitForFunction(()=>document.querySelector('#prop-volume')?.value==='101');
    assert.equal(Number(await page.locator('#prop-volume').inputValue()),101,'newly active point synchronizes the inspector');
    await addAtHead.click();await page.waitForFunction(()=>document.activeElement?.classList.contains('volume-node'));
    assert.equal(await nodes().count(),3,'existing point is selected without duplication');
    assert.equal(await clip('voice').locator('.volume-node.active').getAttribute('data-volume-index'),'1');
    for(let i=0;i<2;i++){await clip('voice').focus();await page.keyboard.press('Control+z');}
    assert.ok(!(await save()).clips[0].volumeKeyframes?.length,'duplicate selection adds no undo step');
    await clip('voice').focus();await page.keyboard.press('Home');
    checks.push('inspector add activates and focuses the frame-accurate point, arrows work immediately, gain stays synchronized, duplicate add selects without history');

    await nodes().first().focus();await page.locator('.inspector-tabs').getByRole('button',{name:'オーディオ',exact:true}).click();
    await page.locator('#prop-volume').fill('50');await page.locator('#prop-volume').press('Enter');
    assert.equal(await nodes().first().getAttribute('aria-valuenow'),'50');assert.equal(await nodes().last().getAttribute('aria-valuenow'),'100','editing a synthetic endpoint preserves the opposite end');
    await clip('voice').focus();await page.keyboard.press('Control+z');assert.ok(!(await save()).clips[0].volumeKeyframes?.length);
    await nodes().first().focus();await page.keyboard.press('ArrowUp');
    await page.locator('.inspector-tabs').getByRole('button',{name:'オーディオ',exact:true}).click();
    assert.equal(Number(await page.locator('#prop-volume').inputValue()),101,'inspector follows selected endpoint gain');
    await page.locator('#prop-volume').fill('50');await page.locator('#prop-volume').press('Enter');
    assert.equal(await nodes().first().getAttribute('aria-valuenow'),'50','endpoint follows inspector gain');
    await nodes().first().focus();await page.keyboard.press('Shift+ArrowRight');
    assert.ok(Math.abs((await keys())[0].time-10/30)<1e-8,'Shift/right moves a selected endpoint by ten frames');
    await clip('voice').locator('.volume-node.active').focus();await page.keyboard.press('ArrowRight');
    assert.ok((await keys()).some(key=>Math.abs(key.time-11/30)<1e-8),'right continues moving the active point after a boundary handle is inserted');
    // Restore the baseline through Undo, retaining the existing playback/export checks.
    for(let i=0;i<4;i++){await clip('voice').focus();await page.keyboard.press('Control+z');}
    assert.ok(!(await save()).clips[0].volumeKeyframes?.length);
    await nodes().first().focus();await page.keyboard.press('ArrowUp');
    await nodes().first().focus();await page.keyboard.press('Delete');
    assert.equal(await nodes().count(),2,'deleting a stored boundary retains a selectable virtual handle');
    await nodes().first().focus();await page.keyboard.press('ArrowUp');
    assert.equal((await keys())[0].time,0,'editing the missing endpoint materializes it');
    assert.equal(await nodes().first().getAttribute('aria-valuenow'),'101');
    for(let i=0;i<3;i++){await clip('voice').focus();await page.keyboard.press('Control+z');}
    assert.ok(!(await save()).clips[0].volumeKeyframes?.length);
    // Select through the actual volume hit area, not a title coordinate that can
    // happen to miss it at a different Windows DPI or compact row height.
    const line = async id => { await clip(id).scrollIntoViewIfNeeded(); const box = await clip(id).locator('.clip-volume-line').boundingBox(); return { x: box.x + 40, y: box.y + 8 + .75 * (box.height-16) }; };
    for (const size of [[1600,1000],[1100,760]]) {
      await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setSize(...size),size);
      await clip('voice').click({position:{x:25,y:10}});
      const target = await line('music');
      assert.ok(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.classList.contains('volume-line-hit'),target));
      await page.keyboard.down('Shift'); await page.mouse.click(target.x,target.y); await page.keyboard.up('Shift');
      assert.deepEqual(await page.locator('.timeline-clip.selected').evaluateAll(nodes=>nodes.map(n=>n.dataset.clipId).sort()),['music','voice']);
      await page.mouse.click(target.x,target.y,{button:'right'}); await page.locator('[data-action="bgm-volume-20"]').click();
      const grouped=await save(); assert.equal(grouped.clips.find(c=>c.id==='voice').volume,.1); assert.equal(grouped.clips.find(c=>c.id==='music').volume,.1); assert.equal(grouped.clips.find(c=>c.id==='narration').volume,1);
      await clip('voice').focus(); await page.keyboard.press('Control+z'); assert.ok((await save()).clips.every(c=>c.volume===1&&!c.volumeKeyframes?.length));
      await page.keyboard.down('Shift'); await page.mouse.click(target.x,target.y); await page.keyboard.up('Shift');
      assert.deepEqual(await page.locator('.timeline-clip.selected').evaluateAll(nodes=>nodes.map(n=>n.dataset.clipId)),['voice']);
    }
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1600,1000));
    checks.push('Shift-click through volume lines preserves multi-selection and toggle selection at both window sizes; grouped BGM changes and Undo preserve all curves');
    const add = async (time, double = false) => { const box = await clip('voice').locator('.clip-volume-line').boundingBox(); if (double) await page.mouse.dblclick(box.x + time * 140, box.y + 8 + .75 * (box.height-16)); else { await page.keyboard.down('ControlOrMeta'); await page.mouse.click(box.x + time * 140, box.y + 8 + .75 * (box.height-16)); await page.keyboard.up('ControlOrMeta'); } };
    await add(1, true); await add(2); await add(4); await add(5); assert.equal(await nodes().count(), 6);
    assert.deepEqual((await keys()).map(k => k.time), [0, 1, 2, 4, 5, 6]); checks.push('double-click and Ctrl-click create timeline volume points with start/end anchors');
    const dragNode = async (index, dx, dy, cancel = false) => { const b = await nodes().nth(index).boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 5 }); if (cancel) await page.keyboard.press('Escape'); await page.mouse.up(); };
    await dragNode(2, 14, 10); let edited = await save(), curve = edited.clips[0].volumeKeyframes; assert.ok(Math.abs(curve[2].time - 2.1) < .001); assert.ok(curve[2].value < .3); assert.deepEqual({ ...edited.clips[0], volumeKeyframes: undefined }, { ...base, volumeKeyframes: undefined });
    await nodes().nth(2).focus(); await page.keyboard.press('Control+z'); assert.equal((await keys())[2].value, 1); await nodes().nth(2).focus(); await page.keyboard.press('Control+Shift+z'); assert.deepEqual(await keys(), curve);
    await dragNode(2, 20, -8, true); assert.deepEqual(await keys(), curve); checks.push('dragging points changes gain/time only, one Undo/Redo restores a gesture, and Escape cancels it');
    await nodes().nth(2).focus(); await page.keyboard.press('ArrowUp'); const fine = await keys(); assert.ok(Math.abs(fine[2].value - curve[2].value - .01) < 1e-8); await nodes().nth(2).focus(); await page.keyboard.press('Delete'); assert.equal(await nodes().count(), 5); assert.equal((await save()).clips.length, 3); await clip('voice').focus(); await page.keyboard.press('Control+z'); assert.deepEqual(await keys(), fine);
    const edge = await clip('voice').locator('.clip-volume-line').boundingBox(), edgeTime = 3, edgeGain = volumeAt(fine, edgeTime), edgeY = edge.y + 8 + (1 - edgeGain / 4) * (edge.height-16);
    await page.mouse.move(edge.x + edgeTime * 140, edgeY); await page.mouse.down(); await page.mouse.move(edge.x + edgeTime * 140, edgeY - 4, { steps: 5 }); await page.mouse.up(); const shifted = await keys(); assert.ok(shifted[2].value > fine[2].value); assert.ok(Math.abs((shifted[3].value - shifted[2].value) - (fine[3].value - fine[2].value)) < 1e-8); await clip('voice').focus(); await page.keyboard.press('Control+z'); assert.deepEqual(await keys(), fine);
    assert.equal(await clip('voice').locator('.volume-node.active').count(),0,'dragging the whole segment clears the previous point selection');
    checks.push('arrow keys fine-adjust gain, Delete removes a focused point only, point selection persists on blur, and edge dragging preserves the slope and supports Undo');
    await page.getByRole('button', { name: 'メイン音声 ロック', exact: true }).click(); await dragNode(2, 0, -8); assert.deepEqual(await keys(), fine); await page.getByRole('button', { name: 'メイン音声 ロック解除', exact: true }).click();
    await clip('voice').click({ button: 'right', position: { x: 25, y: 10 } }); await page.locator('[data-action="bgm-volume-20"]').click(); assert.equal((await save()).clips[0].volume, .1); assert.deepEqual(await keys(), fine);
    await clip('voice').focus(); await page.keyboard.press('Control+z'); await save(); await page.keyboard.press('Control+o'); await page.waitForFunction(() => document.querySelector('button[aria-label="元に戻す (Ctrl+Z)"]')?.disabled); await clip('voice').click({ position: { x: 25, y: 10 } }); assert.deepEqual(await keys(), fine); checks.push('track locks protect points, BGM presets preserve the curve, and native save/reload preserves all keys');
    // Set a repeatable dip using the real keyboard controls for playback checks.
    await nodes().nth(2).focus(); for (let i = 0; i < 20; i++) await page.keyboard.press('Shift+ArrowDown'); for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowUp');
    await nodes().nth(3).focus(); for (let i = 0; i < 8; i++) await page.keyboard.press('Shift+ArrowDown');
    const persisted = await save();
    const level = async (frames, direction, presses = 1) => {
      await clip('voice').focus(); await page.keyboard.press('Home'); for (let n = 0; n < frames / 10; n++) await page.keyboard.press('Shift+ArrowRight');
      for (let n = 0; n < presses; n++) await page.keyboard.press(direction);
      await page.waitForFunction(() => Number.isFinite(parseFloat(document.querySelector('.meter-reading')?.textContent)), {}, { timeout: 10000 });
      const result = await page.evaluate(async () => { await new Promise(r => setTimeout(r, 200)); const values = []; for (let i = 0; i < 5; i++) { values.push(parseFloat(document.querySelector('.meter-reading').textContent)); await new Promise(r => setTimeout(r, 40)); } return values.filter(Number.isFinite).sort((a, b) => a - b); });
      await page.keyboard.press('k'); assert.ok(result.length > 2); return result[Math.floor(result.length / 2)];
    };
    const playback = { normal: await level(10, 'l'), quiet: await level(80, 'l'), resumed: await level(80, 'l'), reverse: await level(100, 'j'), fast: await level(70, 'l', 2) };
    for (const label of ['quiet', 'resumed', 'reverse', 'fast']) assert.ok(Math.abs(playback.normal - playback[label] - 20 * Math.log10(5)) < 2, JSON.stringify(playback));
    checks.push('actual forward, K/L resumed, reverse J and 2x L playback all follow the volume dip');
    await zoom(140); await page.waitForFunction(() => [...document.querySelectorAll('.detailed-waveform canvas')].length === 3 && [...document.querySelectorAll('.detailed-waveform canvas')].every(c => c.dataset.waveformDetail === 'ready'));
    const waveform = await page.locator('.detailed-waveform canvas').evaluateAll(nodes => nodes.map(c => ({ width: c.width, cssWidth: c.clientWidth, start: Number(c.dataset.sourceStart), end: Number(c.dataset.sourceEnd), pixels: c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some(v => v > 0) })));
    assert.ok(waveform.every(w => w.width > 600 && w.width <= 8192 && w.pixels));
    await page.screenshot({ path: path.join(results, 'audio-volume-waveforms.png') });
    await page.locator('.timeline-scroll').evaluate(el => { el.scrollLeft = 65 * 140; });
    await page.waitForFunction(() => [...document.querySelectorAll('.detailed-waveform canvas')].length === 2 && [...document.querySelectorAll('.detailed-waveform canvas')].every(c => Number(c.dataset.sourceStart) > 60 && c.dataset.waveformDetail === 'ready'));
    const tail = await page.locator('.detailed-waveform canvas').evaluateAll(nodes => nodes.map(c => ({ start: Number(c.dataset.sourceStart), end: Number(c.dataset.sourceEnd), width: c.width })));
    assert.ok(tail.every(w => w.start > 60 && w.width < 2500));
    await zoom(200); await page.locator('.timeline-scroll').evaluate(el=>{el.scrollLeft=65*200;}); await page.waitForFunction(() => [...document.querySelectorAll('.detailed-waveform canvas')].length===2 && [...document.querySelectorAll('.detailed-waveform canvas')].every(c => Number(c.dataset.sourceStart)>60 && c.dataset.waveformDetail === 'ready')); await page.screenshot({ path: path.join(results, 'audio-detailed-waveforms.png') });
    checks.push('main audio, music and narration render detailed pixel waveforms; long clips scroll past one minute and zoom without whole-clip canvases');
    assert.deepEqual((await save()).clips, persisted.clips);
    const output=path.join(results,'音量カーブの書き出し.mp4');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},output);
    await page.getByRole('button',{name:'書き出し',exact:true}).click();await page.getByLabel('品質',{exact:true}).selectOption('draft');await page.getByRole('button',{name:'保存先を選んで書き出す',exact:true}).click();await page.getByText('書き出しが完了しました',{exact:true}).waitFor({timeout:120000});
    const rms=async time=>{const data=await run(ffmpeg,['-v','error','-ss',String(time),'-t','0.2','-i',output,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1']);let sum=0;for(let i=0;i<data.length;i+=4)sum+=data.readFloatLE(i)**2;return Math.sqrt(sum/(data.length/4));};
    const exportRatio=(await rms(3))/(await rms(.4));assert.ok(Math.abs(exportRatio-.2)<.02);checks.push('native MP4 export applies the saved volume dip with the same timing and gain');assert.deepEqual(errors, []);
    await fs.writeFile(path.join(results, 'volume-automation-verification.json'), JSON.stringify({ passed: true, packaged: !!executablePath, checks, playback, waveform, tail, exportRatio }, null, 2));
    console.log('Audio volume and detailed waveforms verified:', checks.length, 'checks', playback);
  } catch (error) { await page.screenshot({ path: path.join(results, 'volume-automation-failure.png') }).catch(() => {}); throw error; }
  finally { await app.close(); }
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
