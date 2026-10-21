import { describe, expect, it } from 'vitest';
import { TUTORIAL } from '../src/sim/levels';
import type { Vec } from '../src/sim/types';
import { Coach } from '../src/ui/coach';

function setup() {
  const said: string[] = [];
  let targets: Vec[] = [];
  const coach = new Coach({ say: (t) => said.push(t), point: (t) => (targets = t) }, false);
  return { coach, said, get targets() { return targets; } };
}

describe('coach', () => {
  it('gives every teaching pond an instruction and a target where useful', () => {
    for (const p of TUTORIAL) {
      const c = setup();
      c.coach.start(p, 0, TUTORIAL.length);
      expect(c.said.at(-1)).toBeTruthy();
      if (p.id !== 't5') expect(c.targets.length).toBeGreaterThan(0);
    }
  });

  it('walks the gold lesson: second pad after the first, retry after a miss', () => {
    const c = setup();
    const t3 = TUTORIAL[2];
    c.coach.start(t3, 2, TUTORIAL.length);
    c.coach.onDrop(t3.hints[0]);
    expect(c.targets).toEqual([t3.hints[1]]);
    expect(c.said.at(-1)).toMatch(/other/);
    c.coach.onEvent({ type: 'goldMiss', t: 2, lantern: 0 });
    expect(c.targets).toEqual(t3.hints);
    expect(c.said.at(-1)).toMatch(/faster/);
  });
});
