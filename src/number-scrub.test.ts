import { describe, expect, it } from 'vitest';
import { formatNumberInput, isHorizontalNumberScrub, scrubNumberValue } from './number-scrub';

describe('number input horizontal scrubbing', () => {
  it('starts only after a horizontal three-pixel movement', () => {
    expect(isHorizontalNumberScrub(2.99, 0)).toBe(false);
    expect(isHorizontalNumberScrub(3, 2)).toBe(true);
    expect(isHorizontalNumberScrub(3, 4)).toBe(false);
    expect(isHorizontalNumberScrub(-3, 1)).toBe(true);
  });

  it('moves right up and left down in field steps', () => {
    expect(scrubNumberValue(10, 9, .5, 0, 100)).toBe(12);
    expect(scrubNumberValue(10, -9, .5, 0, 100)).toBe(8);
    expect(scrubNumberValue(10, 1.9, .5, 0, 100)).toBe(10);
  });

  it('clamps to both limits without floating-point residue', () => {
    expect(scrubNumberValue(.98, 20, .01, 0, 1)).toBe(1);
    expect(scrubNumberValue(.02, -20, .01, 0, 1)).toBe(0);
    expect(scrubNumberValue(0, 2, 1 / 30, 0, 10)).toBeCloseTo(1 / 30, 11);
    expect(formatNumberInput(1 / 30)).toBe('0.033333');
    expect(formatNumberInput(17.782794, 2)).toBe('17.78');
  });
});
