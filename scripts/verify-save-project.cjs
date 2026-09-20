const fs = require('node:fs/promises');

module.exports = async function saveProject(page, file) {
  // A previous success toast must not satisfy this save's completion check.
  // Close it atomically because its expiry timer can also remove it.
  await page.evaluate(() => document.querySelector('.toast button[aria-label="通知を閉じる"]')?.click());
  await page.locator('.toast').waitFor({ state: 'hidden' });
  await page.keyboard.press('Control+s');
  // File replacement and the dirty flag precede recovery cleanup. The success
  // toast is emitted after cleanup, when another save can safely begin.
  await page.locator('.toast').filter({ hasText: 'プロジェクトを保存しました' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.unsaved-dot'));
  return JSON.parse(await fs.readFile(file, 'utf8'));
};
