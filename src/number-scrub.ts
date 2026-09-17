export const NUMBER_SCRUB_THRESHOLD = 3;
export const NUMBER_SCRUB_PIXELS_PER_STEP = 2;

export function isHorizontalNumberScrub(deltaX: number, deltaY: number) {
  return Math.abs(deltaX) >= NUMBER_SCRUB_THRESHOLD && Math.abs(deltaX) >= Math.abs(deltaY);
}

export function scrubNumberValue(start: number, deltaX: number, step: number, min: number, max: number) {
  if (![start, deltaX, step, min, max].every(Number.isFinite) || step <= 0 || min > max) return start;
  const direction = Math.sign(deltaX);
  const steps = direction * Math.floor(Math.abs(deltaX) / NUMBER_SCRUB_PIXELS_PER_STEP);
  const clamped = Math.min(max, Math.max(min, start + steps * step));
  return Number(clamped.toFixed(12));
}

export function formatNumberInput(value: number, precision = 6) {
  return String(Number(value.toFixed(precision)));
}
