import type { Clip } from './types';
import type { PlannedTransition } from '../shared/transitions.mjs';

/** The transition primer owns its entry decoder even before the effect starts.
 * A cut seek must never occupy that decoder with the wrong source timestamp. */
export function ordinaryCutPrefetch(clips: Clip[], plans: PlannedTransition[], trackId: string, time: number, rate: number) {
  const forward = rate > 0;
  const reserved = new Set<string>();
  for (const pair of plans) {
    if (!pair.video) continue;
    if (time >= pair.start && time < pair.end) {
      reserved.add(pair.fromId); reserved.add(pair.toId);
    } else if (forward ? time < pair.start : time >= pair.end) {
      reserved.add(forward ? pair.toId : pair.fromId);
    }
  }
  return clips.filter(clip => clip.trackId === trackId && clip.kind === 'video' && !reserved.has(clip.id))
    .map(clip => ({ clip, until: forward ? clip.start - time : time - (clip.start + clip.duration) }))
    .filter(candidate => candidate.until > 0 && candidate.until <= 2 * Math.abs(rate))
    .sort((a, b) => a.until - b.until)[0]?.clip;
}
