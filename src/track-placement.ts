import { trackAcceptsClip, AUDIO_TRACK_MESSAGE } from './track-compatibility';
import { numberTracks } from './track-names';
import { uid, makeTrack } from './model';
import type { Clip, Project, Track } from './types';

import { extraTrackPartitions, overlaps, TRACK_SPACE_MESSAGE } from './track-layout';

/** Copies of legacy Audio visuals get compatible lanes without moving their originals. */
export function routeLegacyCopies(project: Project, ids: string[], newId: () => string = uid): Project {
  const selected = new Set(ids), tracks = [...project.tracks], clips = [...project.clips];
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i], source = tracks.find(t => t.id === clip.trackId);
    if (!selected.has(clip.id) || !source || trackAcceptsClip(source, clip.kind)) continue;
    if (source.locked) throw Error('配置先トラックのロックを解除してください。');
    const compatible = tracks.filter(t => t.kind === 'video' && !t.locked && !!t.hidden === !!source.hidden && !!t.muted === !!source.muted && !!t.solo === !!source.solo);
    let track = compatible.find(t => !clips.some(c => c.trackId === t.id && overlaps(c, clip)));
    if (!track) {
      if (tracks.length >= 24) throw Error(TRACK_SPACE_MESSAGE);
      track = { ...makeTrack('video'), id: newId(), hidden: source.hidden, muted: source.muted, solo: source.solo };
      tracks.unshift(track);
    }
    clips[i] = { ...clip, trackId: track.id };
  }
  return { ...project, tracks, clips };
}


/** Move only the supplied placements to new lanes; existing edits stay untouched. */
export function separateOverlappingClips(project: Project, ids: string[], newId = uid, reusableTrackIds: readonly string[] = []): Project {
  const selected = new Set(ids), groups = new Map<string, Clip[]>();
  for (const clip of project.clips) if (selected.has(clip.id)) {
    const group = groups.get(clip.trackId) || []; group.push(clip); groups.set(clip.trackId, group);
  }
  const tracks = [...project.tracks], placements = new Map<string, string>(), additions = new Map<string, number>();
  const reusable = new Set(reusableTrackIds);
  const addLane = (source: Track, order: number) => {
    if (tracks.length >= 24) throw Error(TRACK_SPACE_MESSAGE);
    const track = { ...source, id: newId(), name: '', autoName: true };
    additions.set(track.id, order); tracks.push(track); return track;
  };
  for (const [trackId, group] of groups) {
    const source = tracks.find(t => t.id === trackId);
    if (!source || source.locked) throw Error('配置先トラックのロックを解除してください。');
    const stationary = project.clips.filter(c => c.trackId === trackId && !selected.has(c.id));
    const emptyReusable = tracks.filter(t => reusable.has(t.id) && !t.locked && group.every(c => trackAcceptsClip(t,c.kind)) && !project.clips.some(c => c.trackId === t.id));
    const partitions = extraTrackPartitions(group, stationary, 24 - tracks.length + emptyReusable.length);
    for (const partition of partitions) {
      let track = tracks.find(t => reusable.has(t.id) && !t.locked && group.every(c => trackAcceptsClip(t,c.kind)) && !project.clips.some(c => c.trackId === t.id));
      if (track) reusable.delete(track.id);
      else {
        if(partition.some(c=>!trackAcceptsClip(source,c.kind)))throw Error(AUDIO_TRACK_MESSAGE);
        track = addLane(source, project.tracks.findIndex(t => t.id === trackId));
      }
      for (const clip of partition) placements.set(clip.id, track.id);
    }
  }
  // A background promoted to the outside must remain below the batch's
  // foreground, including copies whose original lanes happened to be free.
  const deepestVideo = Math.max(-1, ...tracks.filter(t => t.kind === 'video' && additions.has(t.id)).map(t => additions.get(t.id)!));
  for (const [trackId, group] of groups) {
    const order = project.tracks.findIndex(t => t.id === trackId), source = project.tracks[order];
    if (source.kind !== 'video' || order >= deepestVideo) continue;
    for (const clip of [...group].sort((a,b) => a.start-b.start)) {
      if (additions.has(placements.get(clip.id) || clip.trackId)) continue;
      let track = tracks.find(t => additions.get(t.id) === order && !group.some(other => (placements.get(other.id) || other.trackId) === t.id && overlaps(other, clip)));
      if (!track) track = addLane(source, order);
      placements.set(clip.id, track.id);
    }
  }
  const added = tracks.filter(t => additions.has(t.id)).sort((a, b) => additions.get(a.id)! - additions.get(b.id)!);
  const orderedTracks = [...added.filter(t => t.kind === 'video'), ...project.tracks, ...added.filter(t => t.kind === 'audio')];
  return numberTracks(placements.size ? { ...project, tracks: orderedTracks, clips: project.clips.map(c => placements.has(c.id) ? { ...c, trackId: placements.get(c.id)! } : c) } : project);
}
