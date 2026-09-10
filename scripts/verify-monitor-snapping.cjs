const assert = require('node:assert/strict'), path = require('node:path');

// Invoked by the packaged monitor suite; all movement uses native pointer input.
module.exports = async function verifyMonitorSnapping({ page, open, save, project, video, picture, graphic, results, checks }) {
  const measurements = [];
  const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const near = (actual, expected, label, tolerance = 1) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
  const guides = () => page.locator('.monitor-snap-guide');
  const cases = [
    { name: 'video', clip: { ...video, scale: .4, rotation: 0 }, width: 640, height: 360, quality: '1' },
    { name: 'rotated-image-shorts', clip: { ...picture, scale: .4, rotation: 31 }, width: 360, height: 640, quality: '0.25' },
    { name: 'text', clip: { ...graphic, id: 'snap-text', graphic: undefined, text: '位置をそろえる', textBox: { width: 220, height: 64 }, fontSize: 32, scale: .8, rotation: 0 }, width: 640, height: 360, quality: '0.5' },
    { name: 'rotated-graphic', clip: { ...graphic, scale: .65, rotation: -25 }, width: 640, height: 360, quality: '1' },
  ];
  for (const fixture of cases) {
    const clip = { ...fixture.clip, x: 0, y: 0, linkId: undefined, fadeIn: 0, fadeOut: 0 };
    await open({ ...project, width: fixture.width, height: fixture.height, clips: [clip] });
    await page.getByLabel('プレビュー画質', { exact: true }).selectOption(fixture.quality);
    await page.getByLabel('プレビュー画質', { exact: true }).focus();
    const target = clip.kind === 'title' ? page.locator('.title-drag-target') : page.locator(`.media-drag-target[data-media-clip-id="${clip.id}"]`);
    await target.waitFor(); await target.click(); await frames();
    assert.equal(await target.evaluate(element => document.activeElement === element), true, `${fixture.name}: selecting a monitor object takes focus from the quality input`);
    const view = await page.locator('.canvas-wrap').boundingBox();
    if (clip.kind === 'title') {
      const box = await target.boundingBox(), point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      // Titles expose absolute sequence pixels; the stored X is a percentage.
      await page.locator('#prop-x').fill(String(fixture.width * .55));
      await page.keyboard.down('Alt'); await page.mouse.move(point.x, point.y); await page.mouse.down();
      await page.mouse.move(point.x + view.width / 10, point.y, { steps: 8 }); await page.mouse.up(); await page.keyboard.up('Alt'); await frames();
      near((await save()).clips[0].x, 15, 'title drag starts from the committed inspector value', .03);
      await page.keyboard.press('Control+z'); near((await save()).clips[0].x, 5, 'title drag Undo preserves the inspector edit', .03);
      await page.keyboard.press('Control+z'); near((await save()).clips[0].x, 0, 'inspector edit has its own Undo', .03);
    }
    const begin = async (axis, anchor, gap = -2) => {
      await frames();
      const box = await target.boundingBox(), start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const horizontal = axis === 'x', extent = horizontal ? view.width : view.height, half = (horizontal ? box.width : box.height) / 2;
      const coordinate = (horizontal ? view.x : view.y) + (anchor === 'start' ? half + gap : anchor === 'end' ? extent - half - gap : extent / 2 + gap);
      const end = { ...start, [axis]: coordinate };
      assert.equal(await target.evaluate((element, point) => document.elementFromPoint(point.x, point.y) === element, start), true, `${fixture.name} ${axis} ${anchor}: monitor controls must not cover the drag target`);
      // Explicitly approach from the free side, even when the preceding case
      // ended on this edge. A 2px gesture alone is below the drag threshold.
      const contact = coordinate + (anchor === 'end' ? gap : -gap);
      const approach = { ...start, [axis]: contact + (anchor === 'end' || (anchor === 'center' && gap > 0) ? -12 : 12) };
      await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(approach.x, approach.y, { steps: 8 }); await page.mouse.move(end.x, end.y, { steps: 8 }); await frames();
      return { start, end };
    };
    const aligned = async (axis, anchor) => {
      assert.equal(await page.locator(`[data-snap-${axis}="${anchor}"]`).count(), 1, `${fixture.name} ${axis} ${anchor}: visible snap guide`);
      const box = await target.boundingBox(), extent = axis === 'x' ? view.width : view.height;
      const start = (axis === 'x' ? box.x - view.x : box.y - view.y), size = axis === 'x' ? box.width : box.height;
      const actual = start + (anchor === 'end' ? size : anchor === 'center' ? size / 2 : 0);
      const expected = anchor === 'start' ? 0 : anchor === 'end' ? extent : extent / 2;
      near(actual, expected, fixture.name + ' aligned ' + axis + ' ' + anchor);
      measurements.push({ fixture: fixture.name, axis, anchor, errorPixels: actual - expected });
    };
    // Approach freely; after contact hold jitter in either direction. Alt
    // permits a precise inset without needing to move far from the boundary.
    const approach = await begin('x', 'start', 1);
    assert.equal(await page.locator('[data-snap-x]').count(), 0, 'one pixel inside the frame does not snap');
    near((await target.boundingBox()).x - view.x, 1, 'one-pixel inset remains free', .2);
    await page.mouse.move(approach.end.x - 2, approach.end.y); await frames(); await aligned('x', 'start');
    for(const gap of [1,-3,6,-6,7]){await page.mouse.move(approach.end.x+gap-1,approach.end.y);await frames();await aligned('x','start');}
    await page.mouse.move(approach.end.x+8,approach.end.y);await frames();
    assert.equal(await page.locator('[data-snap-x]').count(),0,'nine pixels inside releases contact');
    near((await target.boundingBox()).x-view.x,9,'deliberate movement releases the edge',.2);
    await page.mouse.move(approach.end.x-2,approach.end.y);await frames();await aligned('x','start');
    await page.mouse.move(approach.end.x,approach.end.y);await frames();await aligned('x','start');
    await page.keyboard.down('Alt');await frames();assert.equal(await page.locator('[data-snap-x]').count(),0);
    near((await target.boundingBox()).x - view.x, 1, 'Alt permits a one-pixel inset after contact', .2);
    await page.mouse.up();await page.keyboard.up('Alt'); const inset = await save();
    assert.notEqual(inset.clips[0].x, clip.x);
    await page.keyboard.press('Control+z'); await save();
    for (const [axis, anchor] of [['x','start'],['x','end'],['y','start'],['y','end'],['x','center'],['y','center']]) {
      await begin(axis, anchor); await aligned(axis, anchor); await page.mouse.up(); await frames();
      assert.equal(await guides().count(), 0, 'guides end with gesture');
    }
    const before = await save();
    // Alt changes the current position immediately, without moving the mouse.
    const { end } = await begin('x', 'start'); await aligned('x', 'start');
    await page.keyboard.down('Alt'); await frames(); assert.equal(await guides().count(), 0, 'Alt clears both axes');
    near((await target.boundingBox()).x - view.x, -2, 'Alt restores unsnapped pointer position');
    await page.keyboard.up('Alt'); await frames(); await aligned('x', 'start');
    await page.mouse.move(end.x - 1, end.y); await frames(); await aligned('x', 'start');
    await page.mouse.move(end.x - 5, end.y); await frames(); await aligned('x', 'start');
    await page.mouse.move(end.x - 7, end.y); await frames();
    assert.equal(await page.locator('[data-snap-x]').count(), 0, 'nine pixels outside releases edge');
    near((await target.boundingBox()).x - view.x, -9, 'released edge follows pointer');
    await page.mouse.move(end.x + 3, end.y); await frames();
    assert.equal(await page.locator('[data-snap-x]').count(), 0, 'moving back one pixel inside stays free');
    near((await target.boundingBox()).x - view.x, 1, 'near-edge inset after release', .2);
    await page.mouse.move(end.x + 1, end.y); await frames(); await aligned('x', 'start');
    if (fixture.name === 'video') await page.screenshot({ path: path.join(results, 'preview-snapping.png') });
    await page.mouse.up(); await frames(); assert.equal(await guides().count(), 0);
    const after = await save(); assert.notEqual(after.clips[0].x, before.clips[0].x);
    await page.keyboard.press('Control+z'); const undone = await save();
    near(undone.clips[0].x, before.clips[0].x, 'single Undo restores X', .001); near(undone.clips[0].y, before.clips[0].y, 'single Undo restores Y', .001);
    await page.keyboard.press('Control+Shift+z'); const redone = await save();
    near(redone.clips[0].x, after.clips[0].x, 'single Redo restores snapped X', .001);
    await begin('x', 'end'); await aligned('x', 'end'); await page.keyboard.press('Escape'); await page.mouse.up(); await frames();
    assert.equal(await guides().count(), 0, 'Escape clears snap guides');
    near((await save()).clips[0].x, after.clips[0].x, 'Escape restores position', .001);
    await open(after); await target.waitFor(); await target.click(); await frames();
    near((await target.boundingBox()).x - view.x, 0, 'saved edge reloads');
    const track = project.tracks.find(t => t.id === clip.trackId);
    await page.getByRole('button', { name: track.name + ' ロック', exact: true }).click(); const locked = await save();
    await begin('x', 'end'); await page.mouse.up(); await frames(); assert.equal(await guides().count(), 0);
    near((await save()).clips[0].x, locked.clips[0].x, 'locked placement is unchanged', .001);
    checks.push(`${fixture.name}: free approach, bidirectional 8px snap hold and 9px release, one-pixel Alt inset, four edges and center, rotated bounds, Undo/Redo, Escape, save/reload and locks`);
  }
  return measurements;
};
