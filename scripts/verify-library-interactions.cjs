const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { ffmpeg, run, probe } = require('../electron/media.cjs');
const root = path.join(__dirname, '..');

(async () => {
  const results = path.join(root, 'test-results', 'library-interactions');
  await fs.mkdir(results, { recursive: true });
  const profile = await fs.mkdtemp(path.join(root, '.local', 'library-interactions-'));
  const file = path.join(profile, '編集の検証.luma'), music = path.join(profile, '音楽');
  await fs.mkdir(music);
  const sources = [];
  for (const [index, color, frequency] of [[0, 'red', 440], [1, 'blue', 880]]) {
    const source = path.join(profile, `映像 ${index}.mp4`); sources.push(source);
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `color=${color}:s=320x180:r=30:d=4`, '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=48000:duration=4`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source]);
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=3`, path.join(music, `曲 ${index}.wav`)]);
  }
  const env = { ...process.env, LUMA_TEST_DATA: profile, LUMA_DEMO_FIXTURE: '0' }; delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.LUMA_VERIFY_EXE;
  let app = await electron.launch({ executablePath, args: executablePath ? [] : [root], env, timeout: 60000 });
  let page = await app.firstWindow(); const checks = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const button = name => page.getByRole('button', { name, exact: true });
  const tab = name => page.getByRole('tab', { name, exact: true }).click();
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const windowSize = async (width, height) => {
    await app.evaluate(({ BrowserWindow }, dimensions) => BrowserWindow.getAllWindows()[0].setContentSize(...dimensions), [width, height]);
    await page.waitForFunction(([w, h]) => innerWidth === w && innerHeight === h, [width, height]); await settle();
  };
  const save = async () => {
    const before = (await fs.stat(file).catch(() => null))?.mtimeMs;
    await button(/^プロジェクトを保存 \(/).click();
    const deadline = Date.now() + 10000;
    while ((await fs.stat(file).catch(() => null))?.mtimeMs === before) { assert.ok(Date.now() < deadline, 'project saved'); await new Promise(resolve => setTimeout(resolve, 25)); }
    await page.getByRole('dialog', { name: 'プロジェクトを保存しています', exact: true }).waitFor({ state: 'hidden' }); await settle();
    return JSON.parse(await fs.readFile(file, 'utf8'));
  };
  const open = async project => {
    await fs.writeFile(file, JSON.stringify(project));
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file);
    await page.locator('.brand').click(); await page.keyboard.press('Control+o');
    await button(project.name).waitFor(); await settle();
  };
  const band = () => page.locator('.timeline-transition-wrap').first();
  const edge = side => band().locator('.transition-resize-' + side);
  const duration = () => page.getByLabel('トランジションの長さ', { exact: true });
  const seconds = async () => Number(await edge('end').getAttribute('aria-valuenow'));
  const unrelatedSelection = async project => {
    await tab('エフェクト');
    assert.equal(await page.locator('.applied-transition').count(), 0);
    assert.equal(await page.locator('.transition-editing-target').innerText(), '新しく追加する効果');
    await duration().fill('1.2'); await duration().press('Enter');
    assert.deepEqual((await save()).transitions, project.transitions, 'unrelated selections cannot resize a previously selected effect');
  };
  const drag = async (side, change, cancellation) => {
    await settle();
    const handle = edge(side), box = await handle.boundingBox();
    const zoom = Number(await page.getByRole('slider', { name: 'タイムラインのズーム', exact: true }).inputValue());
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + change * zoom / 2 * (side === 'start' ? -1 : 1), box.y + box.height / 2, { steps: 6 });
    if (cancellation === 'heldEscape') await new Promise(resolve => setTimeout(resolve, 1900));
    if (cancellation === 'escape' || cancellation === 'heldEscape') await page.keyboard.press('Escape');
    if (cancellation === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    if (cancellation === 'pointer') await handle.dispatchEvent('pointercancel', { pointerId: 1 });
    if (cancellation === 'return') await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
    if (!cancellation) {
      assert.equal(await duration().isDisabled(), true);
      assert.ok(Math.abs(Number(await duration().inputValue()) - await seconds()) < .000001);
      await page.locator('.transition-resize-readout').waitFor();
      await page.screenshot({ path: path.join(results, 'dragging.png') });
    }
    await page.mouse.up(); await settle();
    assert.equal(await page.locator('.transition-resize-readout').count(), 0);
  };
  try {
    await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 60000 }); await windowSize(1440, 900);
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, file);
    await app.evaluate(({ dialog }, files) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files }); }, sources);
    await button('素材を追加').click(); await page.getByRole('menuitem', { name: /素材を読み込む/ }).click();
    await page.locator('.media-card').nth(1).waitFor(); await button('映像 0.mp4 を追加').click();
    const first = await save(), base = first.clips[0];
    const project = { ...first, id: 'library-interactions', name: '素材と効果の操作', width: 320, height: 180, fps: 30, transitions: [], markers: [], clips: sources.map((source, index) => ({ ...base, id: 'v' + index, assetId: first.assets.find(a => a.path === source).id, name: '映像 ' + index, start: index * 4, in: 0, duration: 4, speed: 1, fadeIn: 0, fadeOut: 0, linkId: undefined, audioDetached: undefined })) };
    await open(project);
    await page.locator('.timeline-clip[data-clip-id="v1"]').focus(); await page.keyboard.press('Enter'); await tab('エフェクト');
    await button('切り替え').click(); assert.equal(await page.locator('.transition-list button').count(), 3);
    await button('音声').click(); assert.equal(await page.locator('.transition-list button').count(), 2);
    await button('色調').click(); assert.equal(await page.locator('.look-card').count(), 6);
    await button('シネマ 深い陰影、映画のように').click(); assert.equal((await save()).clips[1].saturation, .78);
    await button(/^元に戻す \(/).click(); await button('切り替え').click();
    await button('クロスディゾルブ 2つの映像をなめらかに重ねる').click();
    await band().waitFor(); const baseline = await save(); assert.equal(baseline.transitions[0].duration, .5);
    checks.push('effect categories show all five transitions and six looks; look application is undoable');

    await band().locator('.timeline-transition').click(); assert.equal(Number(await duration().inputValue()), .5);
    await drag('end', .6); let resized = await save(); assert.equal(resized.transitions[0].duration, 1.1);
    assert.deepEqual(resized.clips, baseline.clips); assert.equal(resized.transitions[0].id, baseline.transitions[0].id);
    await button(/^元に戻す \(/).click(); assert.deepEqual(await save(), baseline);
    await button(/^やり直す \(/).click(); assert.deepEqual(await save(), resized);
    await drag('start', .4); resized = await save(); assert.equal(resized.transitions[0].duration, 1.5);
    await drag('end', .3, 'return'); assert.deepEqual(await save(), resized);
    await button(/^元に戻す \(/).click(); assert.equal((await save()).transitions[0].duration, 1.1);
    await button(/^やり直す \(/).click(); assert.deepEqual(await save(), resized);
    for (const cancel of ['escape', 'pointer', 'blur']) { await drag('end', .4, cancel); assert.deepEqual(await save(), resized); }
    checks.push('both edges resize around the unchanged cut; live numeric feedback, one Undo/Redo, Escape, pointer cancellation and blur');

    await duration().fill('1.9'); await duration().press('Escape'); assert.equal(Number(await duration().inputValue()), 1.5); assert.deepEqual(await save(), resized);
    await duration().fill('0.73333'); await duration().press('Enter'); assert.equal((await save()).transitions[0].duration, 22 / 30);
    await edge('end').focus(); await page.keyboard.press('ArrowRight'); assert.equal((await save()).transitions[0].duration, 23 / 30);
    await edge('start').focus(); await page.keyboard.press('Shift+ArrowLeft'); assert.equal((await save()).transitions[0].duration, 33 / 30);
    await edge('end').focus(); await page.keyboard.press('End'); assert.equal(await seconds(), 2);
    await page.keyboard.press('Home'); assert.equal(await seconds(), 1 / 30);
    const track = project.tracks.find(t => t.id === base.trackId).name;
    await button(track + ' ロック').click(); assert.equal(await edge('end').isDisabled(), true); assert.equal(await duration().isDisabled(), true);
    await button(track + ' ロック解除').click();
    checks.push('numeric edits and keyboard steps remain frame-aligned; minimum, maximum and track locks are enforced');

    await save(); await open({ ...baseline, name: 'カテゴリごとの効果解除' }); await band().locator('.timeline-transition').click();
    await button('音声').click(); await button('効果を解除').click();
    const videoOnly = await save(); assert.equal(videoOnly.transitions[0].video, 'dissolve'); assert.equal(videoOnly.transitions[0].audio, undefined);
    assert.deepEqual(videoOnly.clips, baseline.clips); assert.equal(videoOnly.transitions[0].id, baseline.transitions[0].id);
    await button(/^元に戻す \(/).click(); assert.deepEqual((await save()).transitions, baseline.transitions);
    await button('切り替え').click(); await button('効果を解除').click();
    const audioOnly = await save(); assert.equal(audioOnly.transitions[0].video, undefined); assert.equal(audioOnly.transitions[0].audio, 'constantPower');
    await button(/^元に戻す \(/).click(); await button(/^やり直す \(/).click(); assert.deepEqual((await save()).transitions, audioOnly.transitions);
    await button('音声').click(); await button('効果を解除').click(); assert.deepEqual((await save()).transitions, []);
    checks.push('category removal preserves the other half of a combined effect, its identity and clip placement with Undo/Redo');

    const linked = { ...baseline, id: 'linked-resize', name: 'リンク音声の長さ', clips: baseline.clips.flatMap((clip, index) => [{ ...clip, audioDetached: true, linkId: 'link' + index }, { ...clip, id: 'a' + index, kind: 'audio', trackId: baseline.tracks.find(t => t.kind === 'audio').id, linkId: 'link' + index }]), transitions: [{ ...baseline.transitions[0], video: 'pagePeel', audio: undefined }, { ...baseline.transitions[0], id: 'linked-audio', fromId: 'a0', toId: 'a1', video: undefined, audio: 'constantGain' }] };
    await save(); await open(linked); await tab('エフェクト'); await band().locator('.timeline-transition').click();
    await button('音声').click(); assert.equal(await page.locator('.applied-transition.selected').count(), 1); assert.equal(Number(await duration().inputValue()), .5);
    await button('切り替え').click(); assert.equal(await page.locator('.applied-transition.selected').count(), 1);
    await drag('end', 1); const linkedSaved = await save(); assert.deepEqual(linkedSaved.transitions.map(t => t.duration), [1.5, 1.5]); assert.deepEqual(linkedSaved.clips, linked.clips);
    const audioTrack = linkedSaved.tracks.find(t => t.id === linkedSaved.clips.find(c => c.kind === 'audio').trackId).name;
    await button(audioTrack + ' ロック').click(); assert.equal(await edge('end').isDisabled(), true); await button(audioTrack + ' ロック解除').click();
    await save(); await open({ ...linkedSaved, name: 'リンク音声を再読込' }); assert.equal(await seconds(), 1.5);
    checks.push('linked audio follows the same duration, locked audio protects the video handle, and native save/reload retains the result');
    await page.getByLabel('プレビュー画質', { exact: true }).selectOption('1');
    const zoom = Number(await page.getByRole('slider', { name: 'タイムラインのズーム', exact: true }).inputValue());
    await page.locator('.timeline-ruler').click({ position: { x: 4.2 * zoom, y: 25 } });
    await page.waitForFunction(() => { const canvas = document.querySelector('.canvas-wrap canvas'); return canvas.width === 320 && canvas.dataset.previewTime === '4.2' && canvas.dataset.transitionsReady === 'true'; });
    const preview = path.join(results, 'resized-preview.png'), output = path.join(results, 'resized-export.mp4');
    await fs.writeFile(preview, Buffer.from(await page.locator('.canvas-wrap canvas').evaluate(canvas => canvas.toDataURL('image/png').split(',')[1]), 'base64'));
    await require('../electron/export.cjs').exportProject(linkedSaved, { width: 320, height: 180, fps: 30, quality: 'high', encoder: 'cpu' }, output);
    assert.ok(Math.abs(Number((await probe(output)).format.duration) - 8) < .06);
    const reference = await run(ffmpeg, ['-v', 'error', '-i', preview, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
    const actual = await run(ffmpeg, ['-v', 'error', '-ss', '4.2', '-i', output, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
    assert.equal(actual.length, reference.length); let pixelError = 0; for (let i = 0; i < actual.length; i++) pixelError += Math.abs(actual[i] - reference[i]);
    assert.ok(pixelError / actual.length < 4, 'resized transition preview matches exported pixels');
    checks.push('the resized linked effect exports at the unchanged full length with matching preview pixels');


    await band().locator('.timeline-transition').click(); await tab('テキスト'); assert.equal(await page.locator('.title-template').count(), 3);
    await button('シネマタイトルを追加').click(); const title = await save(); assert.equal(title.clips.filter(c => c.kind === 'title').length, 1);
    await unrelatedSelection(title);
    await button(/^元に戻す \(/).click();
    await band().locator('.timeline-transition').click();
    await tab('図形'); assert.equal(await page.locator('.drawing-sound').getAttribute('open'), null);
    await page.locator('.drawing-sound summary').click(); await page.getByLabel('図形と同時に追加', { exact: true }).selectOption('none'); await page.locator('.drawing-sound summary').click();
    await button('四角で囲む').click(); await button('選択した図形を中央に追加').click();
    const drawing = await save(); assert.equal(drawing.clips.filter(c => c.graphic).length, 1); await unrelatedSelection(drawing); await button(/^元に戻す \(/).click();
    checks.push('compact title cards add at the playhead; collapsed sound options and centered drawing retain their actions');

    await band().locator('.timeline-transition').click(); await tab('BGM'); await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, music);
    await button('フォルダを選択').click(); await page.locator('.bgm-track').filter({ hasText: '曲 1.wav' }).waitFor();
    await button('曲 1.wav を試聴').click(); await page.waitForFunction(() => { const audio = document.querySelector('.bgm-player'); return audio && !audio.paused && audio.currentTime > .1; });
    await button('曲 0.wav を試聴').click(); await button('曲 0.wav の試聴を停止').waitFor(); await page.keyboard.press('Escape');
    assert.ok(await page.locator('.bgm-player').evaluate(audio => audio.paused));
    await page.evaluate(() => {
      const player = document.querySelector('.bgm-player'), play = player.play.bind(player);
      player.play = async () => { player.play = play; await play(); await new Promise(resolve => { globalThis.releaseFirstAudition = resolve; }); };
    });
    await button('曲 0.wav を試聴').click(); await page.waitForFunction(() => !!globalThis.releaseFirstAudition);
    await button('曲 1.wav を試聴').click(); await button('曲 1.wav の試聴を停止').waitFor();
    await page.evaluate(() => globalThis.releaseFirstAudition()); await settle();
    assert.equal(await page.locator('.bgm-player').evaluate(audio => audio.paused), false, 'a delayed earlier audition cannot pause the new song');
    await page.keyboard.press('Escape');
    await page.getByLabel('BGMを検索', { exact: true }).fill('1'); assert.equal(await page.locator('.bgm-track').count(), 1);
    await page.locator('.bgm-track-select').click(); await page.getByLabel('BGMの追加する長さ', { exact: true }).selectOption('full');
    await button('BGMをタイムラインに追加').click(); await page.getByText(/BGMを追加しました/).waitFor();
    const withMusic = await save(); assert.ok(withMusic.clips.some(c => c.name === '曲 1.wav'));
    await unrelatedSelection(withMusic);
    await button(/^元に戻す \(/).click();
    checks.push('per-song buttons directly audition and switch songs; search, length and insertion remain usable');

    await page.getByRole('separator', { name: '素材パネルの幅を変更', exact: true }).focus(); await page.keyboard.press('Home'); await windowSize(1100, 720);
    for (const [name, filename] of [['エフェクト', 'effects'], ['テキスト', 'titles'], ['図形', 'drawing'], ['BGM', 'bgm']]) {
      await tab(name); if (name === 'エフェクト') await button('切り替え').click(); await settle();
      const bounds = await page.locator('.library-panel').evaluate(panel => ({ width: panel.clientWidth, scroll: panel.scrollWidth }));
      assert.ok(bounds.scroll <= bounds.width, name + ' has no horizontal overflow');
      const footer = page.locator(name === 'BGM' ? '.bgm-actionbar' : name === '図形' ? '.drawing-actionbar' : name === 'エフェクト' ? '.transition-settings' : '.library-browser-hint');
      const panelBox = await page.locator('.library-panel').boundingBox(), footerBox = await footer.boundingBox();
      assert.ok(footerBox.y + footerBox.height <= panelBox.y + panelBox.height + 1, name + ' footer fits');
      await page.screenshot({ path: path.join(results, filename + '-minimum.png') });
    }
    await windowSize(1440, 900); await page.getByRole('separator', { name: '素材パネルの幅を変更', exact: true }).focus(); await page.keyboard.press('ArrowRight');
    for (const [name, filename] of [['エフェクト', 'effects'], ['テキスト', 'titles'], ['図形', 'drawing'], ['BGM', 'bgm']]) { await tab(name); await page.locator('.library-panel').screenshot({ path: path.join(results, filename + '.png') }); }
    checks.push('all four tabs fit the minimum window and a 248 px panel with reachable footer controls');

    await save(); const legacy = { ...baseline, id: 'legacy-resize', name: '以前の重なり方式', clips: baseline.clips.map((clip, i) => i ? { ...clip, start: 3 } : clip), transitions: baseline.transitions.map(({ mode, duration, ...transition }) => transition) };
    await open(legacy); await band().locator('.timeline-transition').click(); assert.equal(await edge('end').isDisabled(), true);
    await page.getByText('以前の重なり方式の効果は、クリップの重なりが長さになります。', { exact: true }).waitFor(); assert.deepEqual((await save()).clips, legacy.clips);
    checks.push('legacy overlaps retain their placement and clearly explain the read-only duration');
    const recoveryFile = path.join(profile, 'autosave.luma');
    const restart = async () => {
      await app.close();
      app = await electron.launch({ executablePath, args: executablePath ? [] : [root], env, timeout: 60000 });
      page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
      await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 60000 });
    };
    await open(baseline); await band().locator('.timeline-transition').click();
    await drag('end', .3, 'heldEscape');
    await assert.rejects(fs.access(recoveryFile), { code: 'ENOENT' });
    await restart(); assert.equal(await button('復元する').count(), 0, 'a canceled clean edit is not offered after restart');
    await open(baseline); await band().locator('.timeline-transition').click(); await drag('end', .3);
    const deadline = Date.now() + 10000; let backup;
    while (!backup) {
      try { backup = JSON.parse(await fs.readFile(recoveryFile, 'utf8')); } catch { assert.ok(Date.now() < deadline, 'committed resize autosaves'); await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    assert.equal(backup.project.transitions[0].duration, .8);
    await drag('end', .3, 'heldEscape'); assert.deepEqual(JSON.parse(await fs.readFile(recoveryFile, 'utf8')).project, backup.project);
    await restart(); await button('復元する').click(); await band().waitFor(); assert.equal(await seconds(), .8);
    checks.push('held canceled resizes never overwrite recovery; clean restart has no recovery and committed edits survive dirty cancellation and restart');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(results, 'verification.json'), JSON.stringify({ passed: true, packaged: !!executablePath, checks, errors }, null, 2));
    console.log('Library layout and transition resizing verified: ' + checks.length + ' cases.');
  } catch (error) { await page.screenshot({ path: path.join(results, 'failure.png') }).catch(() => {}); throw error; }
  finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
