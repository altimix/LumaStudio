const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
module.exports = async function verifyTransitionDelete({ app, page, save, file, baseline, checks, results }) {
  const transition = () => page.locator('.timeline-transition').first(), menu = () => page.getByRole('menu', { name: 'トランジションの編集', exact: true });
  const action = () => menu().getByRole('menuitem', { name: 'トランジションを削除', exact: true });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 760));
  await transition().click({ button: 'right' }); await menu().waitFor(); const bounds = await menu().boundingBox(), view = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= view.width && bounds.y + bounds.height <= view.height);
  await page.screenshot({ path: path.join(results, 'timeline-transition-delete.png') }); await action().click();
  await transition().waitFor({ state: 'hidden' }); let saved = await save(); assert.deepEqual(saved.clips, baseline.clips); assert.equal(saved.transitions.length, 0);
  await page.keyboard.press('Control+z'); await transition().waitFor(); assert.deepEqual((await save()).transitions, baseline.transitions); await page.keyboard.press('Control+Shift+z'); await transition().waitFor({ state: 'hidden' }); await page.keyboard.press('Control+z'); await transition().waitFor();
  checks.push('timeline right-click removes only the transition, preserves exact clips, supports Undo/Redo, and fits a small window');
  await transition().focus(); await page.keyboard.press('Shift+F10'); await menu().waitFor(); await page.keyboard.press('Escape'); await menu().waitFor({ state: 'hidden' });
  for (const key of ['Delete', 'Backspace']) { await transition().focus(); await page.keyboard.press(key); await transition().waitFor({ state: 'hidden' }); assert.deepEqual((await save()).clips, baseline.clips); await page.keyboard.press('Control+z'); await transition().waitFor(); }
  const track = baseline.tracks.find(t => t.id === baseline.clips[0].trackId); await page.getByRole('button', { name: track.name + ' ロック', exact: true }).click(); await transition().click({ button: 'right' }); assert.ok(await action().isDisabled()); await page.keyboard.press('Escape'); await transition().focus(); await page.keyboard.press('Delete'); assert.equal((await save()).transitions.length, 1); await page.getByRole('button', { name: track.name + ' ロック解除', exact: true }).click();
  checks.push('Delete and Backspace target the focused effect, Escape dismisses the keyboard menu, and locked transitions are protected');
  for (const [kind, options] of [['video', { video: 'pageTurn' }], ['audio', { audio: 'constantGain' }], ['both', { video: 'dissolve', audio: 'constantPower' }]]) {
    const fixture = { ...baseline, id: 'remove-' + kind, name: '効果だけ削除 ' + kind, transitions: [{ ...baseline.transitions[0], video: undefined, audio: undefined, ...options }] };
    await save(); await fs.writeFile(file, JSON.stringify(fixture)); await page.keyboard.press('Control+o'); await page.getByRole('button', { name: fixture.name, exact: true }).waitFor();
    await transition().focus(); await page.keyboard.press('Shift+F10'); await menu().waitFor(); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await transition().waitFor({ state: 'hidden' }); saved = await save(); assert.deepEqual(saved.clips, fixture.clips); assert.equal(saved.transitions.length, 0);
    await page.keyboard.press('Control+o'); await page.waitForFunction(() => document.querySelector('button[aria-label="元に戻す (Ctrl+Z)"]')?.disabled); assert.equal((await save()).transitions.length, 0);
  }
  checks.push('keyboard menus remove video, audio and combined effects, and the unchanged clip layout survives save/reload');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000)); await save(); await fs.writeFile(file, JSON.stringify(baseline)); await page.keyboard.press('Control+o'); await page.getByRole('button', { name: baseline.name, exact: true }).waitFor();
  await page.locator(`.timeline-clip[data-clip-id="${baseline.clips[1].id}"]`).focus(); await page.keyboard.press('Enter');
};
