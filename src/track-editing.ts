import { clipsLocked, linkedIds } from '../shared/clip-links.mjs';
import type { Project } from './types';

export function trackDeletionReason(project: Project, trackId: string): string {
  const track = project.tracks.find(t => t.id === trackId);
  if (!track) return 'トラックが見つかりません';
  if (project.tracks.length <= 1) return 'トラックは最低1本残してください';
  const ids = project.clips.filter(c => c.trackId === trackId).map(c => c.id);
  const deleted = new Set(ids);
  const transitionPartners = (project.transitions || [])
    .filter(t => deleted.has(t.fromId) || deleted.has(t.toId))
    .flatMap(t => [t.fromId, t.toId]);
  return track.locked || clipsLocked(project, [...linkedIds(project, ids), ...transitionPartners])
    ? 'リンク相手・つなぎ目の相手を含むトラックのロックを解除してください' : '';
}
