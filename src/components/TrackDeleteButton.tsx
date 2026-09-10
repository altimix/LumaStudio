import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash2 } from 'lucide-react';
import { useEditor } from '../store';
import type { Project, Track } from '../types';
import { trackDeletionReason } from '../track-editing';
import { IconButton, Modal } from './UI';

export default function TrackDeleteButton({ track, project }: { track: Track; project: Project }) {
  const [confirmation, setConfirmation] = useState<Project | null>(null);
  const ids = project.clips.filter(c => c.trackId === track.id).map(c => c.id);
  const reason = trackDeletionReason(project, track.id);
  const close = () => setConfirmation(null);
  return <>
    <IconButton label={`${track.name} トラックを削除${reason ? `（${reason}）` : ''}`} disabled={!!reason} onClick={() => {
      const s = useEditor.getState(); if (s.gestureActive) return;
      s.stop(); if (ids.length) setConfirmation(project); else s.removeTrack(track.id);
    }}><Trash2 size={13}/></IconButton>
    {confirmation === project && createPortal(<div onKeyDown={e => e.stopPropagation()}>
      <Modal title="トラックを削除しますか？" onClose={close}>
        <p className="modal-description">「{track.name}」と、このトラックに配置した素材 {ids.length} 個を削除します。<br/>他のトラックの素材と、プロジェクト内の元素材は残ります。リンク相手がある場合はリンクを解除します。Ctrl+Zで元に戻せます。</p>
        <div className="modal-footer"><button className="secondary-button" onClick={close}>キャンセル</button><button className="primary-button" onClick={() => { if (useEditor.getState().project === confirmation && useEditor.getState().removeTrack(track.id)) close(); }}>トラックと素材を削除</button></div>
      </Modal>
    </div>, document.body)}
  </>;
}
