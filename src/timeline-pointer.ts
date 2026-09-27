import { roundFrame } from './model';
import type { Clip, Project } from './types';

export const POINTER_SNAP_PIXELS = 8;

/** Pointer seeks exclude the playhead itself so a dragged head never sticks to itself. */
export function timelinePointerTime(project: Project, rawTime: number, zoom: number, snapping: boolean, clip?: Clip) {
  let time = Math.max(0, rawTime), snapped = false;
  if (snapping) {
    let distance = POINTER_SNAP_PIXELS / zoom;
    const targets = [0, ...project.markers.map(marker => marker.time), ...project.clips.flatMap(item => [item.start, item.start + item.duration])];
    for (const target of targets) {
      const delta = Math.abs(target - rawTime);
      if (delta <= distance) { time = target; distance = delta; snapped = true; }
    }
  }
  // Keep boundary targets exact, including imported fractional starts. Unsnapped cuts
  // retain the established clip-relative frame grid.
  if (!snapped) time = clip ? clip.start + roundFrame(time - clip.start, project.fps) : roundFrame(time, project.fps);
  return { time: Math.max(0, time), snapped };
}

export function canSplitAt(clip: Clip, time: number, fps: number) {
  const left = time - clip.start, minimum = 1 / fps - 1e-6;
  return left >= minimum && clip.duration - left >= minimum;
}
