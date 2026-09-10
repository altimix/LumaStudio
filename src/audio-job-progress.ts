import type { AudioPreparePhase, Clip, Project } from './types';

export const AUDIO_PHASE_LABELS: Record<AudioPreparePhase, string> = {
  preparing: '音声を準備中', speech: '解析しながら会話音声を調整中', analysis: '音量を解析中', processing: '音声を調整中', correction: '仕上がりの音量を補正中',
  refining: '音量の精度を仕上げ中',
  saving: '処理済み音声を保存中', cached: '処理済み音声を再利用', complete: '音声の準備が完了',
};

export function audioWorkItems(project: Project, targets: Clip[]) {
  const assets = new Map(project.assets.map(asset => [asset.id, asset]));
  const unique = new Map<string, { clip: Clip; duration: number }>();
  for (const clip of targets) {
    const key = clip.assetId || clip.id;
    if (!unique.has(key)) unique.set(key, { clip, duration: Math.max(.01, assets.get(key)?.duration || clip.duration * clip.speed) });
  }
  return [...unique.values()];
}

export function progressEstimate(progress: number | null, startedAt: number | null, now: number) {
  const elapsedSeconds = startedAt === null ? 0 : Math.max(0, (now - startedAt) / 1000);
  const remainingSeconds = progress !== null && progress >= .02 && progress < .995 && elapsedSeconds >= 3
    ? Math.max(1, Math.ceil(elapsedSeconds * (1 - progress) / progress)) : null;
  return { elapsedSeconds, remainingSeconds };
}

export function durationLabel(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return value >= 3600 ? `${Math.floor(value / 3600)}時間${Math.floor(value % 3600 / 60)}分` : `${Math.floor(value / 60)}分${String(value % 60).padStart(2, '0')}秒`;
}
