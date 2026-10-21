import { generatePond, type GenParams } from './generator';
import type { PondDef, SimParams } from './types';

/** Hand-made opening ponds that teach one idea each, wordlessly. GDD §5. */
export const TUTORIAL: PondDef[] = [
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
];

/** Pond n (0-based). After the tutorial, ponds are generated from a fixed seed per index. */
/** Names for the twelve stops on the map; beyond them the pond opens into endless water. */
export const LEVEL_NAMES = [
  'Reed Bend', 'Moss Steps', 'Willow Shade', 'Frog Stone', 'Lotus Bay', 'Misty Weir',
  'Cedar Shrine', 'Firefly Hollow', 'Old Bridge', 'Moon Basin', 'Heron Isle', 'Still Water',
];
export const OPEN_WATER = 'Open water';

/**
 * Lessons first, then generated levels. Seeds depend only on the index and difficulty, so a
 * level's three versions are the same ponds for every player.
 */
export function pondAt(index: number, difficulty: number, sp: SimParams, gp: GenParams): PondDef {
  if (index < TUTORIAL.length) return TUTORIAL[index];
  const level = index - TUTORIAL.length;
  const pond = generatePond(1000 + index, difficulty, sp, gp);
  return { ...pond, id: `level-${level + 1}-d${difficulty}`, title: LEVEL_NAMES[level] ?? OPEN_WATER };
}
