import { dist, insidePond, rng } from './geometry';
import { runSolution } from './sim';
import type { LanternDef, PondDef, RockDef, SimParams, StoneDrop, Vec } from './types';

export interface GenParams {
  edgeMargin: number;
  lanternMinSpacing: number;
  rockRadiusMin: number;
  rockRadiusMax: number;
  spareStones: number;
  maxDifficulty: number;
}

/** Which ideas a pond may use; levels unlock them one at a time. */
export interface Features {
  echo: boolean;
  rocks: boolean;
  moon: boolean;
}

const ALL: Features = { echo: true, rocks: true, moon: true };

/** What a difficulty level asks of the generator. Rules never change, only the pond. */
export function recipe(difficulty: number, features: Features = ALL) {
  const d = Math.max(1, Math.round(difficulty));
  // Moon lanterns hang off echo lanterns (only an echo's ring can wake them), so they need one each.
  const moon = features.moon && features.echo && d >= 5 ? (d >= 11 ? 2 : 1) : 0;
  const echo = Math.max(moon, features.echo && d >= 3 ? 1 + Math.floor((d - 3) / 4) : 0);
  return {
    stones: Math.min(5, 2 + Math.floor((d - 1) / 3)),
    gold: d >= 11 ? 3 : d >= 6 ? 2 : 1,
    echo,
    moon,
    rocks: features.rocks && d >= 4 ? Math.min(4, 1 + Math.floor((d - 4) / 3)) : 0,
    plain: Math.min(8, 1 + Math.floor(d / 2)),
    // Largest gap between the solution's drops: 0 means the golds sit on the midline between stones.
    maxDelay: d <= 2 ? 0.1 : Math.min(0.9, 0.1 + 0.1 * (d - 2)),
  };
}

/**
 * Builds a pond backwards from a hidden solution: place stones first, then put lanterns where
 * their rings will be, gold lanterns where two rings arrive together. The solution is verified
 * by simulation, so every pond is solvable at par.
 */
export function generatePond(seed: number, difficulty: number, sp: SimParams, gp: GenParams, features: Features = ALL): PondDef {
  for (let attempt = 0; attempt < 80; attempt++) {
    const pond = tryGenerate(seed * 7919 + attempt, difficulty, sp, gp, features);
    if (pond) return pond;
  }
  // Very unlikely; fall back to an easier recipe rather than fail.
  return generatePond(seed + 1, Math.max(1, difficulty - 1), sp, gp, features);
}

function tryGenerate(seed: number, difficulty: number, sp: SimParams, gp: GenParams, features: Features): PondDef | null {
  const rand = rng(seed);
  const rc = recipe(difficulty, features);
  const R = sp.maxRadius;
  const inside = (p: Vec, m: number) => insidePond(p, sp.width, sp.height, sp.cornerRadius, m);
  const randPoint = (m: number): Vec => {
    for (let i = 0; i < 200; i++) {
      const p = { x: rand() * sp.width, y: rand() * sp.height };
      if (inside(p, m)) return p;
    }
    return { x: sp.width / 2, y: sp.height / 2 };
  };
  const around = (c: Vec, rMin: number, rMax: number): Vec => {
    const a = rand() * Math.PI * 2;
    const r = rMin + rand() * (rMax - rMin);
    return { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
  };

  // 1. Stones, each within gold range of an earlier one so rings can meet.
  const stoneMargin = gp.edgeMargin + 50;
  const stones: StoneDrop[] = [{ ...randPoint(stoneMargin), t: 0 }];
  for (let tries = 0; stones.length < rc.stones && tries < 300; tries++) {
    const base = stones[Math.floor(rand() * stones.length)];
    const p = around(base, 170, 2 * R * 0.85);
    if (!inside(p, stoneMargin)) continue;
    if (stones.some((s) => dist(s, p) < 150)) continue;
    stones.push({ ...p, t: 0 });
  }
  if (stones.length < rc.stones) return null;
  // Drop times: easy ponds drop together, harder ones need a deliberate wait.
  stones.forEach((s, i) => {
    if (i > 0) s.t = Math.round(rand() * rc.maxDelay * 20) / 20;
  });

  const lanterns: LanternDef[] = [];
  const clear = (p: Vec, m: number) =>
    inside(p, gp.edgeMargin) &&
    lanterns.every((l) => dist(l, p) >= gp.lanternMinSpacing) &&
    stones.every((s) => dist(s, p) >= m);
  const arrival = (s: StoneDrop, p: Vec) => s.t + dist(s, p) / sp.speed;

  // 2. Gold lanterns where two solution rings arrive well inside the window.
  for (let g = 0; g < rc.gold; g++) {
    let placed = false;
    for (let tries = 0; tries < 400 && !placed; tries++) {
      const i = Math.floor(rand() * stones.length);
      let j = Math.floor(rand() * stones.length);
      if (j === i) j = (j + 1) % stones.length;
      const a = stones[i];
      const b = stones[j];
      if (dist(a, b) > 2 * R * 0.9) continue;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const p = around(mid, 0, R * 0.6);
      if (dist(a, p) > R * 0.9 || dist(b, p) > R * 0.9) continue;
      if (Math.abs(arrival(a, p) - arrival(b, p)) > sp.goldWindow * 0.3) continue;
      if (!clear(p, 70)) continue;
      lanterns.push({ ...p, kind: 'gold' });
      placed = true;
    }
    if (!placed) return null;
  }

  // 3. Echo lanterns, each with a lantern only its echo can reach (a moon lantern for the first few).
  for (let e = 0; e < rc.echo; e++) {
    let placed = false;
    for (let tries = 0; tries < 400 && !placed; tries++) {
      const s = stones[Math.floor(rand() * stones.length)];
      const ep = around(s, 90, R * 0.85);
      if (!clear(ep, 60)) continue;
      const tail = around(ep, sp.echoMaxRadius * 0.55, sp.echoMaxRadius * 0.85);
      if (!clear(tail, 60) || dist(tail, ep) < gp.lanternMinSpacing) continue;
      const moon = e < rc.moon;
      // A plain tail must be out of every stone's reach; a moon tail ignores stone rings anyway.
      if (!moon && stones.some((st) => dist(st, tail) < R * 1.02)) continue;
      lanterns.push({ ...ep, kind: 'echo' }, { ...tail, kind: moon ? 'moon' : 'plain' });
      placed = true;
    }
    if (!placed) return null;
  }

  // 4. Plain lanterns somewhere a solution ring passes.
  for (let n = 0; n < rc.plain; n++) {
    let placed = false;
    for (let tries = 0; tries < 300 && !placed; tries++) {
      const s = stones[Math.floor(rand() * stones.length)];
      const p = around(s, 70, R * 0.9);
      if (!clear(p, 60)) continue;
      lanterns.push({ ...p, kind: 'plain' });
      placed = true;
    }
  }

  // 5. Rocks that leave the solution intact but block lazy alternatives.
  const rocks: RockDef[] = [];
  const base: PondDef = {
    id: `gen-${seed}`,
    title: '',
    lanterns,
    rocks,
    par: stones.length,
    stones: stones.length + gp.spareStones,
    hints: [],
    solution: stones,
    difficulty,
  };
  for (let k = 0; k < rc.rocks; k++) {
    for (let tries = 0; tries < 60; tries++) {
      const r = gp.rockRadiusMin + rand() * (gp.rockRadiusMax - gp.rockRadiusMin);
      const p = randPoint(gp.edgeMargin + r);
      const rock = { ...p, r };
      if (lanterns.some((l) => dist(l, p) < r + 45)) continue;
      if (stones.some((s) => dist(s, p) < r + 40)) continue;
      if (rocks.some((o) => dist(o, p) < o.r + r + 40)) continue;
      // Only keep rocks near lanterns, where their shadows change the plan.
      if (!lanterns.some((l) => dist(l, p) < 170)) continue;
      rocks.push(rock);
      if (runSolution(base, sp, stones).done === 'complete') break;
      rocks.pop();
    }
  }

  const check = runSolution(base, sp, stones);
  if (check.done !== 'complete') return null;
  return base;
}
