import { generatePond, type Features, type GenParams } from './generator';
import type { PondDef, SimParams } from './types';

/** Hand-made ponds that teach one idea each, wordlessly. GDD §5. */
const TEACHING: PondDef[] = [
  {
    id: 't1',
    title: 'First light',
    lanterns: [{ x: 300, y: 380, kind: 'plain' }],
    rocks: [],
    par: 1,
    stones: 3,
    hints: [],
    solution: [{ x: 300, y: 560, t: 0 }],
    difficulty: 0,
  },
  {
    id: 't2',
    title: 'Both shores',
    lanterns: [
      { x: 120, y: 450, kind: 'plain' },
      { x: 480, y: 450, kind: 'plain' },
    ],
    rocks: [],
    par: 1,
    stones: 3,
    hints: [{ x: 300, y: 450 }],
    solution: [{ x: 300, y: 450, t: 0 }],
    difficulty: 0,
  },
  {
    id: 't3',
    title: 'Where rings meet',
    lanterns: [{ x: 300, y: 450, kind: 'gold' }],
    rocks: [],
    par: 2,
    stones: 4,
    hints: [
      { x: 130, y: 450 },
      { x: 470, y: 450 },
    ],
    solution: [
      { x: 130, y: 450, t: 0 },
      { x: 470, y: 450, t: 0 },
    ],
    difficulty: 0,
  },
  {
    id: 't4',
    title: 'Echoes',
    lanterns: [
      { x: 300, y: 640, kind: 'echo' },
      { x: 210, y: 520, kind: 'echo' },
      { x: 320, y: 410, kind: 'echo' },
      { x: 220, y: 300, kind: 'plain' },
      { x: 420, y: 300, kind: 'plain' },
    ],
    rocks: [],
    par: 1,
    stones: 3,
    hints: [{ x: 300, y: 790 }],
    solution: [{ x: 300, y: 790, t: 0 }],
    difficulty: 0,
  },
  {
    id: 't5',
    title: 'Behind the rock',
    lanterns: [
      { x: 300, y: 250, kind: 'plain' },
      { x: 300, y: 480, kind: 'gold' },
      { x: 440, y: 290, kind: 'echo' },
      { x: 150, y: 650, kind: 'plain' },
      { x: 480, y: 700, kind: 'plain' },
      { x: 110, y: 300, kind: 'plain' },
    ],
    rocks: [{ x: 300, y: 370, r: 38 }],
    par: 2,
    stones: 4,
    hints: [],
    solution: [
      { x: 150, y: 480, t: 0 },
      { x: 450, y: 480, t: 0 },
    ],
    difficulty: 1,
  },
  {
    id: 't6',
    title: 'Moonlight',
    lanterns: [
      { x: 300, y: 330, kind: 'moon' },
      { x: 300, y: 470, kind: 'echo' },
      { x: 165, y: 640, kind: 'plain' },
      { x: 435, y: 640, kind: 'plain' },
    ],
    rocks: [],
    par: 1,
    stones: 3,
    hints: [{ x: 300, y: 570 }],
    solution: [{ x: 300, y: 570, t: 0 }],
    difficulty: 0,
  },
  {
    id: 't7',
    title: 'Bank shot',
    lanterns: [
      { x: 330, y: 420, kind: 'plain' },
      { x: 200, y: 640, kind: 'plain' },
      { x: 420, y: 680, kind: 'plain' },
    ],
    rocks: [{ x: 315, y: 490, r: 26 }],
    walls: [{ ax: 400, ay: 370, bx: 400, by: 570 }],
    par: 1,
    stones: 3,
    hints: [{ x: 300, y: 560 }],
    solution: [{ x: 300, y: 560, t: 0 }],
    difficulty: 0,
  },
  {
    id: 't8',
    title: 'Drift',
    lanterns: [
      { x: 170, y: 380, kind: 'plain', drift: { dx: 260, dy: 0, period: 7, phase: 1 } },
      { x: 200, y: 700, kind: 'plain' },
      { x: 400, y: 700, kind: 'plain' },
    ],
    rocks: [{ x: 300, y: 480, r: 34 }],
    par: 1,
    stones: 3,
    hints: [{ x: 300, y: 600 }],
    solution: [{ x: 300, y: 600, t: 0 }],
    difficulty: 0,
  },
];

/** Lessons before the map teach the basics only: one stone, rings, plain lanterns. */
export const TUTORIAL: PondDef[] = TEACHING.slice(0, 2);

/**
 * Intro ponds keyed by 0-based level: the first visit to that stop plays its intro once, then
 * the level. Each new idea arrives where it is first used. GDD §7.1.
 */
export const INTROS: Record<number, PondDef> = { 0: TEACHING[2], 3: TEACHING[3], 6: TEACHING[4], 9: TEACHING[5], 12: TEACHING[6], 16: TEACHING[7] };

/** Generated ponds only use an idea from the level that introduces it. */
export function featuresAt(level: number): Features {
  return { echo: level >= 3, rocks: level >= 6, moon: level >= 9, walls: level >= 12, drift: level >= 16 };
}

/** Names for the stops on the map; beyond them the pond opens into endless water. */
export const LEVEL_NAMES = [
  'Reed Bend', 'Moss Steps', 'Willow Shade', 'Frog Stone', 'Lotus Bay', 'Misty Weir',
  'Cedar Shrine', 'Firefly Hollow', 'Old Bridge', 'Moon Basin', 'Heron Isle', 'Koi Pool',
  'Mirror Lake', 'Bamboo Gate', 'Rain Hollow', 'Stone Garden', 'Drifting Reeds', 'Ferry Steps',
  'Owl Hill', 'Cloud Pool', 'Star Pond', 'Silver Reach', 'Night Garden', 'Still Water',
];
export const OPEN_WATER = 'Open water';

/**
 * Lessons first, then generated levels. Seeds depend only on the index and difficulty, so a
 * level's three versions are the same ponds for every player.
 */
export function pondAt(index: number, difficulty: number, sp: SimParams, gp: GenParams): PondDef {
  if (index < TUTORIAL.length) return TUTORIAL[index];
  const level = index - TUTORIAL.length;
  // Seeds kept from when there were five lessons, so level ponds didn't change with the move.
  const pond = generatePond(1005 + level, difficulty, sp, gp, featuresAt(level));
  return { ...pond, id: `level-${level + 1}-d${difficulty}`, title: LEVEL_NAMES[level] ?? OPEN_WATER };
}
