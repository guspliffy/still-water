import defaults from '../config/tuning.json';
import type { GenParams } from './sim/generator';
import type { SimParams } from './sim/types';

export type Tuning = typeof defaults;

/** Live tuning values. The dev panel mutates this object in place; code reads it every time. */
export const tuning: Tuning = structuredClone(defaults);

export function simParams(t: Tuning = tuning): SimParams {
  return {
    width: t.pond.width,
    height: t.pond.height,
    cornerRadius: t.pond.cornerRadius,
    speed: t.ripple.speed,
    maxRadius: t.ripple.maxRadius,
    echoMaxRadius: t.ripple.echoMaxRadius,
    echoDelay: t.ripple.echoDelay,
    goldWindow: t.gold.window,
    nearMissFactor: t.gold.nearMissFactor,
  };
}

export function genParams(t: Tuning = tuning): GenParams {
  return {
    edgeMargin: t.pond.edgeMargin,
    lanternMinSpacing: t.generator.lanternMinSpacing,
    rockRadiusMin: t.generator.rockRadiusMin,
    rockRadiusMax: t.generator.rockRadiusMax,
    spareStones: t.stones.spare,
    maxDifficulty: t.generator.maxDifficulty,
  };
}
