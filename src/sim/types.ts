export interface Vec {
  x: number;
  y: number;
}

/**
 * plain lights on any ring; echo lights and sends its own small ring; gold needs two rings inside
 * the window; moon lights only from an echo's ring.
 */
export type LanternKind = 'plain' | 'echo' | 'gold' | 'moon';

export interface LanternDef extends Vec {
  kind: LanternKind;
  /**
   * Drifting lantern: glides from (x, y) to (x + dx, y + dy) and back, easing at each end, once
   * every `period` seconds of pond time, starting `phase` seconds into the cycle.
   */
  drift?: { dx: number; dy: number; period: number; phase: number };
}

/** Where a lantern is at pond time t. */
export function lanternAt(l: LanternDef, t: number): Vec {
  if (!l.drift) return l;
  const u = 0.5 - 0.5 * Math.cos((2 * Math.PI * (t + l.drift.phase)) / l.drift.period);
  return { x: l.x + l.drift.dx * u, y: l.y + l.drift.dy * u };
}

export interface RockDef extends Vec {
  r: number;
}

/** Mirror wall: a straight stone wall from a to b. It blocks rings and bounces them back once. */
export interface WallDef {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/** A stone in a known solution: position plus drop time relative to the first stone. */
export interface StoneDrop extends Vec {
  t: number;
}

export interface PondDef {
  id: string;
  title: string;
  lanterns: LanternDef[];
  rocks: RockDef[];
  /** Mirror walls; absent in ponds from before they existed. */
  walls?: WallDef[];
  /** Stones the known solution uses. */
  par: number;
  /** Stones the player gets. */
  stones: number;
  /** Lily pads drawn as gentle placement hints (tutorial ponds, or after a hint request). */
  hints: Vec[];
  solution: StoneDrop[];
  difficulty: number;
}

export interface SimParams {
  width: number;
  height: number;
  cornerRadius: number;
  speed: number;
  maxRadius: number;
  echoMaxRadius: number;
  echoDelay: number;
  goldWindow: number;
  nearMissFactor: number;
}
