import { useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { useEditor } from '../store';
import { timecode } from '../model';
import { Modal } from './UI';
import type { Project } from '../types';
import './frame-save.css';

export default function FrameSaveDialog({ project, time, capture, onClose }: { project: Project; time: number; capture: () => Promise<string>; onClose: () => void }) {
  const [format, setFormat] = useState<'png' | 'jpg'>('png');
  const [addToProject, setAddToProject] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<{ path: string; message: string } | null>(null);
  const running = useRef(false);
  const generation = useRef(useEditor.getState().projectGeneration);
  const save = async () => {
    if (running.current || !window.luma) return;
    running.current = true; setBusy(true); setError('');
    try {
      const initial = useEditor.getState();
      if (initial.project !== project || initial.projectGeneration !== generation.current || initial.gestureActive) throw new Error('編集中のプロジェクトが変更されました。閉じてからもう一度保存してください。');
      if (addToProject && initial.project.assets.length >= 2000) throw new Error('素材は最大2000個です。チェックを外すと写真だけ保存できます。');
      const png = await capture();
      const result = await window.luma.saveFrame({ name: project.name, time, fps: project.fps, width: project.width, height: project.height, format, addToProject, png });
      if (!result) return;
      let message = '写真を保存しました。';
      if (result.asset) {
        const current = useEditor.getState();
        if (current.project !== project || current.projectGeneration !== generation.current || current.gestureActive || current.project.assets.length >= 2000) message += ' プロジェクトが変更されたため、素材への追加は行いませんでした。';
        else { current.importAssets([result.asset]); current.setPanel('media'); message = '写真を保存し、プロジェクトの素材に追加しました。'; }
      }
      setSaved({ path: result.path, message: result.warning ? `${message}\n${result.warning}` : message });
    } catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')); }
    finally { running.current = false; setBusy(false); }
  };
  return <Modal title="現在のコマを保存" blockEditorShortcuts onClose={() => { if (!running.current) onClose(); }}>
    {saved ? <><div className="frame-save-form"><p role="status">{saved.message}</p><p className="frame-save-path">{saved.path}</p></div><div className="modal-footer"><button className="secondary-button" onClick={() => { void window.luma?.reveal(saved.path).catch(e => setError(e.message)); }}>保存先を開く</button><button className="primary-button" onClick={onClose}>閉じる</button></div></> : <>
      <div className="frame-save-form">
        <p>テロップや図形を含めた、現在の編集画面を写真として保存します。</p>
        <p className="subtle">{timecode(time, project.fps)} · {project.width} × {project.height}</p>
        <label className="frame-format">画像形式<select value={format} disabled={busy} onChange={e => setFormat(e.target.value as 'png' | 'jpg')}><option value="png">PNG（劣化なし）</option><option value="jpg">JPEG（ファイルサイズを小さく）</option></select></label>
        <label className="frame-add"><input type="checkbox" checked={addToProject} disabled={busy} onChange={e => setAddToProject(e.target.checked)}/>プロジェクトの素材にも追加</label>
        <p className="subtle">ファイル名はプロジェクト名とタイムコードから自動で付けます。次の画面で保存先と名前を変更できます。</p>
        {busy ? <p role="status">写真を準備・保存しています…</p> : null}
      </div>
      <div className="modal-footer"><button className="secondary-button" disabled={busy} onClick={onClose}>キャンセル</button><button className="primary-button" disabled={busy} onClick={() => { void save(); }}><Camera size={16}/>保存先を選んで保存</button></div>
    </>}
    {error ? <div className="export-error" role="alert">{error}</div> : null}
  </Modal>;
}
