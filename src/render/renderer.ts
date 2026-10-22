import { pathLength } from '../sim/geometry';
import type { Sim, SimEvent } from '../sim/sim';
import type { Vec } from '../sim/types';

export interface GoldPreview {
  lantern: number;
  /** Seconds between this stone's arrival and the closest other ring (negative = this one first). */
  offset: number;
  match: boolean;
}

/** What main.ts needs from a renderer. Both the 2D (Pixi) and 3D (Three) views implement it. */
export interface PondRenderer {
  readonly canvas: HTMLCanvasElement;
  previewAt: Vec | null;
  goldPreview: GoldPreview[];
  targets: Vec[];
  /** True while the Watch replay aims for the player: reach circle only, no meeting band. */
  ghost: boolean;
  build(sim: Sim): void;
  layout(screenW: number, screenH: number, top: number, bottom: number): void;
  /** Screen point to pond coordinates. */
  toWorld(clientX: number, clientY: number): Vec;
  onEvent(e: SimEvent): void;
  render(now: number, realDt: number): void;
}

/** Which gold lanterns a stone dropped at p right now would pair with a ring already moving. */
export function computeGoldPreview(sim: Sim, p: Vec): GoldPreview[] {
  const out: GoldPreview[] = [];
  const { speed, maxRadius, goldWindow } = sim.p;
  sim.lanterns.forEach((l, i) => {
    if (l.lit || l.def.kind !== 'gold') return;
    // A stone can reach a gold lantern straight and by bounces, and one can pair with another.
    const mine = sim.pathsTo(p, l.def).filter((d) => d <= maxRadius).map((d) => sim.time + d / speed);
    if (mine.length === 0) return;
    const others: number[] = [];
    if (l.windowOpenedAt >= 0) others.push(l.windowOpenedAt);
    for (const r of sim.ripples) {
      const dr = pathLength({ x: r.sx, y: r.sy }, l.def, r.mirror, sim.pond.rocks, sim.walls);
      if (dr === null || dr > r.maxR) continue;
      const tArr = r.t0 + dr / speed;
      if (tArr >= sim.time) others.push(tArr);
    }
    let best = Infinity;
    mine.forEach((tNew, k) => {
      for (const t of [...others, ...mine.slice(k + 1)]) if (Math.abs(tNew - t) < Math.abs(best)) best = tNew - t;
    });
    if (!Number.isFinite(best)) return;
    out.push({ lantern: i, offset: best, match: Math.abs(best) <= goldWindow });
  });
  return out;
}
