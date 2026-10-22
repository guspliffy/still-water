import { describe, expect, it } from 'vitest';
import { generatePond, recipe } from '../src/sim/generator';
import { distToSegment, insidePond, isOccluded } from '../src/sim/geometry';
import { INTROS, pondAt, TUTORIAL } from '../src/sim/levels';
import { Sim, runSolution, type SimEvent } from '../src/sim/sim';
import type { PondDef } from '../src/sim/types';
import { genParams, simParams } from '../src/tuning';

const sp = simParams();
const gp = genParams();

function pond(partial: Partial<PondDef>): PondDef {
  return { id: 'x', title: '', lanterns: [], rocks: [], par: 1, stones: 5, hints: [], solution: [], difficulty: 1, ...partial };
}

function runFor(sim: Sim, seconds: number, dt = 1 / 120): SimEvent[] {
  const all: SimEvent[] = [];
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) all.push(...sim.step(dt));
  return all;
}

describe('geometry', () => {
  it('measures distance to a segment', () => {
    expect(distToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(5);
    expect(distToSegment({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(5);
  });
  it('detects rock occlusion', () => {
    const rock = { x: 50, y: 0, r: 10 };
    expect(isOccluded({ x: 0, y: 0 }, { x: 100, y: 0 }, [rock])).toBe(true);
    expect(isOccluded({ x: 0, y: 0 }, { x: 100, y: 40 }, [rock])).toBe(false);
  });
  it('knows the rounded pond shape', () => {
    expect(insidePond({ x: 300, y: 450 }, 600, 900, 120)).toBe(true);
    expect(insidePond({ x: 2, y: 2 }, 600, 900, 120)).toBe(false);
    expect(insidePond({ x: 2, y: 450 }, 600, 900, 120)).toBe(true);
  });
});

describe('sim', () => {
  it('lights a plain lantern exactly when the ring arrives', () => {
    const sim = new Sim(pond({ lanterns: [{ x: 100, y: 0 + 300, kind: 'plain' }] }), sp);
    sim.dropStone({ x: 100 + 130, y: 300 });
    const ev = runFor(sim, 2);
    const light = ev.find((e) => e.type === 'light');
    expect(light?.t).toBeCloseTo(130 / sp.speed, 6);
  });

  it('timing is independent of step size', () => {
    const make = () => {
      const s = new Sim(pond({ lanterns: [{ x: 300, y: 300, kind: 'echo' }, { x: 300, y: 430, kind: 'plain' }] }), sp);
      s.dropStone({ x: 300, y: 150 });
      return s;
    };
    const a = runFor(make(), 3, 1 / 30).filter((e) => e.type === 'light').map((e) => e.t);
    const b = runFor(make(), 3, 1 / 240).filter((e) => e.type === 'light').map((e) => e.t);
    expect(a.length).toBe(2);
    a.forEach((t, i) => expect(t).toBeCloseTo(b[i], 6));
  });

  it('does not light a ring blocked by a rock', () => {
    const sim = new Sim(pond({ lanterns: [{ x: 300, y: 500, kind: 'plain' }], rocks: [{ x: 300, y: 420, r: 30 }] }), sp);
    sim.dropStone({ x: 300, y: 330 });
    expect(runFor(sim, 3).some((e) => e.type === 'light')).toBe(false);
  });

  it('lights gold only when two rings meet inside the window', () => {
    const gold = pond({ lanterns: [{ x: 300, y: 450, kind: 'gold' }] });
    const together = new Sim(gold, sp);
    together.dropStone({ x: 150, y: 450 });
    together.dropStone({ x: 450, y: 450 });
    expect(runFor(together, 3).some((e) => e.type === 'light')).toBe(true);

    const apart = new Sim(gold, sp);
    apart.dropStone({ x: 150, y: 450 });
    const first = runFor(apart, sp.goldWindow + 0.3);
    apart.dropStone({ x: 450, y: 450 });
    const later = [...first, ...runFor(apart, 3)];
    expect(later.some((e) => e.type === 'light')).toBe(false);
    expect(later.some((e) => e.type === 'goldMiss')).toBe(true);
    expect(later.some((e) => e.type === 'goldNearMiss')).toBe(true);
  });

  it('one ring cannot light gold on its own', () => {
    const sim = new Sim(pond({ lanterns: [{ x: 300, y: 450, kind: 'gold' }] }), sp);
    sim.dropStone({ x: 300, y: 300 });
    expect(runFor(sim, 3).some((e) => e.type === 'light')).toBe(false);
  });

  it('echo lanterns cascade', () => {
    const sim = new Sim(INTROS[3], sp);
    const s = INTROS[3].solution[0];
    sim.dropStone(s);
    const ev = runFor(sim, 8);
    expect(ev.filter((e) => e.type === 'light').length).toBe(5);
    expect(ev.at(-1)?.type).toBe('complete');
  });

  it('moon lanterns ignore stone rings and wake to an echo', () => {
    const moon = { x: 300, y: 400, kind: 'moon' as const };
    const alone = new Sim(pond({ stones: 1, lanterns: [moon] }), sp);
    alone.dropStone({ x: 300, y: 500 });
    expect(runFor(alone, 4).some((e) => e.type === 'stilled')).toBe(true);
    const withEcho = new Sim(pond({ stones: 1, lanterns: [moon, { x: 300, y: 540, kind: 'echo' }] }), sp);
    withEcho.dropStone({ x: 300, y: 600 });
    expect(runFor(withEcho, 6).at(-1)?.type).toBe('complete');
  });

  it('runs out of stones into a calm stilled state', () => {
    const sim = new Sim(pond({ stones: 1, lanterns: [{ x: 300, y: 100, kind: 'plain' }] }), sp);
    sim.dropStone({ x: 300, y: 800 });
    expect(sim.dropStone({ x: 300, y: 700 })).toBeNull();
    expect(runFor(sim, 4).some((e) => e.type === 'stilled')).toBe(true);
  });

  it('refuses drops on rocks and outside the pond', () => {
    const sim = new Sim(pond({ rocks: [{ x: 300, y: 450, r: 30 }] }), sp);
    expect(sim.dropStone({ x: 300, y: 450 })).toBeNull();
    expect(sim.dropStone({ x: -10, y: 450 })).toBeNull();
    expect(sim.stonesLeft).toBe(5);
  });
});

describe('ponds', () => {
  it.each([...TUTORIAL, ...Object.values(INTROS)].map((p) => [p.id, p] as const))('teaching pond %s is solvable at par', (_id, p) => {
    expect(p.solution.length).toBe(p.par);
    expect(runSolution(p, sp, p.solution).done).toBe('complete');
  });

  it('generated ponds are solvable at par and deterministic', () => {
    for (let d = 1; d <= 10; d++) {
      for (let seed = 0; seed < 6; seed++) {
        const p = generatePond(seed, d, sp, gp);
        expect(runSolution(p, sp, p.solution).done).toBe('complete');
        expect(p.stones).toBe(p.par + gp.spareStones);
        expect(p.lanterns.filter((l) => l.kind === 'gold').length).toBe(recipe(p.difficulty).gold);
      }
    }
    expect(generatePond(42, 5, sp, gp)).toEqual(generatePond(42, 5, sp, gp));
  });

  it('keeps echo and rocks out of levels before their intro', () => {
    for (let level = 0; level < 24; level++) {
      for (const d of [1, 4, 8]) {
        const p = pondAt(TUTORIAL.length + level, d, sp, gp);
        if (level < 3) expect(p.lanterns.some((l) => l.kind === 'echo')).toBe(false);
        if (level < 6) expect(p.rocks.length).toBe(0);
        if (level < 9) expect(p.lanterns.some((l) => l.kind === 'moon')).toBe(false);
      }
    }
  });
});

describe('ring rendering helpers', async () => {
  const { visibleArcs } = await import('../src/render/arcs');
  it('removes rock shadows from a full ring', () => {
    expect(visibleArcs([])).toEqual([[0, Math.PI * 2]]);
    const arcs = visibleArcs([[1, 2]]);
    expect(arcs).toEqual([[0, 1], [2, Math.PI * 2]]);
  });
  it('handles gaps that wrap past zero and overlap', () => {
    const arcs = visibleArcs([[-0.5, 0.5], [0.3, 1]]);
    expect(arcs[0][0]).toBeCloseTo(1);
    expect(arcs[0][1]).toBeCloseTo(Math.PI * 2 - 0.5);
    expect(arcs.length).toBe(1);
  });
});
