import { useEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import { Modal } from './UI';
type Entry = { id: string; projectId: string; name: string; savedAt: string; clips: number };
export default function BackupHistory({ onClose, onRestore }: { onClose: () => void; onRestore: (project: Project) => void }) {
  const [entries, setEntries] = useState<Entry[]>([]), [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [projectId, setProjectId] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { let alive = true; void window.luma?.listBackups().then(items => { if (alive) setEntries(items); }).catch(e => { if (alive) setError(String(e)); }).finally(() => { if (alive) setBusy(false); }); return () => { alive = false; }; }, []);
  const restore = async (id: string) => {
    if (busy || !window.luma) return;
    setBusy(true); setError('');
    try { const snapshot = await window.luma.readBackup(id); if (mounted.current) onRestore(snapshot.project); }
    catch (e) { if (mounted.current) setError(String(e)); } finally { if (mounted.current) setBusy(false); }
  };
  const projectNames = new Map<string, string>();
  for (const entry of entries) if (!projectNames.has(entry.projectId)) projectNames.set(entry.projectId, entry.name);
  const projects = [...projectNames.entries()];
  return <Modal title="バックアップ履歴" blockEditorShortcuts onClose={() => { if (!busy) onClose(); }}>
    <p className="modal-description">プロジェクトごとに最近の自動保存を10世代保持します。復元後は「名前を付けて保存」で保存先を選べます。素材の原本はバックアップに含まれません。</p>
    <div className="backup-history-body">
    <label>プロジェクト<select aria-label="バックアップのプロジェクト" disabled={busy} value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">すべて</option>{projects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
    {error ? <p role="alert">{error}</p> : null}
    {busy ? <p role="status">バックアップを読み込んでいます…</p> : !entries.length ? <p>復元できるバックアップはありません。</p> : null}
    <div className="backup-list">{entries.filter(entry => !projectId || entry.projectId === projectId).map(entry => <article key={entry.id}><div><strong>{entry.name}</strong><span>{new Date(entry.savedAt).toLocaleString('ja-JP')} · {entry.clips}クリップ</span></div><button className="secondary-button" disabled={busy} onClick={() => { void restore(entry.id); }}>この版を復元</button></article>)}</div>
    </div>
  </Modal>;
}
