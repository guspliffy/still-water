# Still Water

Calm web puzzle: drop stones on a dark pond, ripples light lanterns, gold lanterns need two rings meeting. Comparison prototype against Bloom (separate repo). Design: docs/GDD.md. Status: docs/STATE.md.

## Stack
TypeScript, Vite, Three.js (3D view, default), PixiJS 8 (2D view via `?2d`), Vitest, Web Audio synth (no sound files), Tweakpane dev panel. Static site on GitHub Pages via `.github/workflows/pages.yml`.

## Commands
- `npm install` then `npm run dev` (serves on LAN, so a phone on the same Wi-Fi can open it)
- `npm test` (Vitest), `npm run typecheck`, `npm run build` (typecheck + production build to dist/)

## Folder map
- `config/tuning.json`: every gameplay number. Code reads `tuning` from `src/tuning.ts`; never hardcode a value. `generator.recipe` is the per-difficulty level table.
- `src/sim/`: pure simulation, no DOM or Pixi. `sim.ts` (rings, hits, gold windows, echoes, end states), `geometry.ts`, `generator.ts` (backwards pond generator with verified solution), `levels.ts` (lessons, intro ponds, `featuresAt`, `pondAt`).
- `src/render/renderer.ts`: `PondRenderer` interface both views implement, plus `computeGoldPreview`.
- `src/render/view3d.ts` + `water.ts` + `props3d.ts` (toon-shaded lanterns, rocks, lily pads, bushes): Three.js scene; one water shader draws ripples, reflections and surface marks; bloom via EffectComposer.
- `src/render/view.ts`: 2D Pixi view (`?2d`). Views read the sim, never mutate it. `arcs.ts`: rock-shadow arc helper.
- `src/audio/audio.ts`: synthesized sounds and haptics.
- `src/ui/devpanel.ts`: Tweakpane panel bound generically to tuning.json, with export.
- `src/progress.ts`: stars, adaptive difficulty, saved progress. `src/ui/settings.ts`: the player's few settings. `src/ui/map.ts`: level map.
- `src/main.ts`: app wiring, input, overlays, fixed-step loop.
- `tests/`: Vitest specs for sim, generator, progress.

## Architecture rules
- Simulation is deterministic and analytic: ring radius = speed * age, hit time = t0 + distance / speed. Results must not depend on step size (there is a test).
- Fixed timestep (`tuning.sim.stepHz`) with an accumulator; rendering interpolates with `sim.time + acc`.
- Sim emits events; main.ts routes them to view and audio. Keep gameplay logic out of render and audio.
- Every generated pond must pass `runSolution` at par before it is used.
- Avoid allocation-heavy work per frame; ripples redraw into one Graphics.

## Conventions
- Commit per task: `T<id>: <summary>`. Keep CLAUDE.md under 60 lines and STATE.md under 40.
- Dev panel: gear button, `T` key, or `?dev` in the URL. "Export tuning.json" downloads live values to commit.
- `window.stillWater` exposes `{ sim, drop, load }` for automated play-testing.
