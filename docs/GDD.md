# Still Water: game design

## §0 Pitch and stack
A dark, quiet pond with unlit lanterns. Drop a stone and a ring of light spreads out; every lantern it touches starts to glow. Gold lanterns light only where two rings meet. Pleasure: watching geometry happen, and predicting where rings will meet.

Stack: TypeScript, Vite, PixiJS, Vitest, Web Audio synth, Tweakpane. Static web app, phone and desktop. This build is a comparison prototype against Bloom: core loop plus enough feel to judge appeal. No menus, accounts, leaderboards or meta progression yet.

## §1 Pillars
1. **Geometry you can see.** Every outcome is visible on the water before and while it happens.
2. **Unhurried.** No timers or fail pressure. Timing matters only between your own stones, and the window is generous.
3. **Every tap is beautiful.** The very first stone produces the game's best visual and a soft sound.

## §2 Core loop
Read the pond, hover or hold to aim, drop stones, watch the rings and the lantern chime cascade, pond goes still, stars, next pond (about 1 to 2 minutes each).

## §3 Mechanics
- §3.1 **Stone.** Tap (mouse: press; touch: release, so holding shows a preview). Spends one stone. Refused on rocks or outside the pond with a dry "tock". Key: `stones.spare` (stones = par + spare).
- §3.2 **Ring.** Expands at `ripple.speed` u/s to `ripple.maxRadius`, fading with `ripple.fadePower`. Hit time is analytic: t0 + distance / speed.
- §3.3 **Lanterns.** Plain: lights on any ring. Echo (blue hexagon that pings): lights and, after `ripple.echoDelay`, sends a smaller ring (`ripple.echoMaxRadius`). Gold (diamond): lights when two different rings pass it within `gold.window` seconds.
- §3.4 **Rocks** block rings; the ring is drawn with a gap behind the rock (its shadow), and lanterns in the shadow are not hit.
- §3.5 **End.** All lanterns lit: complete. Out of stones and no ring moving: "the water settles", instant retry. Stars: 3 at or under par, 2 at par+1, else 1.
- §3.6 **Adaptive difficulty.** After the tutorial, ponds are generated per index and difficulty 1 to 10 (`generator.*`). Clean par solve: +1. Two failures or par+2 or worse: -1. Skip: -1. Label: Gentle (1-3), Lively (4-6), Deep (7-10). The rules never change; only the pond does.

## §4 Feel targets
- Drop response under 50 ms: sound and splash fire in the input handler.
- Ring readable as moving: bright core, glow, and two trailing wakes at -16 and -34 u.
- Lantern light: elastic pop over `feel.lanternLightMs` (420 ms), glow and water reflection fade in over 120 to 300 ms.
- Gold flare: two expanding rings over `feel.goldFlareMs` (700 ms) plus a three-note chord.
- Cascade: lanterns lit within `feel.cascadeNoteWindow` (1.6 s) of the previous one climb the D-major pentatonic, so chains play a rising phrase.

### §4.1 Timing readability (the concept's biggest risk)
1. **Reach preview.** Hover (mouse) or hold (touch, after `assist.touchHoldPreviewMs`) shows the dashed circle where this stone's ring fades, and rings the lanterns it would light (`assist.reachPreview`).
2. **Gold match preview.** While aiming, a gold lantern pulses bright when a stone dropped *now* would arrive within the window of a ring already travelling (`assist.goldMatchPreview`). Turn it off in the panel to test pure judgement.
3. **Visible window.** When the first ring touches a gold lantern it half-glows and a gold arc drains around it over the window, with a quiet high shimmer you can hear.
4. **Near-miss feedback.** If a second ring arrives up to `gold.nearMissFactor` windows late, a floating note says how far apart the rings were ("0.62s apart").
5. **Generous window.** `gold.window` 0.5 s (the concept doc's assist value) and a slow ring (130 u/s).

## §5 Content
Five hand-made tutorial ponds teach one idea each: one lantern; one stone lights two; gold between two lily pads; echo chain of five; rock plus gold plus echo. Then generated ponds. Generator works backwards: place the hidden solution stones and drop times, put gold where two solution rings arrive together, echo lanterns with a lantern only their echo reaches, plain lanterns on solution rings, rocks near lanterns, then verify by simulation. After a failure, "Show lily pads" reveals the solution stone spots.

## §6 Art and audio
Ink-blue water (radial gradient, drifting motes, two faint koi shadows), rings of warm light (#ffe2b0), echo lanterns and rings cool blue (#7fe0ff, #5fd4ff), gold #ffc23d. Shapes separate kinds without color: circle, hexagon, diamond. All sound is synthesized: stone "bloop" (sine 620 to 150 Hz plus noise splash), bell partials for lanterns, chord for gold, soft sigh on a missed window, low pad and water hush ambience, generated reverb.

## §7 UX flow
First visit opens on a welcome card: "Drop stones on the pond. Ripples light the lanterns they touch. Light every lantern." Then straight into the pond. Top: pond number, mood label, restart, sound, tuning. Bottom: stones, with a divider at par. Completion card at the bottom so the lit pond stays visible. Keys: R restart, M mute, T panel, Enter continue. The "?" button opens a how-to-play sheet with every element.

### §7.1 Teaching (src/ui/coach.ts)
Learning by doing, one short line at a time in a banner above the pond, plus pulsing "tap here" markers on lily pads. Lines react to play: after the first stone in pond 3 the marker moves to the other pad ("Now the other one, quickly!"); a missed gold window says to tap both faster. Each new element (gold, echo, rock) gets a one-sentence card with its icon before its pond. Teaching ponds never show a failure screen: out of stones resets the pond with a line, and pond 5 reveals lily pads after one reset. Stones are labelled "stones · par N".

## §8 Backlog
- Plan mode (place stones with time paused, set delays, press play) if live timing proves fiddly.
- Daily pond with a fixed seed and adaptation off; score on stones and timing precision.
- Koi home pond that fills from stars; pond map.
- Currents that stretch rings, three-ring lanterns, lanterns that must stay dark.
- Ripple distortion shader for the water surface.
