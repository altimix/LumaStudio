export type EditorCommand = 'play' | 'splitAll' | 'trimPrevious' | 'trimNext' | 'zoomIn' | 'zoomOut' | 'rippleDelete' | 'backFrame' | 'forwardFrame' | 'backTen' | 'forwardTen' | 'reverse' | 'stop' | 'forward' | 'undo' | 'redo' | 'split' | 'delete' | 'duplicate' | 'copy' | 'paste' | 'selectAll' | 'save' | 'saveAs' | 'open' | 'new' | 'import' | 'export' | 'home' | 'end' | 'selectTool' | 'razorTool' | 'snap' | 'marker' | 'help';
type Key = { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; isComposing: boolean; repeat: boolean; keyCode?: number };

export function shortcutCommand(event: Key, honorRepeat = true): EditorCommand | undefined {
  if (event.isComposing || event.keyCode === 229 || event.altKey) return;
  const key = event.key.toLowerCase(); let command: EditorCommand | undefined;
  if (event.ctrlKey || event.metaKey) {
    const normal: Record<string, EditorCommand> = { z: 'undo', y: 'redo', b: 'split', d: 'duplicate', c: 'copy', v: 'paste', a: 'selectAll', s: 'save', o: 'open', n: 'new', i: 'import', e: 'export' };
    command = event.shiftKey ? ({ z: 'redo', s: 'saveAs' } as Record<string, EditorCommand>)[key] : normal[key];
  } else if (event.shiftKey && !['+', '?'].includes(key)) {
    command = ({ d: 'rippleDelete', delete: 'rippleDelete', backspace: 'rippleDelete', e: 'backTen', arrowleft: 'backTen', r: 'forwardTen', arrowright: 'forwardTen' } as Record<string, EditorCommand>)[key];
  } else {
    command = ({ '1': 'play', ' ': 'play', z: 'splitAll', q: 'trimPrevious', w: 'trimNext', a: 'zoomIn', s: 'zoomOut', e: 'backFrame', arrowleft: 'backFrame', r: 'forwardFrame', arrowright: 'forwardFrame', j: 'reverse', k: 'stop', l: 'forward', home: 'home', end: 'end', v: 'selectTool', c: 'razorTool', n: 'snap', m: 'marker', delete: 'delete', backspace: 'delete', '+': 'zoomIn', '=': 'zoomIn', '-': 'zoomOut', '?': 'help' } as Record<string, EditorCommand>)[key];
  }
  // Only navigation repeats while held; destructive commands and shuttle acceleration require a fresh press.
  if (honorRepeat && event.repeat && !['backFrame', 'forwardFrame', 'backTen', 'forwardTen', 'zoomIn', 'zoomOut'].includes(command || '')) return;
  return command;
}

export const shortcutList = [
  ['1 / Space', '再生 / 停止', '再生停止'],
  ['Z', '編集点をすべてのトラックに追加', '編集点 全トラック カット'],
  ['Q', '前の編集ポイントを再生ヘッドまでリップルトリミング', '前の編集'],
  ['W', '次の編集ポイントまでリップルトリミング', '後の編集'],
  ['A / +', 'タイムラインをズームイン', 'ズーム 拡大'],
  ['S / −', 'タイムラインをズームアウト', 'ズーム 縮小'],
  ['Shift + D / Shift + Delete', '選択クリップをリップル削除', 'リップル削除'],
  ['E / Left (←)', '1フレーム戻る（Shiftで10フレーム）', '複数フレーム 戻る'],
  ['R / Right (→)', '1フレーム進む（Shiftで10フレーム）', '複数フレーム 先へ'],
  ['J', 'シャトル戻る・逆再生（連打で最大16倍）', 'シャトル戻る'],
  ['K', 'シャトル停止', 'シャトル停止 一時停止'],
  ['L', 'シャトル進む・早送り（連打で最大16倍）', 'シャトル進む'],
  ['Ctrl + Z', '元に戻す', 'Undo ヒストリー'],
  ['Ctrl + Shift + Z / Ctrl + Y', 'やり直す', 'Redo ヒストリー'],
  ['Ctrl + B', '選択クリップに編集点を追加', '分割'],
  ['Delete / Backspace', '選択クリップを削除', '削除'],
  ['Ctrl + D', '選択クリップを複製', '複製'],
  ['Ctrl + C / Ctrl + V', 'コピー / 再生ヘッドに貼り付け', 'コピー 貼り付け'],
  ['Ctrl + A', 'すべてのクリップを選択', '全選択'],
  ['Ctrl + S / Ctrl + Shift + S', '保存 / 名前を付けて保存', '保存'],
  ['Ctrl + O / Ctrl + N', 'プロジェクトを開く / 新規作成', '開く 新規'],
  ['Ctrl + I / Ctrl + E', '素材を読み込む / 動画を書き出す', '読み込み 書き出し'],
  ['Home / End', '先頭 / 末尾へ移動', '移動'],
  ['V', '選択ツール（空白をドラッグで範囲選択・Shiftで追加）', 'ツール 範囲選択 複数 素材'],
  ['C', 'レーザーツール', 'ツール カット'],
  ['N / M', 'スナップ切替 / マーカーを追加', 'スナップ マーカー'],
  ['?', 'ショートカット一覧を開く', 'ヘルプ'],
];
