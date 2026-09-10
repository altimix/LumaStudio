import { useState } from 'react';
import { shortcutList } from '../shortcuts';
import { Modal } from './UI';
export default function ShortcutHelp({ onClose }: { onClose(): void }) {
  const [query, setQuery] = useState('');
  const terms = query.trim().toLowerCase().split(/\s+/);
  const matches = shortcutList.filter(row => terms.every(term => row.join(' ').toLowerCase().includes(term)));
  return <Modal title="キーボードショートカット" onClose={onClose} wide>
    <p className="modal-description">左手でカット、再生、ズーム。入力中・日本語変換中は編集キーが動作しません。MacではCtrlをCommand（⌘）、Deleteをdeleteと読み替えてください。</p>
    <label className="shortcut-search">機能名・キーで検索<input type="search" aria-label="ショートカットを検索" placeholder="再生停止、編集点、リップル削除、J…" value={query} onChange={e => setQuery(e.target.value)}/></label>
    <div className="shortcut-list">{matches.map(([key, action]) => <div key={key}><span>{action}</span><kbd>{key}</kbd></div>)}{!matches.length ? <p>一致するショートカットがありません。</p> : null}</div>
    <div className="about-note">Q / Wは全トラックを同じ時間だけ詰めます。影響するロック済み素材がある場合は変更しません。<br/>J / Lは1 → 2 → 4 → 8 → 16倍。音声も同じ方向・倍率で再生します。Kで停止し、Lで順方向1倍に戻ります。速度に応じて音の高さも変わります。<br/>ウィンドウ → ヒストリーから保持中の編集状態を選んで復元できます。スナップ切替はNです。</div>
  </Modal>;
}
