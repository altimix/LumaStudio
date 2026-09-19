const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { ffmpeg, run } = require('../electron/media.cjs');
const root = path.join(__dirname, '..');
const storageKey = 'luma.workspace-layout.v1';

(async () => {
  const results = path.join(root, 'test-results', 'layout');
  await fs.mkdir(results, { recursive: true }); await fs.mkdir(path.join(root, '.local'), { recursive: true });
  const profile = await fs.mkdtemp(path.join(root, '.local', 'layout-profile-'));
  const source = path.join(profile, 'レイアウト確認 青い写真.png'), projectFile = path.join(profile, 'layout.luma');
  const audioSource = path.join(profile, 'レイアウト確認 音声.wav');
  await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x346879:s=640x360', '-frames:v', '1', source]);
  await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', audioSource]);
  const bgmFolder = path.join(profile, 'BGM'); await fs.mkdir(bgmFolder);
  await fs.copyFile(audioSource, path.join(bgmFolder, '調整するBGM.wav'));
  const executablePath = process.env.LUMA_VERIFY_EXE;
  const env = { ...process.env, LUMA_TEST_DATA: profile, LUMA_DEMO_FIXTURE: '0' }; delete env.ELECTRON_RUN_AS_NODE;
  const checks = [], errors = [];
  let app, page;
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const button = name => page.getByRole('button', { name, exact: true });
  const separator = name => page.getByRole('separator', { name, exact: true });
  const size = async name => Number(await separator(name).getAttribute('aria-valuenow'));
  const names = ['素材パネルの幅を変更', 'プロパティパネルの幅を変更', 'タイムラインの高さを変更'];
  const sizes = () => Promise.all(names.map(size));
  const prefs = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
  const waitStored = expected => page.waitForFunction(({ key, expected }) => {
    const data = JSON.parse(localStorage.getItem(key));
    return data && Object.entries(expected).every(([name, value]) => data[name] === value);
  }, { key: storageKey, expected });
  const windowSize = async (width, height) => {
    await app.evaluate(({ BrowserWindow }, dimensions) => BrowserWindow.getAllWindows()[0].setContentSize(...dimensions), [width, height]);
    await page.waitForFunction(([w, h]) => innerWidth === w && innerHeight === h, [width, height]); await settle();
  };
  async function launch() {
    app = await electron.launch({ executablePath, args: executablePath ? [] : [root], env, timeout: 60000 });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 60000 });
    await windowSize(1600, 960);
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, projectFile);
  }
  const save = async () => {
    await button(/^プロジェクトを保存 \(/).click();
    await page.waitForFunction(() => !document.querySelector('.unsaved-dot'));
    return JSON.parse(await fs.readFile(projectFile, 'utf8'));
  };
  const openProject = async () => {
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, projectFile);
    await page.locator('.brand').click(); await page.keyboard.press('Control+o');
    await page.locator('.media-card').first().waitFor();
  };
  const drag = async (name, dx, dy, cancel = false) => {
    const box = await separator(name).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 6 });
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up(); await settle();
  };
  const screenshot = name => page.screenshot({ path: path.join(results, name + '.png'), scale: 'css' });
  try {
    await launch();
    assert.deepEqual(await sizes(), [288, 286, 354]);
    assert.equal(await page.locator('.import-zone').count(), 0);
    await button('ファイルを選択').waitFor();
    await button('素材を追加').focus(); await page.keyboard.press('ArrowDown');
    assert.ok(await page.getByRole('menuitem', { name: /素材を読み込む/ }).evaluate(element => element === document.activeElement));
    await page.keyboard.press('ArrowDown');
    assert.ok(await page.getByRole('menuitem', { name: 'ブラックビデオを追加', exact: true }).evaluate(element => element === document.activeElement));
    await page.keyboard.press('Delete'); assert.equal(await page.locator('.unsaved-dot').count(), 0);
    await page.keyboard.press('Escape'); assert.equal(await page.getByRole('menu').count(), 0);
    assert.ok(await button('素材を追加').evaluate(element => element === document.activeElement));
    await screenshot('empty');
    checks.push('empty-state import and accessible add menu, arrow navigation and Escape; menu keys do not edit project');

    await button('素材を追加').click(); await page.getByRole('menuitem', { name: 'ブラックビデオを追加', exact: true }).click();
    await page.locator('.media-card').waitFor();
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, source);
    await button('素材を追加').click(); await page.getByRole('menuitem', { name: /素材を読み込む/ }).click();
    await page.getByRole('button', { name: path.basename(source) + ' を追加', exact: true }).waitFor();
    assert.equal(await page.getByRole('menu').count(), 0);
    assert.equal(await page.locator('.media-card').count(), 2);
    await button(path.basename(source) + ' を追加').click(); await page.locator('.timeline-clip.image').waitFor();
    const original = await save();
    const undoBefore = await button(/^元に戻す \(/).isEnabled();
    const playhead = await page.locator('.preview-meta .timecode').first().textContent();
    checks.push('native import and black background are available from the consolidated menu and remain usable on timeline');

    await drag(names[0], 80, 0); await drag(names[1], -64, 0); await drag(names[2], 0, -54);
    assert.deepEqual(await sizes(), [368, 350, 408]);
    await separator(names[0]).focus(); await page.keyboard.press('ArrowRight');
    await separator(names[1]).focus(); await page.keyboard.press('ArrowLeft');
    await separator(names[2]).focus(); await page.keyboard.press('ArrowUp');
    assert.deepEqual(await sizes(), [378, 360, 418]);
    assert.equal(await page.locator('.preview-meta .timecode').first().textContent(), playhead);
    await drag(names[0], 45, 0, true); assert.deepEqual(await sizes(), [378, 360, 418]);
    assert.equal(await button(/^元に戻す \(/).isEnabled(), undoBefore);
    assert.equal(await page.locator('.unsaved-dot').count(), 0);
    assert.deepEqual(await save(), original);
    await waitStored({ libraryWidth: 378, inspectorWidth: 360, timelineHeight: 418 });
    checks.push('mouse and keyboard resizing, Escape cancellation, persistence, and unchanged project/history/playhead');

    const search = page.getByRole('textbox', { name: '素材を検索', exact: true });
    await search.fill('レイアウト');
    await button('素材パネルを折りたたむ').click(); await button('プロパティパネルを折りたたむ').click();
    assert.equal(await page.locator('#workspace-library').isVisible(), false);
    assert.equal(await page.locator('#workspace-inspector').isVisible(), false);
    await screenshot('collapsed');
    await button('素材パネルを表示').click(); assert.equal(await search.inputValue(), 'レイアウト');
    await button('素材パネルを折りたたむ').click();
    await waitStored({ libraryCollapsed: true, inspectorCollapsed: true });
    await app.close(); app = null; await launch();
    await button('素材パネルを表示').waitFor(); await button('プロパティパネルを表示').waitFor();
    await button('素材パネルを表示').click(); await button('プロパティパネルを表示').click();
    assert.deepEqual(await sizes(), [378, 360, 418]);
    await openProject();
    checks.push('collapse/reopen retains search within session; application restart restores both panel widths, collapsed state and timeline height');

    for (const name of names) { await separator(name).focus(); await page.keyboard.press('End'); }
    await waitStored({ libraryWidth: 520, inspectorWidth: 520 }); const preferred = await prefs();
    const expanded = await sizes();
    await windowSize(1100, 720);
    const small = await sizes(); assert.ok(small[0] < expanded[0] && small[1] < expanded[1] && small[2] < expanded[2]);
    await drag(names[0], -35, 0, true);
    await waitStored(preferred); assert.deepEqual(await sizes(), small);
    const bounds = await page.locator('.workspace').evaluate(element => {
      const preview = element.querySelector('.preview-panel').getBoundingClientRect();
      return { preview: preview.width, workspace: element.clientHeight, overflow: document.documentElement.scrollWidth > innerWidth, bottom: document.querySelector('.statusbar').getBoundingClientRect().bottom, height: innerHeight };
    });
    assert.ok(bounds.preview >= 400 && bounds.workspace >= 280 && !bounds.overflow && bounds.bottom <= bounds.height, JSON.stringify(bounds));
    await button('素材を追加').click();
    const menu = await page.getByRole('menu').boundingBox(), library = await page.locator('.library-panel').boundingBox();
    assert.ok(menu.x >= library.x && menu.x + menu.width <= library.x + library.width);
    await page.keyboard.press('Escape');
    await screenshot('compact');
    await windowSize(1600, 960); assert.deepEqual(await sizes(), expanded); assert.deepEqual(await prefs(), preferred);
    checks.push('1100 × 720 window retains preview, timeline, menu and statusbar; widening restores preferred dimensions without overwriting them');
    await windowSize(1100, 720);
    const compactLibrary = await size(names[0]);
    await drag(names[0], 30, 0); assert.equal(await size(names[0]), compactLibrary + 30);
    await waitStored({ libraryWidth: compactLibrary + 30, inspectorWidth: 520 });
    await app.close(); app = null; await launch();
    assert.equal(await size(names[0]), compactLibrary + 30); assert.equal(await size(names[1]), 520);
    await openProject();
    checks.push('compact resizing follows the pointer and preserves the untouched panel preference when restarting in a larger window');

    await button('ウィンドウ').click(); await button('レイアウトを初期状態に戻す').click();
    assert.deepEqual(await sizes(), [288, 286, 354]);
    await separator(names[2]).focus(); await page.keyboard.press('Home');
    const minimumMeters = [];
    const checkMinimumMeter = async font => {
      await settle();
      const bounds = await page.locator('.audio-meter').evaluate(element => {
        const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
        return { top: rect.top + parseFloat(style.paddingTop), bottom: rect.bottom - parseFloat(style.paddingBottom),
          bodyHeight: element.querySelector('.meter-body').getBoundingClientRect().height,
          rows: [...element.children].map(row => ({ name: row.className, top: row.getBoundingClientRect().top, bottom: row.getBoundingClientRect().bottom })) };
      });
      minimumMeters.push({ font, ...bounds });
      assert.ok(bounds.bodyHeight >= 60 && bounds.rows.every(row => row.top >= bounds.top && row.bottom <= bounds.bottom), JSON.stringify({ font, ...bounds }));
    };
    await checkMinimumMeter('preferred'); await screenshot('minimum');
    const fallbackFont = await page.addStyleTag({ content: '.meter-heading,.meter-scale,.meter-reading,.meter-maximum{font-family:Menlo,monospace}' });
    await checkMinimumMeter('monospace fallback');
    await fallbackFont.evaluate(element => element.remove());
    await button('ウィンドウ').click(); await button('レイアウトを初期状態に戻す').click();
    await page.locator('.timeline-clip.image').click();
    await button('プロパティパネルを折りたたむ').click();
    await page.locator('.timeline-clip.image').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'プロパティを開く', exact: true }).click();
    assert.ok(await page.locator('.inspector-panel').isVisible());
    await page.getByRole('navigation', { name: 'ワークスペース' }).getByRole('button', { name: 'カラー', exact: true }).click();
    await button('素材パネルを折りたたむ').click(); await button('ルックを選ぶ').click();
    assert.ok(await page.getByRole('tab', { name: 'エフェクト', exact: true }).isVisible());
    assert.equal(await page.getByRole('navigation', { name: 'ワークスペース' }).getByRole('button', { name: 'テキスト', exact: true }).count(), 0);
    await button('素材パネルを折りたたむ').click(); await button('プロパティパネルを折りたたむ').click();
    await button('使い方').click(); await button('文字を追加する').click();
    assert.ok(await page.getByRole('tab', { name: 'テキスト', exact: true }).isVisible());
    assert.ok(await page.locator('.inspector-panel').isVisible());
    await button('プロパティパネルを折りたたむ').click();
    await page.getByRole('button', { name: /ミニマル/ }).click(); await page.locator('.timeline-clip.title').waitFor();
    assert.ok(await page.locator('.inspector-panel').isVisible(), 'title insertion reveals the same video properties tab');
    await page.getByRole('textbox', { name: 'テロップのテキスト', exact: true }).fill('自分に合う編集画面');
    await page.getByRole('textbox', { name: 'テロップのテキスト', exact: true }).blur();
    await button(/^元に戻す \(/).click(); await button(/^元に戻す \(/).click();
    assert.equal(await page.locator('.timeline-clip.title').count(), 0);
    await button(/^やり直す \(/).click(); await button(/^やり直す \(/).click();
    await page.locator('.timeline-clip.title').waitFor();
    checks.push('reset restores defaults; minimum timeline fits all meter rows with preferred and fallback fonts; guide reveals collapsed panels and the sole text template tab supports add/edit/undo/redo');
    await page.getByRole('tab', { name: 'メディア', exact: true }).click(); await settle();
    await page.locator('.timeline-clip.title').click();
    const textSizes = await page.evaluate(() => Object.fromEntries(['.media-card-info small', '.field-help', '.property-label label', '.statusbar', '.library-tabs button'].map(selector => [selector, parseFloat(getComputedStyle(document.querySelector(selector)).fontSize)])));
    assert.ok(Object.values(textSizes).every(value => value >= 11), JSON.stringify(textSizes));
    await screenshot('workspace');
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, audioSource);
    await button('素材を追加').click(); await page.getByRole('menuitem', { name: /素材を読み込む/ }).click();
    await button(path.basename(audioSource) + ' を追加').click(); await page.locator('.timeline-clip.audio').waitFor();
    const withAudio = await save();
    for (const command of ['音量を細かく調整', 'プロパティを開く']) {
      await button('プロパティパネルを折りたたむ').click();
      await page.locator('.timeline-clip.audio').click({ button: 'right' });
      await page.getByRole('menuitem', { name: command, exact: true }).click();
      assert.ok(await page.locator('.inspector-panel').isVisible());
      assert.equal(await page.locator('.inspector-tabs button.selected').textContent(), 'オーディオ');
    }
    assert.deepEqual(await save(), withAudio);
    checks.push('image and audio properties commands reveal the collapsed inspector, including the same tab, without changing the project');
    await page.getByRole('tab', { name: 'BGM', exact: true }).click();
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, bgmFolder);
    await button('フォルダを選択').click(); await page.locator('.bgm-track').filter({ hasText: '調整するBGM.wav' }).waitFor();
    await page.getByLabel('BGMの追加する長さ', { exact: true }).selectOption('full');
    await button('プロパティパネルを折りたたむ').click();
    await button('BGMをタイムラインに追加').click();
    await page.locator('.inspector-panel').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.inspector-tabs button.selected').textContent(), 'オーディオ');
    const withBgm = await save(); assert.equal(withBgm.clips.length, withAudio.clips.length + 1);
    await button(/^元に戻す \(/).click(); assert.deepEqual(await save(), withAudio);
    await button(/^やり直す \(/).click(); assert.deepEqual(await save(), withBgm);
    await page.locator('.timeline-clip.image').click();
    await page.getByRole('tab', { name: '図形', exact: true }).click();
    await page.locator('.inspector-tabs button').first().click();
    await page.locator('.drawing-sound summary').click();
    await page.getByLabel('図形と同時に追加', { exact: true }).selectOption('none');
    await button('四角で囲む').click(); await button('プロパティパネルを折りたたむ').click();
    await button('選択した図形を中央に追加').click();
    await page.locator('.inspector-panel').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.inspector-tabs button.selected').textContent(), '図形');
    const withDrawing = await save(); assert.equal(withDrawing.clips.length, withBgm.clips.length + 1);
    await button(/^元に戻す \(/).click(); assert.deepEqual(await save(), withBgm);
    await button(/^やり直す \(/).click(); assert.deepEqual(await save(), withDrawing);
    checks.push('title, BGM and drawing insertions reveal their collapsed properties tab, including repeated same-tab requests, and retain one-step undo/redo');
    await page.locator('.timeline-clip.image').click();
    await page.locator('.inspector-tabs button').first().click();
    await windowSize(1280,720);
    assert.equal(await page.locator('.inspector-content summary').first().innerText(), '基本設定');
    const beforePreset = await save();
    const position=await page.locator('.preview-panel .timecode.accent').textContent();
    const propertyTabs=page.locator('.inspector-tabs button');await propertyTabs.first().focus();await page.keyboard.press('ArrowRight');await settle();assert.equal(await propertyTabs.nth(1).getAttribute('aria-pressed'),'true');
    await page.keyboard.press('Home');await settle();assert.equal(await propertyTabs.first().getAttribute('aria-pressed'),'true');
    const libraryTabs=page.getByRole('tablist',{name:'素材パネル'});await libraryTabs.getByRole('tab').first().focus();await page.keyboard.press('End');await settle();assert.equal(await libraryTabs.getByRole('tab').last().getAttribute('aria-selected'),'true');await page.keyboard.press('Home');await settle();assert.equal(await libraryTabs.getByRole('tab').first().getAttribute('aria-selected'),'true');
    assert.equal(await page.locator('.preview-panel .timecode.accent').textContent(),position);assert.deepEqual(await save(),beforePreset);checks.push('property and library tabs expose selection and support Left/Right/Home/End without editing or seeking');
    await button('ウィンドウ').click(); await button('プレビュー優先の配置').click();
    await page.getByRole('button', { name:'素材パネルを表示', exact:true }).waitFor();
    await page.getByRole('button', { name:'プロパティパネルを表示', exact:true }).waitFor();
    assert.ok((await page.locator('.preview-panel').boundingBox()).width > 1100);
    assert.deepEqual(await save(), beforePreset);
    await screenshot('preview-preset-1280');
    await button('ウィンドウ').click(); await button('レイアウトを初期状態に戻す').click();
    await windowSize(1600,960);
    checks.push('basic properties precede effects; preview preset at 1280x720 enlarges the monitor without editing the project');
    await page.evaluate(key => localStorage.setItem(key, '{broken'), storageKey); await page.reload();
    await page.locator('.loading-screen').waitFor({ state: 'hidden' }); await settle(); assert.deepEqual(await sizes(), [288, 286, 354]);
    checks.push('main helper text is at least 11px; malformed preferences recover to usable defaults');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(results, 'verification.json'), JSON.stringify({ passed: true, packaged: !!executablePath, checks, textSizes, compactBounds: bounds, minimumMeters, consoleErrors: errors }, null, 2));
    console.log(`Workspace layout verified: ${checks.length} cases.`);
  } catch (error) { if (page) await screenshot('failure').catch(() => {}); throw error; }
  finally { if (app) await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
