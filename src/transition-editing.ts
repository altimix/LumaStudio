import { linkedIds, clipsLocked } from '../shared/clip-links.mjs';
import { maxTransitionDuration, transitionPlan } from '../shared/transitions.mjs';
import type { Project } from './types';

// A separated, linked audio transition follows the same cut. Do not create an
// audio effect or change unrelated effects when resizing a video-only cut.
export function transitionResizeInfo(project: Project, id: string) {
  const plans = transitionPlan(project), transition = plans.find(t => t.id === id);
  if (!transition) throw new Error('調整するトランジションが見つかりません。');
  const from = new Set(linkedIds(project, [transition.fromId]));
  const to = new Set(linkedIds(project, [transition.toId]));
  const group = plans.filter(t => from.has(t.fromId) && to.has(t.toId));
  const maximum = Math.min(...group.map(t => maxTransitionDuration(t.from, t.to, project.fps)));
  const reason = group.some(t => t.mode !== 'fixed')
    ? '以前の重なり方式の効果は、クリップの重なりが長さになります。'
    : clipsLocked(project, group.flatMap(t => [t.fromId, t.toId]))
      ? '効果を調整するには、リンク音声を含むトラックのロックを解除してください。' : '';
  return { transition, ids: group.map(t => t.id), maximum, reason };
}

export function resizeTransition(project: Project, id: string, seconds: number): Project {
  const { ids, maximum, reason } = transitionResizeInfo(project, id);
  if (reason) throw new Error(reason);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('効果の長さには0より大きい秒数を入力してください。');
  const duration = Math.max(1, Math.min(Math.round(maximum * project.fps), Math.round(seconds * project.fps))) / project.fps;
  const targets = new Set(ids);
  if (project.transitions!.every(t => !targets.has(t.id) || t.duration === duration)) return project;
  const next = { ...project, transitions: project.transitions!.map(t => targets.has(t.id) ? { ...t, duration } : t) };
  transitionPlan(next);
  return next;
}

export function draggedTransitionDuration(duration: number, side: 'start' | 'end', pixels: number, zoom: number, fps: number, maximum: number) {
  const frames = Math.round((duration + (side === 'start' ? -1 : 1) * pixels * 2 / zoom) * fps);
  return Math.max(1, Math.min(Math.round(maximum * fps), frames)) / fps;
}
