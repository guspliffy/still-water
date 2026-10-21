import { describe, expect, it } from 'vitest';
import { afterComplete, afterSkip, difficultyFor, freshProgress, starsFor, tierAt, type Progress } from '../src/progress';
import { TUTORIAL } from '../src/sim/levels';

const lp = { count: 12, baseStart: 1.2, baseStep: 0.65, tierStep: 1.5, startTier: 1, twoStarsToEase: 2, maxDifficulty: 10 };
const T = TUTORIAL.length;
const at = (index: number, tier = 1, twoStarStreak = 0): Progress => ({ index, reached: index, tier, twoStarStreak, best: {} });

describe('progress', () => {
  it('counts every throw: 3 stars only for a perfect solve', () => {
    expect(starsFor(1, 2)).toBe(3);
    expect(starsFor(2, 2)).toBe(3);
    expect(starsFor(3, 2)).toBe(2);
    expect(starsFor(4, 2)).toBe(1);
  });
  it('leaves the lessons at the normal tier', () => {
    const p = afterComplete({ ...freshProgress(lp), index: T - 1, reached: T - 1, tier: 0 }, 3, lp);
    expect(p).toMatchObject({ index: T, reached: T, tier: 1 });
  });
  it('3 stars harder, 2 stars same, two 2-stars easier, 1 star easier', () => {
    expect(afterComplete(at(T + 2, 1), 3, lp).tier).toBe(2);
    expect(afterComplete(at(T + 2, 2), 3, lp).tier).toBe(2);
    const two = afterComplete(at(T + 2, 1), 2, lp);
    expect(two).toMatchObject({ tier: 1, twoStarStreak: 1 });
    expect(afterComplete(two, 2, lp)).toMatchObject({ tier: 0, twoStarStreak: 0 });
    expect(afterComplete(at(T + 2, 1, 1), 3, lp).twoStarStreak).toBe(0);
    expect(afterComplete(at(T + 2, 1), 1, lp).tier).toBe(0);
    expect(afterComplete(at(T + 2, 0), 1, lp).tier).toBe(0);
    expect(afterSkip(at(T + 2, 1))).toMatchObject({ index: T + 3, tier: 0 });
  });
  it('levels get steadily harder, and tiers shift them', () => {
    for (let l = 1; l < 12; l++) expect(difficultyFor(l, 1, lp)).toBeGreaterThanOrEqual(difficultyFor(l - 1, 1, lp));
    expect(difficultyFor(11, 1, lp)).toBeGreaterThan(difficultyFor(0, 1, lp) + 5);
    expect(difficultyFor(5, 0, lp)).toBeLessThan(difficultyFor(5, 1, lp));
    expect(difficultyFor(5, 2, lp)).toBeGreaterThan(difficultyFor(5, 1, lp));
  });
  it('replays keep the recorded tier, improve best stars, and return to the frontier', () => {
    let p = afterComplete(at(T, 1), 1, lp); // level 1 at tier 1, 1 star → tier 0
    p = afterComplete(p, 3, lp); // level 2 at tier 0
    const replay = { ...p, index: T };
    expect(tierAt(replay, T)).toBe(1);
    const after = afterComplete(replay, 3, lp);
    expect(after).toMatchObject({ index: T + 2, tier: p.tier });
    expect(after.best[0]).toEqual({ stars: 3, tier: 1 });
  });
});
