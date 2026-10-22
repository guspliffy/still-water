import { dist, distToSegment, insidePond, mirrorPoint, pathLength, rng, sideOf } from './geometry';
import { runSolution } from './sim';
import type { LanternDef, PondDef, RockDef, SimParams, StoneDrop, Vec, WallDef } from './types';

/** One row of the level recipe (GDD §5): what a pond at difficulty d holds. */
export interface RecipeRow {
  d: number;
  stones: number;
  spare: number;
  /** Pond total, counting echo tails and wall bank lanterns. */
  lanterns: number;
  gold: number;
  echo: number;
  moon: number;
  /** Total, counting the rock that hides each plain bank lantern. */
  rocks: number;
  walls: number;
  drift: number;
  maxDelay: number;
  goldViaEcho: number;
  goldViaBounce: number;
}

export interface GenParams {
  edgeMargin: number;
  lanternMinSpacing: number;
  rockRadiusMin: number;
  rockRadiusMax: number;
  maxDifficulty: number;
  /** Gold sits where two solution rings arrive within this fraction of the gold window. */
  goldArrivalTolerance: number;
  recipe: RecipeRow[];
}

/** Which ideas a pond may use; levels unlock them one at a time. */
export interface Features {
  echo: boolean;
  rocks: boolean;
  moon: boolean;
  walls: boolean;
  drift: boolean;
}

const ALL: Features = { echo: true, rocks: true, moon: true, walls: true, drift: true };

/**
 * What a difficulty level asks of the generator: its recipe row, with ideas the level hasn't
 * introduced yet turned into plain lanterns so the total holds. Counts are capped; difficulty
 * rises through timing and combination instead (GDD §5).
 */
export function recipe(difficulty: number, rows: RecipeRow[], features: Features = ALL) {
  const row = rows[Math.max(1, Math.min(rows.length, Math.round(difficulty))) - 1];
  const echo = features.echo ? row.echo : 0;
  const walls = features.walls ? row.walls : 0;
  // Each wall brings a bank shot: a moon lantern while the moon count lasts, else a plain one hidden behind a rock.
  const moon = features.moon ? Math.min(row.moon, walls) : 0;
  const hiddenBanks = walls - moon;
  return {
    stones: row.stones,
    spare: row.spare,
    gold: row.gold,
    goldViaEcho: echo > 0 ? Math.min(row.goldViaEcho, row.gold) : 0,
    goldViaBounce: walls > 0 ? Math.min(row.goldViaBounce, row.gold) : 0,
    echo,
    moon,
    walls,
    rocks: features.rocks ? Math.max(0, row.rocks - hiddenBanks) : 0,
    drift: features.drift ? row.drift : 0,
    plain: Math.max(0, row.lanterns - row.gold - 2 * echo - walls),
    // Largest gap between the solution's drops: 0.1 means the golds sit on the midline between stones.
    maxDelay: row.maxDelay,
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
  const rc = recipe(difficulty, gp.recipe, features);
  const goldTol = sp.goldWindow * gp.goldArrivalTolerance;
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
  const rocks: RockDef[] = [];
  const walls: WallDef[] = [];
  const base: PondDef = {
    id: `gen-${seed}`,
    title: '',
    lanterns,
    rocks,
    walls,
    par: stones.length,
    stones: stones.length + rc.spare,
    hints: [],
    solution: stones,
    difficulty,
  };
  const wallPt = (w: WallDef, end: 0 | 1): Vec => (end === 0 ? { x: w.ax, y: w.ay } : { x: w.bx, y: w.by });
  const nearWall = (p: Vec, w: WallDef) => distToSegment(p, wallPt(w, 0), wallPt(w, 1));
  // A drifting lantern occupies its whole path.
  const pathEnd = (l: LanternDef): Vec => (l.drift ? { x: l.x + l.drift.dx, y: l.y + l.drift.dy } : l);
  const clear = (p: Vec, m: number) =>
    inside(p, gp.edgeMargin) &&
    lanterns.every((l) => distToSegment(p, l, pathEnd(l)) >= gp.lanternMinSpacing) &&
    stones.every((s) => dist(s, p) >= m) &&
    walls.every((w) => nearWall(p, w) >= 40);
  const arrival = (s: StoneDrop, p: Vec) => s.t + dist(s, p) / sp.speed;
  // Later lanterns must be in plain sight of the stone that lights them.
  const sees = (from: Vec, to: Vec) => pathLength(from, to, -1, rocks, walls) !== null;
  // 2. Mirror walls first, while the pond is empty. Each brings a bank shot: a lantern a solution
  // stone reaches only by the bounce, either a moon lantern (which ignores straight rings) or a
  // plain one that a rock hides from the straight ring.
  for (let k = 0; k < rc.walls; k++) {
    for (let tries = 0; tries < 120; tries++) {
      const s = stones[Math.floor(rand() * stones.length)];
      const c = around(s, 80, 140);
      const ang = Math.atan2(c.y - s.y, c.x - s.x) + Math.PI / 2 + (rand() - 0.5) * 0.6;
      const half = 70 + rand() * 30;
      const w: WallDef = { ax: c.x + Math.cos(ang) * half, ay: c.y + Math.sin(ang) * half, bx: c.x - Math.cos(ang) * half, by: c.y - Math.sin(ang) * half };
      if (!inside(wallPt(w, 0), gp.edgeMargin) || !inside(wallPt(w, 1), gp.edgeMargin)) continue;
      if (lanterns.some((l) => nearWall(l, w) < 45) || stones.some((st) => nearWall(st, w) < 50)) continue;
      if (walls.some((o) => nearWall(wallPt(o, 0), w) < 60 || nearWall(wallPt(o, 1), w) < 60 || nearWall(wallPt(w, 0), o) < 60)) continue;
      const bank = around(c, 60, 150);
      if (sideOf(bank, w) !== sideOf(s, w) || !clear(bank, 60) || nearWall(bank, w) < 45) continue;
      const m = walls.length;
      const trial = [...walls, w];
      const bounce = pathLength(s, bank, m, rocks, trial);
      if (bounce === null || bounce > R * 0.85) continue;
      if (k < rc.moon) {
        walls.push(w);
        lanterns.push({ ...bank, kind: 'moon' });
        if (runSolution(base, sp, stones).done === 'complete') break;
        walls.pop();
        lanterns.pop();
        continue;
      }
      const r = 22 + rand() * 8;
      const f = 0.4 + rand() * 0.2;
      const rock = { x: s.x + (bank.x - s.x) * f, y: s.y + (bank.y - s.y) * f, r };
      if (lanterns.some((l) => dist(l, rock) < r + 45) || stones.some((st) => dist(st, rock) < r + 40)) continue;
      if (trial.some((o) => nearWall(rock, o) < r + 20) || rocks.some((o) => dist(o, rock) < o.r + r + 40)) continue;
      walls.push(w);
      rocks.push(rock);
      lanterns.push({ ...bank, kind: 'plain' });
      const straightHidden = pathLength(s, bank, -1, rocks, walls) === null;
      if (straightHidden && pathLength(s, bank, m, rocks, walls) !== null && runSolution(base, sp, stones).done === 'complete') break;
      walls.pop();
      rocks.pop();
      lanterns.pop();
    }
  }

  // 3. Gold lanterns where two straight solution rings arrive well inside the window. The harder
  // golds (step 4b) come after the echoes they depend on.
  const placeGold = (): boolean => {
    for (let tries = 0; tries < 400; tries++) {
      const i = Math.floor(rand() * stones.length);
      let j = Math.floor(rand() * stones.length);
      if (j === i) j = (j + 1) % stones.length;
      const a = stones[i];
      const b = stones[j];
      if (dist(a, b) > 2 * R * 0.9) continue;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const p = around(mid, 0, R * 0.6);
      if (dist(a, p) > R * 0.9 || dist(b, p) > R * 0.9) continue;
      if (Math.abs(arrival(a, p) - arrival(b, p)) > goldTol) continue;
      if (!clear(p, 70) || !sees(a, p) || !sees(b, p)) continue;
      lanterns.push({ ...p, kind: 'gold' });
      return true;
    }
    return false;
  };
  for (let g = 0; g < rc.gold - rc.goldViaEcho - rc.goldViaBounce; g++) if (!placeGold()) return null;

  // 4. Echo lanterns, each with a lantern only its echo can reach.
  const echoes: { at: Vec; ringAt: number }[] = [];
  for (let e = 0; e < rc.echo; e++) {
    let placed = false;
    for (let tries = 0; tries < 400 && !placed; tries++) {
      const s = stones[Math.floor(rand() * stones.length)];
      const ep = around(s, 90, R * 0.85);
      if (!clear(ep, 60) || !sees(s, ep)) continue;
      const tail = around(ep, sp.echoMaxRadius * 0.55, sp.echoMaxRadius * 0.85);
      if (!clear(tail, 60) || dist(tail, ep) < gp.lanternMinSpacing || !sees(ep, tail)) continue;
      if (stones.some((st) => dist(st, tail) < R * 1.02)) continue;
      lanterns.push({ ...ep, kind: 'echo' }, { ...tail, kind: 'plain' });
      echoes.push({ at: ep, ringAt: arrival(s, ep) + sp.echoDelay });
      placed = true;
    }
    if (!placed) return null;
  }

  // 4b. Harder golds: one where an echo's ring meets a stone's ring, one where a bounced ring meets
  // a straight one. If neither fits, a plain gold takes its place.
  // The first ring is a circle around c that starts at t0 (an echo, or a stone's mirror image);
  // gold goes where it and a stone's ring meet, found by intersecting the two circles at one time.
  const placeGoldWith = (pick: () => { c: Vec; t0: number; maxR: number; at: (p: Vec) => number | null }): boolean => {
    for (let tries = 0; tries < 400; tries++) {
      const first = pick();
      const b = stones[Math.floor(rand() * stones.length)];
      // Meeting time: both rings at least 60 out and still within reach.
      const tMin = Math.max(first.t0, b.t) + 60 / sp.speed;
      const tMax = Math.min(first.t0 + (first.maxR * 0.85) / sp.speed, b.t + (R * 0.9) / sp.speed);
      if (tMax <= tMin) continue;
      const T = tMin + rand() * (tMax - tMin);
      const rB = (T - b.t) * sp.speed;
      const rC = (T - first.t0) * sp.speed;
      const d = dist(first.c, b);
      if (d < 1 || d > rB + rC || d < Math.abs(rB - rC)) continue;
      const along = (d * d + rC * rC - rB * rB) / (2 * d);
      const off = Math.sqrt(Math.max(0, rC * rC - along * along)) * (rand() < 0.5 ? -1 : 1);
      const ux = (b.x - first.c.x) / d;
      const uy = (b.y - first.c.y) / d;
      const p = { x: first.c.x + ux * along - uy * off, y: first.c.y + uy * along + ux * off };
      const t1 = first.at(p);
      if (t1 === null || Math.abs(t1 - arrival(b, p)) > goldTol) continue;
      if (!sees(b, p) || !clear(p, 70)) continue;
      lanterns.push({ ...p, kind: 'gold' });
      return true;
    }
    return false;
  };
  for (let g = 0; g < rc.goldViaEcho; g++) {
    const ok = placeGoldWith(() => {
      const e = echoes[Math.floor(rand() * echoes.length)];
      return { c: e.at, t0: e.ringAt, maxR: sp.echoMaxRadius, at: (p) => (sees(e.at, p) ? e.ringAt + dist(e.at, p) / sp.speed : null) };
    });
    if (!ok && !placeGold()) return null;
  }
  for (let g = 0; g < rc.goldViaBounce; g++) {
    const ok = placeGoldWith(() => {
      const m = Math.floor(rand() * walls.length);
      const a = stones[Math.floor(rand() * stones.length)];
      const at = (p: Vec) => {
        const d = pathLength(a, p, m, rocks, walls);
        return d !== null && d <= R * 0.9 ? a.t + d / sp.speed : null;
      };
      return { c: mirrorPoint(a, walls[m]), t0: a.t, maxR: R, at };
    });
    if (!ok && !placeGold()) return null;
  }

  // 5. Plain lanterns somewhere a solution ring passes.
  for (let n = 0; n < rc.plain; n++) {
    let placed = false;
    for (let tries = 0; tries < 300 && !placed; tries++) {
      const s = stones[Math.floor(rand() * stones.length)];
      const p = around(s, 70, R * 0.9);
      if (!clear(p, 60) || !sees(s, p)) continue;
      // The first few drift along a path that stays in their stone's reach and sight the whole way.
      if (n < rc.drift) {
        const a = rand() * Math.PI * 2;
        const len = 80 + rand() * 60;
        const end = { x: p.x + Math.cos(a) * len, y: p.y + Math.sin(a) * len };
        const along = Array.from({ length: 9 }, (_, i) => ({ x: p.x + (end.x - p.x) * (i / 8), y: p.y + (end.y - p.y) * (i / 8) }));
        if (!along.every((q) => clear(q, 60) && sees(s, q) && dist(s, q) <= R * 0.85)) continue;
        const period = 7 + rand() * 3;
        lanterns.push({ ...p, kind: 'plain', drift: { dx: end.x - p.x, dy: end.y - p.y, period, phase: rand() * period } });
        placed = true;
        continue;
      }
      lanterns.push({ ...p, kind: 'plain' });
      placed = true;
    }
  }

  // 6. Rocks that leave the solution intact but block lazy alternatives.
  for (let k = 0; k < rc.rocks; k++) {
    for (let tries = 0; tries < 60; tries++) {
      const r = gp.rockRadiusMin + rand() * (gp.rockRadiusMax - gp.rockRadiusMin);
      const p = randPoint(gp.edgeMargin + r);
      const rock = { ...p, r };
      if (lanterns.some((l) => distToSegment(p, l, pathEnd(l)) < r + 45)) continue;
      if (stones.some((s) => dist(s, p) < r + 40)) continue;
      if (rocks.some((o) => dist(o, p) < o.r + r + 40)) continue;
      if (walls.some((w) => nearWall(p, w) < r + 20)) continue;
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
