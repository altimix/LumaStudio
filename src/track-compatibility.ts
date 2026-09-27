import type { Clip, Track } from './types';

export const AUDIO_TRACK_MESSAGE = 'Audioトラックには音声だけを配置できます。動画・画像・テロップ・図形はVideoトラックへ配置してください。';
export function trackAcceptsClip(track: Track, kind: Clip['kind']) {
  return track.kind === 'video' || kind === 'audio';
}
export const MIN_TRACK_HEIGHT = 48;
export const MAX_TRACK_HEIGHT = 180;
