/** Decoder timestamps are source seconds; the drift budget is sequence seconds. */
export function videoSeekTolerance(speed: number, shuttleRate: number, fps: number, steady: boolean) {
  return steady ? Math.abs(speed) * Math.max(.5, Math.abs(shuttleRate) * 6 / fps) : .008;
}

/** Held first/last frames must not seek into moving footage before its boundary. */
export function videoSeekLead(latencyMs: number | undefined, desired: number, unclamped: number) {
  return Math.abs(desired - unclamped) > 1e-6 ? 0 : Math.min(.8, (latencyMs ?? 12) / 1000 + .008);
}

/** Long-GOP CPU seeks can legitimately exceed one second. */
export function videoSeekRecoveryMs(latencyMs: number | undefined) {
  return Math.max(2000, (latencyMs ?? 0) * 3);
}

export function playbackFrameAhead(frame: number, desired: number, speed: number, shuttle: number, fps: number) {
  return !!shuttle && (frame - desired) / (speed * shuttle) > 1 / (fps * Math.abs(shuttle)) + 1e-6;
}

/** During continuous playback, recompose with a recent decoded frame instead of
 * dropping the whole effect. Never borrow a frame from another seek or the future. */
export function usablePlaybackFrame(frame: number | undefined, desired: number, speed: number, shuttle: number, fps: number, trusted: boolean) {
  if (frame === undefined || !trusted || !shuttle) return false;
  const age = (desired - frame) / (speed * shuttle);
  return !playbackFrameAhead(frame, desired, speed, shuttle, fps) && age <= .5 + 1e-6;
}

/** Stop an early native decoder until its frame reaches the timeline, without
 * seeking backward through a long GOP or displaying future video. */
export function waitForNativeFrame(frame:number,desired:number,speed:number,fps:number,waiting:boolean) {
  const lead=(frame-desired)/Math.abs(speed);
  return lead>(waiting?1/fps:Math.max(.1,2/fps))+1e-6;
}
