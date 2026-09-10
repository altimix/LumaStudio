const { test } = require('node:test');
const assert = require('node:assert/strict');
const { copyText } = require('../electron/clipboard.cjs');

test('clipboard keeps Japanese text and accepts Windows line-ending conversion', async () => {
  let value = '以前のコピー';
  const clipboard = { writeText: async text => { await new Promise(resolve => setImmediate(resolve)); value = text.replace(/\n/g, '\r\n'); }, readText: async () => value };
  const text = '概要欄🎬\n\n00:00 はじめに\n00:10 動画編集\n00:20 まとめ';
  await copyText(clipboard, text);
  assert.equal(value.replace(/\r\n/g, '\n'), text);
});

test('invalid clipboard payloads never overwrite the current clipboard', async () => {
  const clipboard = { writeText: () => assert.fail('invalid input reached OS clipboard') };
  for (const text of [null, undefined, 1, {}, '', ' \n　', 'x'.repeat(100001), '途中\0欠落']) {
    await assert.rejects(copyText(clipboard, text), /コピーするテキスト/);
  }
});

test('clipboard write/read exceptions and silent write failure do not report success or leak contents', async () => {
  for (const clipboard of [
    { writeText: async () => { throw new Error('private clipboard value'); } },
    { writeText: async () => {}, readText: async () => { throw new Error('private clipboard value'); } },
    { writeText: () => {}, readText: () => 'private clipboard value' }
  ]) {
    await assert.rejects(copyText(clipboard, '投稿文'), e => /コピーできません/.test(e.message) && !e.message.includes('private'));
  }
});
