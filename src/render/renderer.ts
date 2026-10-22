import { dist, isOccluded } from '../sim/geometry';
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
    const d = dist(p, l.def);
    if (d > maxRadius || isOccluded(p, l.def, sim.pond.rocks)) return;
    const tNew = sim.time + d / speed;
    let best = Infinity;
    if (l.windowOpenedAt >= 0) best = tNew - l.windowOpenedAt;
    for (const r of sim.ripples) {
      const dr = dist(r, l.def);
      if (dr > r.maxR || isOccluded(r, l.def, sim.pond.rocks)) continue;
      const tArr = r.t0 + dr / speed;
      if (tArr < sim.time) continue;
      const off = tNew - tArr;
      if (Math.abs(off) < Math.abs(best)) best = off;
    }
    if (!Number.isFinite(best)) return;
    out.push({ lantern: i, offset: best, match: Math.abs(best) <= goldWindow });
  });
  return out;
}
