import { History, X } from 'lucide-react';
import { useEditor } from '../store';
import { IconButton } from './UI';
export default function HistoryPanel({ onClose }: { onClose(): void }) {
  const before = useEditor(s => s.historyLabels); const current = useEditor(s => s.currentAction); const after = useEditor(s => s.futureLabels);
  const labels = [...before, current, ...after];
  return <aside className="history-panel panel" aria-label="ヒストリー" onKeyDown={e => { if (e.key === ' ') e.stopPropagation(); }}>
    <div className="panel-heading"><div className="panel-title"><History size={15}/>ヒストリー</div><IconButton label="ヒストリーを閉じる" onClick={onClose}><X size={15}/></IconButton></div>
    <p>状態を選んで戻る・進む<br/><small>最大80操作。再起動後は保持されません。</small></p>
    <ol>{labels.map((label, index) => <li key={index}><button className={index > before.length ? 'history-future' : ''} aria-current={index === before.length ? 'step' : undefined} onClick={() => useEditor.getState().restoreHistory(index)}><span>{String(index).padStart(2, '0')}</span><strong>{label}</strong>{index === before.length ? <small>現在</small> : null}</button></li>)}</ol>
    <div className="history-footer">{before.length}操作前に戻れます · {after.length}操作をやり直せます</div>
  </aside>;
}
