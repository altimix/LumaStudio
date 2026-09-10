const normalizeLines = text => text.replace(/\r\n/g, '\n');

async function copyText(clipboard, text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 100000 || text.includes('\0')) {
    throw new Error('コピーするテキストは空白だけにせず、100,000文字以内にしてください。使用できない文字が含まれていないか確認してください。');
  }
  try {
    await clipboard.writeText(text);
    // Verify the completed write without exposing clipboard reads to the renderer.
    if (normalizeLines(await clipboard.readText()) !== normalizeLines(text)) throw new Error('Clipboard write mismatch');
  } catch {
    throw new Error('クリップボードにコピーできませんでした。もう一度コピーするか、「テキスト保存」を利用してください。');
  }
}

module.exports = { copyText };
