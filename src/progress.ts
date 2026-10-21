import { TUTORIAL } from './sim/levels';

/**
 * Progress through the lessons, then the level map. `index` counts lessons first, so level n
 * (0-based) is index TUTORIAL.length + n. Each level has three versions: tier 0 easier,
 * 1 normal, 2 harder. The tier is never shown to the player.
 */
export interface Progress {
  index: number;
  /** Furthest index unlocked. */
  reached: number;
  tier: number;
  /** Consecutive 2-star results; enough of them in a row eases the next level. */
  twoStarStreak: number;
  /** Best stars per level, and the tier that level was played at (replays use the same pond). */
  best: Record<number, { stars: number; tier: number }>;
}

export interface LevelParams {
  count: number;
  baseStart: number;
  baseStep: number;
  tierStep: number;
  startTier: number;
  twoStarsToEase: number;
  maxDifficulty: number;
}

const KEY = 'still-water-progress-v2';
export const MAX_TIER = 2;

/** Every throw on a level counts, retries included: 3 stars only for a perfect solve. */
export function starsFor(throws: number, par: number): number {
  if (throws <= par) return 3;
  if (throws === par + 1) return 2;
  return 1;
}

export const levelOf = (index: number): number => index - TUTORIAL.length;
export const isLesson = (index: number): boolean => index < TUTORIAL.length;

export function freshProgress(lp: Pick<LevelParams, 'startTier'>): Progress {
  return { index: 0, reached: 0, tier: lp.startTier, twoStarStreak: 0, best: {} };
}

/** Generator difficulty for a level: rises steadily along the map, shifted by the tier. */
export function difficultyFor(level: number, tier: number, lp: LevelParams): number {
  const d = lp.baseStart + level * lp.baseStep + (tier - 1) * lp.tierStep;
  return Math.max(1, Math.min(lp.maxDifficulty, Math.round(d)));
}

/** The tier a given index is played at: the recorded one for a replay, the current one otherwise. */
export function tierAt(p: Progress, index: number): number {
  const rec = p.best[levelOf(index)];
  return index < p.reached && rec ? rec.tier : p.tier;
}

/**
 * Jonny's adaptive rule: 3 stars makes the next level harder, 2 stars keeps it the same, two
 * 2-star results in a row ease it, 1 star eases it. Replays of earlier levels only improve stars.
 */
export function afterComplete(p: Progress, stars: number, lp: LevelParams): Progress {
  const best = { ...p.best };
  if (isLesson(p.index)) {
    let index = p.index + 1;
    const first = index > p.reached;
    // Replaying the lessons from the map: after the last one, return to where the player was.
    if (!first && !isLesson(index)) index = p.reached;
    return { ...p, index, reached: Math.max(p.reached, index), tier: first && !isLesson(index) ? lp.startTier : p.tier, best };
  }
  const level = levelOf(p.index);
  const playedTier = tierAt(p, p.index);
  const prev = best[level];
  best[level] = { stars: Math.max(prev?.stars ?? 0, stars), tier: playedTier };
  if (p.index < p.reached) return { ...p, index: p.reached, best };

  let tier = p.tier;
  let streak = 0;
  if (stars >= 3) tier++;
  else if (stars === 2) {
    streak = p.twoStarStreak + 1;
    if (streak >= lp.twoStarsToEase) {
      tier--;
      streak = 0;
    }
  } else tier--;
  const index = p.index + 1;
  return { index, reached: index, tier: clamp(tier, 0, MAX_TIER), twoStarStreak: streak, best };
}

/** Skipping a level after repeated tries: move on, one step gentler. */
export function afterSkip(p: Progress): Progress {
  const best = { ...p.best };
  if (!isLesson(p.index)) {
    const level = levelOf(p.index);
    best[level] = { stars: best[level]?.stars ?? 0, tier: tierAt(p, p.index) };
  }
  if (p.index < p.reached) return { ...p, index: p.reached, best };
  const index = p.index + 1;
  return { index, reached: index, tier: clamp(p.tier - (isLesson(p.index) ? 0 : 1), 0, MAX_TIER), twoStarStreak: 0, best };
}

export function totalStars(p: Progress): number {
  return Object.values(p.best).reduce((s, b) => s + b.stars, 0);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function loadProgress(fallback: Progress): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      // Players from before the map keep their lessons done and start at level 1.
      const old = JSON.parse(localStorage.getItem('still-water-progress-v1') ?? 'null') as { index?: number } | null;
      const T = TUTORIAL.length;
      if (old && typeof old.index === 'number' && old.index >= T) return { ...fallback, index: T, reached: T };
      return fallback;
    }
    const v = JSON.parse(raw) as Progress;
    if (typeof v.index === 'number' && typeof v.tier === 'number' && v.best) return { ...fallback, ...v };
  } catch {
    // Storage can be unavailable (private mode); play from the start.
  }
  return fallback;
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Ignore: progress is a convenience only.
  }
}
