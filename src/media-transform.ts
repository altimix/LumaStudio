import type { Asset, Clip, Project } from './types';

export type SourceSize = { width: number; height: number };
export type MediaSize = SourceSize & { source: string };
export type Corner = { x: -1 | 1; y: -1 | 1 };
export type Position = { x: number; y: number };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const mediaSourceKey = (project: Project, asset: Asset) => JSON.stringify([project.id, asset.id, asset.url, asset.revision]);

/** Matches the renderer's track order and its stable, time-sorted clip order. */
export function visualOrder(project: Project): Map<string, number> {
  const groups = new Map(project.tracks.map(track => [track.id, [] as Clip[]]));
  for (const clip of project.clips) if (clip.kind !== 'audio') groups.get(clip.trackId)?.push(clip);
  return new Map([...project.tracks].reverse().flatMap(track => groups.get(track.id)!.sort((a, b) => a.start - b.start))
    .map((clip, index) => [clip.id, index * 3 + 1]));
}

export function mediaBounds(clip: Clip, source: SourceSize, project: Pick<Project, 'width' | 'height'>) {
  const width = source.width > 0 ? source.width : project.width;
  const height = source.height > 0 ? source.height : project.height;
  const fit = Math.min(project.width / width, project.height / height);
  return { width: width * fit * clip.scale, height: height * fit * clip.scale,
    x: project.width * (0.5 + clip.x / 100), y: project.height * (0.5 + clip.y / 100) };
}

export function mediaCorner(clip: Clip, source: SourceSize, project: Pick<Project, 'width' | 'height'>, corner: Corner): Position {
  const bounds = mediaBounds(clip, source, project), angle = clip.rotation * Math.PI / 180;
  const dx = corner.x * bounds.width / 2, dy = corner.y * bounds.height / 2;
  return { x: bounds.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: bounds.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
}

export function moveMedia(clip: Clip, project: Pick<Project, 'width' | 'height'>, delta: Position, snap: Position = { x: 0, y: 0 }) {
  let x = clip.x + delta.x / project.width * 100, y = clip.y + delta.y / project.height * 100;
  if (Math.abs(x) * project.width / 100 < snap.x) x = 0;
  if (Math.abs(y) * project.height / 100 < snap.y) y = 0;
  return { x: clamp(x, -200, 200), y: clamp(y, -200, 200) };
}

/** Uniform resize by projecting the drag on the rotated diagonal, preserving the opposite corner. */
export function resizeMedia(clip: Clip, source: SourceSize, project: Pick<Project, 'width' | 'height'>, corner: Corner, delta: Position) {
  const opposite = mediaCorner(clip, source, project, { x: -corner.x as -1 | 1, y: -corner.y as -1 | 1 });
  const moving = mediaCorner(clip, source, project, corner), dx = moving.x - opposite.x, dy = moving.y - opposite.y;
  const scale = clamp(clip.scale * (1 + (delta.x * dx + delta.y * dy) / Math.max(1e-9, dx * dx + dy * dy)), 0.1, 3);
  const ratio = scale / clip.scale;
  return { scale, x: clamp(((opposite.x + dx * ratio / 2) / project.width - 0.5) * 100, -200, 200),
    y: clamp(((opposite.y + dy * ratio / 2) / project.height - 0.5) * 100, -200, 200) };
}
