import { dist, insidePond, isOccluded } from './geometry';
import type { LanternDef, PondDef, SimParams, Vec } from './types';

export interface Ripple {
  id: number;
  x: number;
  y: number;
  /** Sim time the ring starts expanding (may be in the future for a scheduled echo). */
  t0: number;
  maxR: number;
  source: 'stone' | 'echo';
  /** Lantern that emitted this ring, for echoes. */
  lantern: number;
}

export interface LanternState {
  def: LanternDef;
  lit: boolean;
  litAt: number;
  /** Gold only: time the current window opened, or -1 when no window is open. */
  windowOpenedAt: number;
  windowRipple: number;
}

export type SimEvent =
  | { type: 'drop'; t: number; x: number; y: number; ripple: number; stonesLeft: number }
  | { type: 'light'; t: number; lantern: number; kind: LanternDef['kind'] }
  | { type: 'echo'; t: number; lantern: number; ripple: number }
  | { type: 'goldTouch'; t: number; lantern: number }
  | { type: 'goldMiss'; t: number; lantern: number }
  | { type: 'goldNearMiss'; t: number; lantern: number; lateBy: number }
  | { type: 'complete'; t: number; stonesUsed: number }
  | { type: 'stilled'; t: number };

interface Hit {
  t: number;
  lantern: number;
  ripple: Ripple;
}

/**
 * Deterministic pond simulation. Ring radius is analytic (speed * age), and every crossing is
 * timed exactly, so results do not depend on step size or frame rate.
 */
export class Sim {
  readonly pond: PondDef;
  readonly p: SimParams;
  time = 0;
  stonesLeft: number;
  ripples: Ripple[] = [];
  lanterns: LanternState[];
  done: 'playing' | 'complete' | 'stilled' = 'playing';
  private nextId = 1;
  private events: SimEvent[] = [];

  constructor(pond: PondDef, params: SimParams) {
    this.pond = pond;
    this.p = params;
    this.stonesLeft = pond.stones;
    this.lanterns = pond.lanterns.map((def) => ({ def, lit: false, litAt: -1, windowOpenedAt: -1, windowRipple: -1 }));
  }

  get stonesUsed(): number {
    return this.pond.stones - this.stonesLeft;
  }

  /** Whether a stone may be dropped here: inside the pond and not on a rock. */
  canDropAt(p: Vec): boolean {
    if (!insidePond(p, this.p.width, this.p.height, this.p.cornerRadius, 6)) return false;
    return !this.pond.rocks.some((r) => dist(p, r) < r.r + 4);
  }

  dropStone(p: Vec): Ripple | null {
    if (this.done !== 'playing' || this.stonesLeft <= 0 || !this.canDropAt(p)) return null;
    this.stonesLeft--;
    const r = this.addRipple(p, this.time, this.p.maxRadius, 'stone', -1);
    this.events.push({ type: 'drop', t: this.time, x: p.x, y: p.y, ripple: r.id, stonesLeft: this.stonesLeft });
    return r;
  }

  radiusAt(r: Ripple, t: number): number {
    return Math.max(0, (t - r.t0) * this.p.speed);
  }

  /** Advance by dt seconds and return the events that happened, in time order. */
  step(dt: number): SimEvent[] {
    const t0 = this.time;
    const t1 = t0 + dt;
    const hits: Hit[] = [];
    for (const rip of this.ripples) this.collectHits(rip, t0, t1, hits);

    // Hits can spawn echoes that hit things inside the same step, so process in time order.
    while (hits.length > 0) {
      hits.sort((a, b) => a.t - b.t);
      const h = hits.shift()!;
      const spawned = this.applyHit(h);
      if (spawned) this.collectHits(spawned, h.t, t1, hits);
    }

    this.time = t1;
    this.expireGoldWindows();
    this.ripples = this.ripples.filter((r) => t1 < r.t0 + r.maxR / this.p.speed);
    this.checkEnd();
    const out = this.events;
    this.events = [];
    return out;
  }

  /** True while any ring is still moving or a gold lantern is waiting for a second ring. */
  get busy(): boolean {
    return this.ripples.length > 0 || this.lanterns.some((l) => l.windowOpenedAt >= 0);
  }

  private addRipple(p: Vec, t0: number, maxR: number, source: Ripple['source'], lantern: number): Ripple {
    const r: Ripple = { id: this.nextId++, x: p.x, y: p.y, t0, maxR, source, lantern };
    this.ripples.push(r);
    return r;
  }

  private collectHits(rip: Ripple, ta: number, tb: number, out: Hit[]): void {
    const rA = this.radiusAt(rip, ta);
    const rB = Math.min(this.radiusAt(rip, tb), rip.maxR);
    if (rB <= rA) return;
    this.lanterns.forEach((l, i) => {
      if (i === rip.lantern) return;
      if (l.lit) return;
      const d = dist(rip, l.def);
      // Half-open interval so a crossing on a step boundary counts exactly once.
      if (d > rA && d <= rB && !isOccluded(rip, l.def, this.pond.rocks)) {
        out.push({ t: rip.t0 + d / this.p.speed, lantern: i, ripple: rip });
      }
      if (d === 0 && rA === 0) out.push({ t: rip.t0, lantern: i, ripple: rip });
    });
  }

  private applyHit(h: Hit): Ripple | null {
    const l = this.lanterns[h.lantern];
    if (l.lit) return null;
    if (l.def.kind !== 'gold') return this.light(h.lantern, h.t);

    if (l.windowOpenedAt >= 0 && l.windowRipple !== h.ripple.id) {
      const gap = h.t - l.windowOpenedAt;
      if (gap <= this.p.goldWindow) return this.light(h.lantern, h.t);
      if (gap <= this.p.goldWindow * this.p.nearMissFactor) {
        this.events.push({ type: 'goldNearMiss', t: h.t, lantern: h.lantern, lateBy: gap - this.p.goldWindow });
      }
    }
    l.windowOpenedAt = h.t;
    l.windowRipple = h.ripple.id;
    this.events.push({ type: 'goldTouch', t: h.t, lantern: h.lantern });
    return null;
  }

  private light(i: number, t: number): Ripple | null {
    const l = this.lanterns[i];
    l.lit = true;
    l.litAt = t;
    l.windowOpenedAt = -1;
    this.events.push({ type: 'light', t, lantern: i, kind: l.def.kind });
    if (l.def.kind !== 'echo') return null;
    const r = this.addRipple(l.def, t + this.p.echoDelay, this.p.echoMaxRadius, 'echo', i);
    this.events.push({ type: 'echo', t: r.t0, lantern: i, ripple: r.id });
    return r;
  }

  private expireGoldWindows(): void {
    this.lanterns.forEach((l, i) => {
      if (l.lit || l.windowOpenedAt < 0) return;
      // Keep the window record a little past expiry so a near-miss can still be reported.
      const missAt = l.windowOpenedAt + this.p.goldWindow;
      if (this.time >= missAt && l.windowRipple !== -2) {
        this.events.push({ type: 'goldMiss', t: missAt, lantern: i });
        l.windowRipple = -2;
      }
      if (this.time >= l.windowOpenedAt + this.p.goldWindow * this.p.nearMissFactor) {
        l.windowOpenedAt = -1;
        l.windowRipple = -1;
      }
    });
  }

  private checkEnd(): void {
    if (this.done !== 'playing') return;
    if (this.lanterns.every((l) => l.lit)) {
      this.done = 'complete';
      this.events.push({ type: 'complete', t: this.time, stonesUsed: this.stonesUsed });
    } else if (this.stonesLeft === 0 && this.ripples.length === 0) {
      this.done = 'stilled';
      this.events.push({ type: 'stilled', t: this.time });
    }
  }
}

/** Run a list of timed drops to the end. Used by the generator and tests. */
export function runSolution(pond: PondDef, params: SimParams, drops: { x: number; y: number; t: number }[], stepHz = 120): Sim {
  const sim = new Sim({ ...pond, stones: Math.max(pond.stones, drops.length) }, params);
  const queue = [...drops].sort((a, b) => a.t - b.t);
  const dt = 1 / stepHz;
  const limit = 30;
  while (sim.time < limit) {
    while (queue.length > 0 && queue[0].t <= sim.time + 1e-9) sim.dropStone(queue.shift()!);
    sim.step(dt);
    if (sim.done === 'complete') break;
    if (queue.length === 0 && !sim.busy) break;
  }
  return sim;
}
