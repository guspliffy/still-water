import { describe, expect, it } from 'vitest';
import { afterComplete, afterSkip, starsFor } from '../src/progress';
import { TUTORIAL } from '../src/sim/levels';

const a = { startDifficulty: 1, maxDifficulty: 10, stepUpOnPar: 1, stepDownOnFail: 1 };
const T = TUTORIAL.length;

describe('progress', () => {
  it('awards stars against par', () => {
    expect(starsFor(1, 2)).toBe(3);
    expect(starsFor(2, 2)).toBe(3);
    expect(starsFor(3, 2)).toBe(2);
    expect(starsFor(4, 2)).toBe(1);
  });
  it('leaves the tutorial at the start difficulty', () => {
    expect(afterComplete({ index: T - 1, difficulty: 0 }, 2, 2, 0, a)).toEqual({ index: T, difficulty: 1 });
  });
  it('steps up on a clean par solve and down when struggling', () => {
    expect(afterComplete({ index: T + 2, difficulty: 4 }, 3, 3, 0, a).difficulty).toBe(5);
    expect(afterComplete({ index: T + 2, difficulty: 4 }, 4, 3, 0, a).difficulty).toBe(4);
    expect(afterComplete({ index: T + 2, difficulty: 4 }, 3, 3, 2, a).difficulty).toBe(3);
    expect(afterComplete({ index: T + 2, difficulty: 10 }, 3, 3, 0, a).difficulty).toBe(10);
    expect(afterSkip({ index: T + 2, difficulty: 1 }, a).difficulty).toBe(1);
  });
});
