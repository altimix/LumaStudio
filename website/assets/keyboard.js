(() => {
  const host = document.querySelector('#keyboard-guide');
  if (!host) return;
  const bindings = [...document.querySelectorAll('[data-command] kbd[data-key]')].map(key => ({
    key: key.dataset.key.toLowerCase(), ctrl: key.hasAttribute('data-ctrl'), shift: key.hasAttribute('data-shift'),
    title: key.closest('tr').querySelector('th').textContent,
    detail: key.closest('tr').lastElementChild.textContent,
  }));
  host.hidden = false;
  host.innerHTML = `<h3>キーの位置から、操作を覚える</h3>
    <p>緑のキーに操作が割り当てられています。キーをクリック／タップすると、下に詳しい説明が表示されます。</p>
    <div class="kb-controls"><label>使うパソコン <select id="kb-platform"><option value="win">Windows</option><option value="mac">Mac</option></select></label>
    <label>同時に押すキー <select id="kb-modifier"><option value="none">なし（キー単独）</option><option value="shift">Shift</option><option value="ctrl">Ctrl</option><option value="both">Ctrl + Shift</option></select></label></div>
    <p class="kb-caption">文字キーはQWERTY配列の概略図です。記号・補助キーは下にまとめています。JIS／USや機種により位置が異なります。</p>
    <div class="kb-board" aria-label="ショートカットのキーボード図"></div>
    <div class="kb-detail" role="status" aria-live="polite"></div>
    <p class="kb-mac-note" hidden>Macでは⌘ Commandを使用できます（Controlも対応）。図のBackspaceはMacのdelete（⌫）です。Home / Endなどは機種によってFnとの組み合わせが必要です。</p>
    <p>図は通常の編集ショートカットです。入力欄・日本語変換中や、音量ポイントなどにフォーカスがある場合の操作は、下の一覧を確認してください。</p>`;
  const platform = host.querySelector('#kb-platform'), modifier = host.querySelector('#kb-modifier');
  const board = host.querySelector('.kb-board'), detail = host.querySelector('.kb-detail');
  let selected = ' ';
  const rows = ['1234567890'.split(''), 'qwertyuiop'.split(''), 'asdfghjkl'.split(''), 'zxcvbnm'.split(''), [' ', 'arrowleft', 'arrowright'], ['home', 'end', 'backspace', 'delete', '+', '=', '-', '?']];
  const names = { ' ': 'Space', arrowleft: '←', arrowright: '→', home: 'Home', end: 'End', backspace: 'Backspace', delete: 'Delete' };
  function matches(key) {
    return bindings.filter(b => b.key === key && b.ctrl === ['ctrl', 'both'].includes(modifier.value) && b.shift === ['shift', 'both'].includes(modifier.value));
  }
  function label(key) { return platform.value === 'mac' && key === 'backspace' ? 'delete ⌫' : names[key] || key.toUpperCase(); }
  function describe() {
    const found = matches(selected);
    const prefix = {none: '', shift: 'Shift + ', ctrl: platform.value === 'mac' ? '⌘ + ' : 'Ctrl + ', both: platform.value === 'mac' ? '⌘ + Shift + ' : 'Ctrl + Shift + '}[modifier.value];
    detail.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = prefix + label(selected) + ' — ' + (found[0]?.title || '通常の編集操作の割り当てなし');
    const text = document.createElement('p');
    text.textContent = found[0]?.detail || '別のキーや、同時に押すキーを選んでください。';
    detail.append(title, text);
    board.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.key === selected)));
  }
  function draw() {
    modifier.options[2].textContent = platform.value === 'mac' ? '⌘ Command' : 'Ctrl';
    modifier.options[3].textContent = platform.value === 'mac' ? '⌘ Command + Shift' : 'Ctrl + Shift';
    host.querySelector('.kb-mac-note').hidden = platform.value !== 'mac';
    board.replaceChildren();
    rows.forEach((keys, index) => {
      const row = document.createElement('div'); row.className = 'kb-row kb-row-' + index;
      keys.forEach(key => {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.key = key;
        const binding = matches(key)[0];
        button.className = 'kb-key' + (binding ? ' kb-assigned' : '') + (key === ' ' ? ' kb-space' : '');
        button.textContent = label(key);
        button.setAttribute('aria-label', label(key) + '：' + (binding?.title || '割り当てなし'));
        button.title = binding?.title || '割り当てなし';
        button.addEventListener('click', () => { selected = key; describe(); });
        row.append(button);
      });
      board.append(row);
    });
    describe();
  }
  platform.addEventListener('change', draw); modifier.addEventListener('change', draw); draw();
})();
