import { TUTORIAL } from './sim/levels';

export interface Progress {
  index: number;
  difficulty: number;
}

const KEY = 'still-water-progress-v1';

export function starsFor(stonesUsed: number, par: number): number {
  if (stonesUsed <= par) return 3;
  if (stonesUsed === par + 1) return 2;
  return 1;
}

export function moodLabel(index: number, difficulty: number): string {
  if (index < TUTORIAL.length) return 'Learning';
  if (difficulty <= 3) return 'Gentle';
  if (difficulty <= 6) return 'Lively';
  return 'Deep';
}

export interface AdaptParams {
  startDifficulty: number;
  maxDifficulty: number;
  stepUpOnPar: number;
  stepDownOnFail: number;
}

/**
 * Adaptive difficulty, GDD §3.6. Solving at par makes the next pond a little richer; struggling
 * makes it gentler. The rules never change, only the generated pond.
 */
export function afterComplete(p: Progress, stonesUsed: number, par: number, fails: number, a: AdaptParams): Progress {
  const index = p.index + 1;
  if (p.index < TUTORIAL.length) {
    return { index, difficulty: index >= TUTORIAL.length ? a.startDifficulty : p.difficulty };
  }
  let d = p.difficulty;
  if (stonesUsed <= par && fails === 0) d += a.stepUpOnPar;
  else if (fails >= 2 || stonesUsed > par + 1) d -= a.stepDownOnFail;
  return { index, difficulty: clamp(d, 1, a.maxDifficulty) };
}

export function afterSkip(p: Progress, a: AdaptParams): Progress {
  const index = p.index + 1;
  const d = p.index < TUTORIAL.length ? a.startDifficulty : p.difficulty - a.stepDownOnFail;
  return { index, difficulty: clamp(d, 1, a.maxDifficulty) };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function loadProgress(fallback: Progress): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const v = JSON.parse(raw) as Progress;
    if (typeof v.index === 'number' && typeof v.difficulty === 'number') return v;
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
