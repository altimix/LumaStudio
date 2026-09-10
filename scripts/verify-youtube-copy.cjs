const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async function verifyYouTubeCopy(app, page, checks, results, postingText) {
  // Materialize every format in the main process before writing, never return
  // the user's clipboard to the test runner or put it in artifacts.
  await app.evaluate(async ({ clipboard, ClipboardItem }) => {
    const items = await clipboard.read();
    // A clean Windows session can return an empty item for an empty clipboard.
    // ClipboardItem cannot be constructed without a MIME type; restore [] there.
    globalThis.__copySnapshot = await Promise.all(items.filter(item => item.types.length > 0).map(async item => new ClipboardItem(Object.fromEntries(
      await Promise.all(item.types.map(async type => {
        const value = await item.getType(type);
        return [type, type === 'electron application/bookmark' ? value : new Blob([await value.arrayBuffer()], { type: value.type })];
      }))
    ))));
    globalThis.__copyOriginalWrite = clipboard.writeText.bind(clipboard);
    globalThis.__copyLastWritten = undefined;
    clipboard.writeText = async text => {
      if (globalThis.__copyFail) throw new Error('simulated clipboard failure');
      if (globalThis.__copyDrop) return;
      await globalThis.__copyOriginalWrite(text);
      globalThis.__copyLastWritten = text;
    };
  });
  const normalize = text => text.replace(/\r\n/g, '\n');
  const read = () => app.evaluate(async ({ clipboard }) => clipboard.readText());
  const clickCopy = async (name, expected) => {
    await page.getByRole('button', { name, exact: true }).click();
    await page.locator('.yt-copy-status.visible').waitFor();
    assert.equal(normalize(await read()), normalize(expected), name);
    assert.equal(await page.locator('.yt-error').count(), 0);
    const bounds = await page.locator('.yt-copy-status').boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height, 'copy feedback stays visible');
  };
  try {
    const browserSentinel = 'Luma browser clipboard permission test';
    const browserRejected = await page.evaluate(async text => {
      try { await navigator.clipboard.writeText(text); return false; } catch { return true; }
    }, browserSentinel);
    if (!browserRejected) await app.evaluate((_, text) => { globalThis.__copyLastWritten = text; }, browserSentinel);
    assert.equal(browserRejected, true, 'the general browser clipboard permission stays denied');
    assert.equal((await page.evaluate(() => window.luma.aiStatus())).textModel, 'gpt-6-astra');
    assert.equal(await page.evaluate(() => 'readClipboard' in window.luma || 'readText' in window.luma), false);
    for (let i = 1; i <= 3; i++) {
      await clickCopy(`タイトル案${i}をコピー`, await page.getByRole('textbox', { name: `YouTubeタイトル案${i}`, exact: true }).inputValue());
    }
    const description = page.getByRole('textbox', { name: 'YouTube概要欄', exact: true });
    const originalDescription = await description.inputValue();
    const chapterText = '\n\n【チャプター】\n00:00 日本語字幕を作成\n00:12 タイムライン編集\n00:24 投稿準備と書き出し';
    const hashtags = page.getByRole('textbox', { name: 'YouTubeハッシュタグ', exact: true });
    const originalHashtags = await hashtags.inputValue(), footer = '\n\n' + originalHashtags;
    assert.equal(originalHashtags, '#動画編集 #日本語字幕 #YouTube制作');
    await clickCopy('概要欄をチャプター付きでコピー', originalDescription + chapterText + footer);
    assert.equal(await page.getByRole('textbox', { name: 'チャプター・ハッシュタグ付きの概要欄', exact: true }).inputValue(), originalDescription + chapterText + footer);
    await page.getByRole('textbox', { name: 'チャプター・ハッシュタグ付きの概要欄', exact: true }).scrollIntoViewIfNeeded();
    await page.getByRole('textbox', { name: 'チャプター・ハッシュタグ付きの概要欄', exact: true }).evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.screenshot({ path: path.join(results, 'youtube-hashtags.png') });
    await clickCopy('投稿素材を一括コピー', postingText);
    const keywords = page.getByRole('textbox', { name: 'YouTube検索ワード', exact: true });
    const originalKeywords = await keywords.inputValue();
    await clickCopy('検索ワードをコピー', originalKeywords);
    // A real Ctrl+V in an editable renderer field, without another clipboard API.
    await description.fill(''); await description.press('ControlOrMeta+v');
    assert.equal(await description.inputValue(), originalKeywords);
    await description.fill(originalDescription); await description.blur();
    checks.push('all six posting-text buttons write the native clipboard and Ctrl+V pastes Japanese text');

    const title = page.getByRole('textbox', { name: 'YouTubeタイトル案1', exact: true });
    const originalTitle = await title.inputValue();
    await title.fill('編集直後のタイトル🎬'); await clickCopy('タイトル案1をコピー', '編集直後のタイトル🎬');
    await title.fill(originalTitle); await title.blur();
    const editedKeywords = originalKeywords.replace('動画編集', '編集直後の検索語');
    await keywords.fill(editedKeywords); await clickCopy('検索ワードをコピー', editedKeywords);
    await clickCopy('投稿素材を一括コピー', postingText.replace(originalKeywords, editedKeywords));
    await keywords.fill(originalKeywords); await keywords.blur();
    await description.fill('日本語の概要欄🎬\n二行目の説明');
    await clickCopy('概要欄をチャプター付きでコピー', '日本語の概要欄🎬\n二行目の説明' + chapterText + footer);
    await description.fill(originalDescription); await description.blur();
    const chapterTime = page.getByRole('spinbutton', { name: 'チャプター1の秒', exact: true });
    await chapterTime.fill('1'); await clickCopy('概要欄をチャプター付きでコピー', originalDescription + footer);
    await chapterTime.fill('0'); await chapterTime.blur();
    checks.push('immediate title, description and keyword edits are copied; invalid chapters are omitted');

    await hashtags.fill('＃編集，字幕,YouTube制作');
    await clickCopy('概要欄をチャプター付きでコピー', originalDescription + chapterText + '\n\n#編集 #字幕 #YouTube制作');
    await clickCopy('投稿素材を一括コピー', postingText.replace(originalHashtags, '#編集 #字幕 #YouTube制作'));
    await hashtags.fill('同じ 同じ'); assert.equal(await page.getByRole('button', { name: '投稿素材を一括コピー', exact: true }).isDisabled(), true);
    await hashtags.fill(''); await clickCopy('概要欄をチャプター付きでコピー', originalDescription + chapterText);
    await hashtags.fill(originalHashtags); await hashtags.blur();
    checks.push('generated hashtags are last after chapters in preview, native copy and text export; immediate edits normalize #, duplicate drafts block copy, clearing removes footer');

    await keywords.fill(Array.from({ length: 11 }, (_, i) => `語${i}`).join(','));
    for (const name of ['タイトル案1をコピー', '概要欄をチャプター付きでコピー', '投稿素材を一括コピー', '検索ワードをコピー']) {
      assert.equal(await page.getByRole('button', { name, exact: true }).isDisabled(), true);
    }
    await keywords.fill(originalKeywords); await keywords.blur();
    const beforeInvalid = await read();
    for (const payload of [null, {}, '', ' \n', 'a'.repeat(100001), 'NUL\0value']) {
      const rejected = await page.evaluate(async text => { try { await window.luma.copyText(text); return false; } catch { return true; } }, payload);
      assert.equal(rejected, true); assert.equal(await read(), beforeInvalid);
    }
    // A different WebContents cannot access the privileged clipboard channel.
    assert.equal(await app.evaluate(async ({ BrowserWindow }) => {
      const foreign = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
      try {
        await foreign.loadURL('about:blank');
        return await foreign.webContents.executeJavaScript("require('electron').ipcRenderer.invoke('copy-text', 'forbidden').then(() => false, () => true)");
      } finally { foreign.destroy(); }
    }), true);
    assert.equal(await read(), beforeInvalid);
    checks.push('invalid drafts, malformed IPC values and foreign senders cannot replace the clipboard');

    for (const failure of ['__copyFail', '__copyDrop']) {
      await app.evaluate((_, flag) => { globalThis[flag] = true; }, failure);
      await page.getByRole('button', { name: '検索ワードをコピー', exact: true }).click();
      await page.locator('.yt-error').filter({ hasText: 'コピーできませんでした' }).waitFor();
      assert.equal(await page.locator('.yt-copy-status').textContent(), '');
      assert.equal(await read(), beforeInvalid);
      await app.evaluate((_, flag) => { globalThis[flag] = false; }, failure);
    }
    await clickCopy('検索ワードをコピー', originalKeywords);
    // Saved posting text remains copyable after the API key is removed.
    await page.evaluate(() => window.luma.aiClearKey());
    await clickCopy('投稿素材を一括コピー', postingText);
    await page.screenshot({ path: path.join(results, 'youtube-copy.png') });
    checks.push('write rejection and silent failure show visible errors; retry and copying without an API key succeed');
  } finally {
    await app.evaluate(async ({ clipboard }) => {
      clipboard.writeText = globalThis.__copyOriginalWrite;
      globalThis.__copyFail = false; globalThis.__copyDrop = false;
      // Do not overwrite a clipboard value the user changed during this test.
      if (globalThis.__copyLastWritten !== undefined && (await clipboard.readText()).replace(/\r\n/g, '\n') === globalThis.__copyLastWritten.replace(/\r\n/g, '\n')) {
        if (globalThis.__copySnapshot.length) await clipboard.write(globalThis.__copySnapshot);
        else clipboard.clear();
      }
      delete globalThis.__copySnapshot; delete globalThis.__copyOriginalWrite; delete globalThis.__copyLastWritten;
    });
  }
};
