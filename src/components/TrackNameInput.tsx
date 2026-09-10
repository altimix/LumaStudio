import { useEffect, useState } from 'react';
import { useEditor } from '../store';
import type { Track } from '../types';

export default function TrackNameInput({ track }: { track: Track }) {
  const [draft, setDraft] = useState(track.name);
  useEffect(() => { setDraft(track.name); }, [track.name]);
  return <input aria-label={`トラック名 ${track.name}`} value={draft} disabled={track.locked}
    onChange={e => setDraft(e.target.value)}
    onBlur={e => { if (e.target.value !== track.name) useEditor.getState().updateTrack(track.id, { name: e.target.value }); }}
    onKeyDown={e => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.currentTarget.value = track.name; setDraft(track.name); e.currentTarget.blur(); }
    }}/>
}
