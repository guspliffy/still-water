import type { RockDef, Vec } from './types';

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Shortest distance from point p to segment ab. */
export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** True when a ring centred on `from` cannot reach `to` because a rock is in the way. */
export function isOccluded(from: Vec, to: Vec, rocks: readonly RockDef[]): boolean {
  for (const r of rocks) {
    if (distToSegment(r, from, to) < r.r) return true;
  }
  return false;
}

/**
 * Angular intervals (radians, start < end, may exceed PI) a rock hides from a ring centred on c.
 * Returns the hidden interval and the radius beyond which it applies.
 */
export function rockShadow(c: Vec, rock: RockDef): { a0: number; a1: number; fromR: number } | null {
  const d = dist(c, rock);
  if (d <= rock.r) return null;
  const mid = Math.atan2(rock.y - c.y, rock.x - c.x);
  const half = Math.asin(rock.r / d);
  return { a0: mid - half, a1: mid + half, fromR: Math.sqrt(d * d - rock.r * rock.r) };
}

/** Rounded-rectangle containment for the pond, with an optional inset margin. */
export function insidePond(p: Vec, w: number, h: number, cr: number, margin = 0): boolean {
  const x0 = margin;
  const y0 = margin;
  const x1 = w - margin;
  const y1 = h - margin;
  if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) return false;
  const r = Math.max(0, cr - margin);
  const cx = Math.min(Math.max(p.x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(p.y, y0 + r), y1 - r);
  return Math.hypot(p.x - cx, p.y - cy) <= r;
}

/** Deterministic PRNG (mulberry32) so a seed always produces the same pond. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
