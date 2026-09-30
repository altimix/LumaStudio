import { makeClip, makeTrack, normalizeClip } from './model';
import { numberTracks } from './track-names';
import { separateAudio } from './linked-editing';
import type { Project, Track } from './types';
import { MAX_MEDIA_SECONDS } from '../shared/time.mjs';

/** New library media gets dedicated outer lanes at one captured playhead position. */
export function placeAssetsOutside(project: Project, ids: readonly string[], start: number) {
  if (!Number.isFinite(start) || start < 0 || start > MAX_MEDIA_SECONDS) throw Error('素材の追加位置が不正です。');
  const assets = [...new Set(ids)].map(id => {
    const asset = project.assets.find(a => a.id === id);
    if (!asset) throw Error('追加する素材が見つかりません。');
    if (asset.offline) throw Error('素材が見つかりません。再リンクしてから追加してください。');
    return asset;
  });
  const required = assets.reduce((total,a) => total+(a.kind==='video' && a.hasAudio ? 2 : 1),0);
  if (project.clips.length+required > 2000) throw Error('クリップは最大2000個です。');
  if (project.tracks.length+required > 24) throw Error('素材は新しいトラックへ追加します。トラックは最大24本のため、不要なトラックを削除してから追加してください。');
  let next = project;
  const videoTracks: Track[] = [], audioTracks: Track[] = [], added: string[] = [];
  for (const asset of assets) {
    const track = makeTrack(asset.kind==='audio' ? 'audio' : 'video');
    (track.kind==='video' ? videoTracks : audioTracks).push(track);
    // Preserve an exact seek position; normalize only source duration and properties.
    const clip = { ...normalizeClip(makeClip(track.id,start,asset),project), start };
    added.push(clip.id);
    next = { ...next, tracks:[...next.tracks,track], clips:[...next.clips,clip] };
    if (asset.kind==='video' && asset.hasAudio) {
      next = separateAudio(next,[clip.id],true,false,true);
      audioTracks.push(next.tracks.at(-1)!);
    }
  }
  // Text lanes stay in front of imported media, including mixed text/video lanes.
  const textTracks = new Set(project.clips.filter(c => c.kind==='title' && !c.graphic && c.text.trim()).map(c => c.trackId));
  let videoIndex = 0;
  project.tracks.forEach((track,index) => { if (track.kind==='video' && textTracks.has(track.id)) videoIndex=index+1; });
  next = numberTracks({ ...next, tracks:[...project.tracks.slice(0,videoIndex),...videoTracks,...project.tracks.slice(videoIndex),...audioTracks] });
  return { project:next, ids:added, start };
}
