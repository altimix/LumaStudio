const assert = require('node:assert/strict');

// Runs in both development and the Windows/macOS packaged Bezier suite.
module.exports = async function verifyBezierModifiers({ page, save, checks, loadMask }) {
  await page.locator('#video-mask-type').selectOption('bezier');
  await page.getByRole('button', { name: 'モニターでマスクを編集', exact: true }).click();
  const view = await page.locator('.canvas-wrap').boundingBox();
  const at = (x, y) => ({ x: view.x + x * view.width, y: view.y + y * view.height });
  const read = async () => (await save()).clips[0].videoMask;
  const anchor = n => page.getByRole('button', { name: `ベジェマスクの点 ${n}を移動`, exact: true });
  const center = async locator => { const box = await locator.boundingBox(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);
  const pen = page.getByRole('button', { name: 'ペン', exact: true });
  const direct = page.getByRole('button', { name: 'ダイレクト選択', exact: true });
  let start = at(.2, .25), end = at(.3, .27);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.keyboard.down('Shift'); await page.mouse.move(end.x, end.y, { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Shift');
  let mask = await read();
  assert.equal(mask.points.length, 1); assert.equal(mask.points[0].kind, 'curve');
  near(mask.points[0].outY, mask.points[0].y); near(mask.points[0].inY, mask.points[0].y);
  const curve = JSON.stringify(mask);
  await page.keyboard.press('Control+z'); assert.equal(await page.locator('.bezier-mask-anchor').count(), 0);
  await page.keyboard.press('Control+Shift+z'); assert.equal(JSON.stringify(await read()), curve);
  end = at(.7, .28); await page.keyboard.down('Shift'); await page.mouse.click(end.x, end.y); await page.keyboard.up('Shift');
  mask = await read(); near(mask.points[1].y, mask.points[0].y);
  end = at(.75, .75); await page.mouse.click(end.x, end.y);
  checks.push('pen drag creates a curve in one undo and Shift constrains handles and next anchors');

  for (const modifier of ['Control', 'Meta']) {
    await page.keyboard.down(modifier);
    assert.equal(await direct.getAttribute('aria-pressed'), 'true');
    start = await center(anchor(2)); await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(start.x - view.width * .02, start.y + view.height * .02, { steps: 4 }); await page.mouse.up();
    await page.keyboard.up(modifier);
    assert.equal(await pen.getAttribute('aria-pressed'), 'true');
  }
  for (const modifier of ['Control', 'Meta']) {
    await pen.focus(); await page.keyboard.down(modifier);
    assert.equal(await direct.getAttribute('aria-pressed'), 'true');
    await page.getByRole('textbox', {name:'クリップ名',exact:true}).focus(); await page.keyboard.up(modifier);
    assert.equal(await pen.getAttribute('aria-pressed'), 'true');
  }
  checks.push('Ctrl and Cmd release over inspector inputs restores the pen tool');
  await pen.focus();
  await page.keyboard.down('Control'); end = at(.9, .9); await page.mouse.click(end.x, end.y); await page.keyboard.up('Control');
  assert.equal(await direct.getAttribute('aria-pressed'), 'true');
  end = at(.9, .85); await page.mouse.click(end.x, end.y);
  assert.equal(await page.locator('.bezier-mask-anchor').count(), 3); assert.equal((await read()).closed, false);
  checks.push('Ctrl and Cmd temporarily select points; Ctrl blank ends drawing without closing or adding');

  await anchor(1).click(); await page.keyboard.down('Shift'); await anchor(2).click(); await page.keyboard.up('Shift');
  assert.equal(await page.locator('.bezier-mask-anchor[aria-pressed="true"]').count(), 2);
  const before = await read(); start = await center(anchor(1));
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.keyboard.down('Shift');
  await page.mouse.move(start.x + 30, start.y + 27, { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Shift');
  mask = await read();
  const dx = mask.points[0].x - before.points[0].x, dy = mask.points[0].y - before.points[0].y;
  assert.ok(dx > 0); assert.ok(Math.abs(dx * view.width - dy * view.height) < .01);
  near(mask.points[1].x - before.points[1].x, dx); near(mask.points[1].y - before.points[1].y, dy);
  near(mask.points[0].outX - before.points[0].outX, dx);
  assert.deepEqual(mask.points[2], before.points[2]);
  await page.keyboard.press('Control+z'); assert.deepEqual(await read(), before);
  await page.keyboard.press('Control+Shift+z'); assert.deepEqual(await read(), mask);
  checks.push('Shift selects multiple anchors and rigidly translates their handles with one undo');

  const outgoing = page.getByRole('button', { name: '点 1の出力ハンドルを移動', exact: true });
  const original = (await read()).points[0]; start = await center(outgoing);
  await page.keyboard.down('Alt'); await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x + 12, start.y + 24, { steps: 5 });
  await page.keyboard.down('Shift'); await page.mouse.up(); await page.keyboard.up('Shift'); await page.keyboard.up('Alt');
  mask = await read(); near(mask.points[0].inX, original.inX); near(mask.points[0].inY, original.inY);
  assert.notEqual(mask.points[0].outX, original.outX);
  const asymmetric = JSON.stringify(mask);
  start = await center(outgoing); await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x - 15, start.y + 10, { steps: 3 }); await page.keyboard.press('Escape'); await page.mouse.up();
  assert.equal(JSON.stringify(await read()), asymmetric);
  checks.push('Alt plus Shift creates an asymmetric handle; Escape restores it without damaging history');

  start = await center(outgoing); await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x + 10, start.y + 8, { steps: 3 });
  const incoming = page.getByRole('button', { name: '点 1の入力ハンドルを移動', exact: true });
  const frozen = await center(incoming);
  await page.keyboard.down('Alt'); await page.mouse.move(start.x + 22, start.y + 20, { steps: 3 });
  const held = await center(incoming); near(held.x, frozen.x); near(held.y, frozen.y);
  await page.keyboard.up('Alt');
  const coupled = await center(incoming); assert.ok(Math.hypot(coupled.x - frozen.x, coupled.y - frozen.y) > 5);
  await page.keyboard.press('Escape'); await page.mouse.up();
  assert.equal(JSON.stringify(await read()), asymmetric);
  checks.push('Alt pressed mid-drag freezes the current opposite handle and release recouples it');

  await pen.click(); end = at(.4, .8); await page.mouse.move(end.x, end.y); await page.mouse.down();
  await page.mouse.move(end.x + 20, end.y - 10); await page.keyboard.press('Escape'); await page.mouse.up();
  assert.equal(await page.locator('.bezier-mask-anchor').count(), 3);
  assert.equal(JSON.stringify(await read()), asymmetric);
  checks.push('cancelling pen creation removes the new point and its gesture history');
  end = at(.3, .8); await page.mouse.click(end.x, end.y);
  assert.equal(await page.locator('.bezier-mask-anchor').count(), 4);
  const openPath = await read();
  await direct.click(); start = await center(anchor(4)); const first = await center(anchor(1));
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(first.x + 8, first.y, { steps: 5 });
  assert.equal(await page.locator('.bezier-mask-anchor.close-candidate').count(), 1);
  await page.mouse.up(); mask = await read();
  assert.equal(mask.closed, true); assert.equal(mask.points.length, 3);
  await page.keyboard.press('Control+z'); assert.deepEqual(await read(), openPath);
  await page.keyboard.press('Control+Shift+z'); assert.deepEqual(await read(), mask);
  await page.getByRole('button', { name: 'パスを開いて点を追加', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.bezier-tools button')].some(button => button.textContent === 'ペン' && button.getAttribute('aria-pressed') === 'true'));
  const nearFirst = await center(anchor(1));
  await page.mouse.move(nearFirst.x + 9, nearFirst.y);
  await page.waitForFunction(() => document.querySelector('.bezier-mask-anchor.close-candidate'), undefined, { timeout: 2000 });
  await page.mouse.click(nearFirst.x + 9, nearFirst.y);
  assert.equal((await read()).closed, true);
  checks.push('overlapping end/start merges the endpoints, closes with one undo and shows a close hint near the start');

  const blocked = { ...openPath, points: openPath.points.map((point, index) => index === 3 ? { ...point, kind: 'curve', inX: openPath.points[0].x > point.x ? 2 : -1, inY: openPath.points[0].y > point.y ? 2 : -1, outX: point.x, outY: point.y } : point) };
  await loadMask(blocked);
  await page.getByRole('button', { name: 'モニターでマスクを編集', exact: true }).click();
  await direct.click(); start = await center(anchor(4)); const blockedFirst = await center(anchor(1));
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(blockedFirst.x, blockedFirst.y, { steps: 5 });
  assert.equal(await page.locator('.bezier-mask-anchor.close-candidate').count(), 0);
  await page.mouse.up(); mask = await read();
  assert.equal(mask.closed, false); assert.equal(mask.points.length, 4);
  checks.push('a handle at its boundary prevents false closure when only the pointer reaches the start');

  // The caller continues its original persistence/export/lock suite from an empty mask.
  await page.locator('#video-mask-type').selectOption('none'); await save();
};
