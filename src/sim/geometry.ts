import type { RockDef, Vec, WallDef } from './types';

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

/** Where segment pq crosses segment ab, as a fraction along pq, or -1 if it doesn't. */
export function crossAt(p: Vec, q: Vec, ax: number, ay: number, bx: number, by: number): number {
  const rx = q.x - p.x;
  const ry = q.y - p.y;
  const sx = bx - ax;
  const sy = by - ay;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return -1;
  const qx = ax - p.x;
  const qy = ay - p.y;
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}

const crossesWall = (p: Vec, q: Vec, w: WallDef) => crossAt(p, q, w.ax, w.ay, w.bx, w.by) >= 0;

/** Signed side of the wall's line that p lies on (0 = on the line). */
export function sideOf(p: Vec, w: WallDef): number {
  return Math.sign((w.bx - w.ax) * (p.y - w.ay) - (w.by - w.ay) * (p.x - w.ax));
}

/** p reflected across the wall's line: where a bounced ring seems to come from. */
export function mirrorPoint(p: Vec, w: WallDef): Vec {
  const dx = w.bx - w.ax;
  const dy = w.by - w.ay;
  const t = ((p.x - w.ax) * dx + (p.y - w.ay) * dy) / (dx * dx + dy * dy);
  const fx = w.ax + t * dx;
  const fy = w.ay + t * dy;
  return { x: 2 * fx - p.x, y: 2 * fy - p.y };
}

/** True when a rock or a wall (other than `skip`) stands between from and to. */
export function blocked(from: Vec, to: Vec, rocks: readonly RockDef[], walls: readonly WallDef[], skip = -1): boolean {
  if (isOccluded(from, to, rocks)) return true;
  return walls.some((w, i) => i !== skip && crossesWall(from, to, w));
}

/**
 * How far a ring from src travels to reach `to`: straight (mirror -1), or bounced once off
 * walls[mirror]. Null when that path is blocked or doesn't exist. Ring position stays exact:
 * a bounced ring is a ring centred on src's mirror image, seen only on src's side of the wall.
 */
export function pathLength(src: Vec, to: Vec, mirror: number, rocks: readonly RockDef[], walls: readonly WallDef[]): number | null {
  if (mirror < 0) return blocked(src, to, rocks, walls) ? null : dist(src, to);
  const w = walls[mirror];
  const s = sideOf(src, w);
  if (s === 0 || sideOf(to, w) !== s) return null;
  const img = mirrorPoint(src, w);
  const t = crossAt(img, to, w.ax, w.ay, w.bx, w.by);
  if (t < 0) return null;
  const hit = { x: img.x + (to.x - img.x) * t, y: img.y + (to.y - img.y) * t };
  if (blocked(src, hit, rocks, walls, mirror) || blocked(hit, to, rocks, walls, mirror)) return null;
  return dist(img, to);
}

/** Every way a ring from src reaches `to` (straight and each bounce), as path lengths. */
export function allPaths(src: Vec, to: Vec, rocks: readonly RockDef[], walls: readonly WallDef[]): number[] {
  const out: number[] = [];
  for (let m = -1; m < walls.length; m++) {
    const d = pathLength(src, to, m, rocks, walls);
    if (d !== null) out.push(d);
  }
  return out;
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
