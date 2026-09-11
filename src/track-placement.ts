import { numberTracks } from './track-names';
import { uid } from './model';
import type { Clip, Project } from './types';

import { extraTrackPartitions } from './track-layout';

/** Move only the supplied placements to new lanes; existing edits stay untouched. */
export function separateOverlappingClips(project: Project, ids: string[], newId = uid, reusableTrackIds: readonly string[] = []): Project {
  const selected = new Set(ids), groups = new Map<string, Clip[]>();
  for (const clip of project.clips) if (selected.has(clip.id)) {
    const group = groups.get(clip.trackId) || []; group.push(clip); groups.set(clip.trackId, group);
  }
  const tracks = [...project.tracks], placements = new Map<string, string>();
  const reusable = new Set(reusableTrackIds);
  for (const [trackId, group] of groups) {
    const source = tracks.find(t => t.id === trackId);
    if (!source || source.locked) throw Error('配置先トラックのロックを解除してください。');
    const stationary = project.clips.filter(c => c.trackId === trackId && !selected.has(c.id));
    const emptyReusable = tracks.filter(t => reusable.has(t.id) && !t.locked && !project.clips.some(c => c.trackId === t.id));
    const partitions = extraTrackPartitions(group, stationary, 24 - tracks.length + emptyReusable.length);
    for (const partition of partitions) {
      let track = tracks.find(t => reusable.has(t.id) && !t.locked && !project.clips.some(c => c.trackId === t.id));
      if (track) reusable.delete(track.id);
      else {
        if (tracks.length >= 24) throw Error('重ならないように配置するには新しいトラックが必要です。トラックは最大24本のため、不要なトラックを削除するか空き区間へ配置してください。');
        track = { ...source, id: newId(), name: '', autoName: true };
        // Video overlays appear above their original lane. Keep audio next to its source too.
        tracks.splice(tracks.findIndex(t => t.id === trackId), 0, track);
      }
      for (const clip of partition) placements.set(clip.id, track.id);
    }
  }
  return numberTracks(placements.size ? { ...project, tracks, clips: project.clips.map(c => placements.has(c.id) ? { ...c, trackId: placements.get(c.id)! } : c) } : project);
}
