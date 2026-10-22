# Still Water: game design

## §0 Pitch and stack
A dark, quiet pond with unlit lanterns. Drop a stone and a ring of light spreads out; every lantern it touches glows. Gold lanterns light only where two rings meet. Pleasure: watching geometry happen, and predicting where rings will meet.

Stack: TypeScript, Vite, Three.js (default), PixiJS (`?2d`), Vitest, Web Audio synth, Tweakpane. Static web app, phone and desktop; comparison prototype against Bloom, heading to alpha.

## §1 Pillars
1. **Geometry you can see.** Every outcome is visible on the water before and while it happens.
2. **Unhurried.** No timers or fail pressure. Timing matters only between your own stones, and the window is generous.
3. **Every tap is beautiful.** The first stone produces the game's best visual and a soft sound. A finished pond looks calm, never blinding: light is a budget (§4.2).

## §2 Core loop
Read the pond, hover or hold to aim, drop stones, watch the rings and the chime cascade, pond goes still, stars, next pond (1 to 2 minutes each).

## §3 Mechanics
- §3.1 **Stone.** Tap (mouse: press; touch: release, so holding previews). Spends one stone. Refused on rocks or outside the pond with a dry "tock". Stones = par + spare (`stones.spare` for hand-made ponds; the recipe's `spare` for generated ones).
- §3.2 **Ring.** Expands at `ripple.speed` u/s to `ripple.maxRadius`, fading with `ripple.fadePower`. Hit time is analytic: t0 + distance / speed.
- §3.3 **Lanterns.** Plain: lights on any ring. Echo (blue hexagon): lights and, after `ripple.echoDelay`, sends a smaller ring (`ripple.echoMaxRadius`). Gold (diamond): lights when two different rings pass it within `gold.window`. Moon (crescent on a post): ignores straight rings, echoes included; lights only from a ring bounced off a mirror wall.
- §3.4 **Rocks** block rings; the ring is drawn with a gap behind the rock, and lanterns in that shadow are not hit.
- §3.4.1 **Mirror walls** block rings and bounce each ring back once: a ring centred on the source's mirror image, seen only on the source's side along paths that touch the wall (`pathLength`). A bounced ring counts as a different ring for gold.
- §3.4.2 **Drifting lanterns** glide back and forth along a dotted path on the pond's clock; a ring catches one where it is when its edge arrives. Rocks can hide it for part of its path.
- §3.5 **End.** All lanterns lit: complete. Out of stones and no ring moving: "the water settles", instant retry. Stars count every throw on the level, retries included: 3 for a perfect solve (par or under, nothing wasted), 2 for one wasted throw, else 1 (Jonny's rule). "Again" after a solve starts the count fresh.
- §3.6 **Map and adaptive difficulty.** After two lessons, a map of 24 named stops, then endless open water. Each stop has three seeded versions (easier, normal, harder). Difficulty = `levels.baseStart + level * baseStep + (tier - 1) * tierStep`, clamped to `generator.maxDifficulty`. 3 stars: harder next; 2 stars: same, `twoStarsToEase` in a row: easier; 1 star or skip: easier. The tier is never shown. Replays use the version played and only improve stars.

## §4 Feel targets
- Drop response under 50 ms: sound and splash fire in the input handler. The drop is the most frequent action, so it gets the richest feedback: splash crown, droplets, dimple mark, one 10 ms haptic, and a newborn ring whose core is 1.3x bright easing to 1 over `feel.ringBirthMs` (300 ms).
- Ring readable as moving: bright core, glow, two trailing wakes at -16 and -34 u.
- Lantern light: elastic pop over `feel.lanternLightMs` (420 ms) at full intensity, then the settle in §4.2.
- Gold flare: two expanding rings over `feel.goldFlareMs` (700 ms) plus a three-note chord.
- Cascade: lanterns lit within `feel.cascadeNoteWindow` (1.6 s) of the previous one climb the D-major pentatonic.

### §4.1 Timing readability (the concept's biggest risk)
Rule: the gold verdict is readable before the stone lands, and the predictive help is optional. Always on:
1. **Reach preview.** Hover, or hold on touch after `assist.touchHoldPreviewMs`, shows the dashed circle where this ring fades (`assist.reachPreview`). While aiming it is the only circle on the pond (Jonny, 2026-10-22: more circles confused him); lanterns in reach are not ringed.
2. **Visible window.** When the first ring touches a gold it half-glows and a gold arc drains around it over the window, with a quiet shimmer.
3. **Near miss.** A second ring up to `gold.nearMissFactor` windows late gets a floating "0.62s apart".
4. **Missed lanterns** pulse after the water settles. **Par up front** in the banner until the first throw. **Watch** replays at `feel.replaySpeed`, reach circle `feel.replayAimLead` s before each stone.
5. **Generous window.** `gold.window` 0.7 s, ring speed 130 u/s.

**Timing help** (settings toggle, default on; sets `assist.goldMatchPreview`):
6. ~~Meeting band~~ and ~~partner circle~~: cut 2026-10-22 (Jonny: too many circles). `assist.meetPreview` stays in the dev panel, off.
7. **Gold verdict on the lantern.** A gold in reach that dropping now would light glows in pulses at `feel.goldMatchPulseHz` (2 Hz), the lantern itself and no ring. Touch drops on release, so the pulse at release is the verdict.

### §4.2 Light budget (Jonny, 2026-10-22: "too many lights gets disturbing")
Cause: a lit lantern held its pop intensity forever (emissive, additive sprite, shader pool and glint, all summed uncapped), so brightness grew to 18 lanterns at full and bloom smeared the overlaps. Fix: the newest light is the brightest thing on the pond; everything else settles.
- **Pop** 0 to `feel.lanternLightMs`: intensity 1.0 (gold 1.3); emissive, sprite and shader light share one intensity.
- **Settle** to `feel.lanternSettleMs` (1800 ms): smoothstep down to `view3d.litSteady` (0.45; gold `view3d.litSteadyGold` 0.55).
- **Breath** replaces flicker: ±`view3d.litBreath` (0.06) at `view3d.litBreathHz` (0.25), phases offset per lantern. On completion the phases ease to one over `feel.breatheTogetherMs` (2000 ms): the solved pond breathes together.
- **Budget**: with N lit, steady is multiplied by min(1, `view3d.litBudget` / N) (6), never below `view3d.litFloor` (0.25); a popping lantern ignores it. Ten lit sit at 0.27 each, so the end is about as bright as after the sixth lantern.
- **Water**: `view3d.poolGain` 0.10, `view3d.glintGain` 1.2 (were 0.12, 1.6); the summed lantern light is soft-clamped, c = cap × (1 − exp(−sum / cap)), cap `view3d.lightCap` 0.6.
- **Bloom** `view3d.bloom*`: strength 0.5, threshold 0.46, radius 0.3.
- Targets: a lantern lighting is the brightest event in frame; a solved d13 pond has no water above 80% white.

## §5 Content
Two lessons before the map: one lantern; one stone lights two. Each idea arrives in an intro pond where it is first required: level 1 gold, 4 echo chain, 7 rock, 10 mirror wall (bank shot past a rock), 13 moon (only the bounce wakes it), 17 drift (catch it while the rock doesn't hide it). Intros play once, no stars, reset quietly on a fail. Generated ponds use an idea from its intro level on (`featuresAt`); a gated idea's lanterns become plain so the total holds. After 2 fails, "Show a lily pad" reveals one solution spot per press; after 3, Skip.

**Recipe** (`generator.recipe`, one row per difficulty d; `recipe()` returns the row). Overload came from count, so counts are capped and difficulty rises through timing and combination. "lanterns" is the pond total, counting echo tails and wall bank lanterns; "rocks" counts the rock hiding a plain bank lantern; plain = lanterns − gold − 2·echo − moon − hidden bank lanterns. Each wall brings a bank shot: a moon while the moon count lasts, else a hidden plain. `maxDelay` is the largest gap between solution drops. From d8 one gold is placed where an echo ring meets a stone ring (`goldViaEcho`), from d11 another where a bounced ring meets a straight one (`goldViaBounce`).

| d | stones+spare | lanterns | gold | echo | moon | rocks | walls | drift | maxDelay |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 2+2 | 3 | 1 | 0 | 0 | 0 | 0 | 0 | 0.1 |
| 2 | 2+2 | 4 | 1 | 0 | 0 | 0 | 0 | 0 | 0.1 |
| 3 | 2+2 | 4 | 1 | 1 | 0 | 0 | 0 | 0 | 0.2 |
| 4 | 2+2 | 5 | 1 | 1 | 0 | 1 | 0 | 0 | 0.3 |
| 5 | 3+2 | 6 | 1 | 1 | 0 | 1 | 0 | 0 | 0.4 |
| 6 | 3+2 | 6 | 1 | 1 | 0 | 1 | 1 | 0 | 0.5 |
| 7 | 3+2 | 7 | 2 | 1 | 1 | 1 | 1 | 0 | 0.6 |
| 8 | 3+2 | 8 | 2 | 1 | 1 | 2 | 1 | 0 | 0.7 |
| 9 | 3+2 | 8 | 2 | 2 | 1 | 2 | 1 | 1 | 0.8 |
| 10 | 4+1 | 9 | 2 | 2 | 1 | 2 | 1 | 1 | 0.9 |
| 11 | 4+1 | 9 | 2 | 2 | 1 | 2 | 2 | 1 | 1.0 |
| 12 | 4+1 | 10 | 3 | 2 | 1 | 3 | 2 | 1 | 1.1 |
| 13 | 4+1 | 10 | 3 | 2 | 2 | 3 | 2 | 1 | 1.2 |

Caps: 10 lanterns (was 18), 4 stones (5), 3 rocks (6), 2 walls, 1 drifting lantern (2), at most 6 rings in flight (8). `generator.lanternMinSpacing` 84 u (70). Gold sits where solution rings arrive within `generator.goldArrivalTolerance` (0.3) of the window. Generator works backwards: solution stones and drop times, walls with bank shots, gold, echo with a tail only its echo reaches, plain lanterns on solution rings, rocks near lanterns, then verify by simulation; a row that fails 80 attempts falls back to the row above.

## §6 Art and audio
**3D (default, `view3d.*`):** night pond at a gentle tilt (36° landscape, 22° portrait). Water is one shader: ripples bend the normals and glow along the ring, lit lanterns cast pools and glints that ripples break into streaks, darkening toward a stone rim with reeds. Calm storybook look (src/render/props3d.ts): soft toon bands, thin deep-blue outlines, warm paper and wood on teal night water. Lanterns float and bob: paper lantern (plain), hexagonal pavilion (echo), lotus with a crystal (gold), crescent on a post (moon). Rocks are light grey boulders with moss; obstacles (rocks, walls) take an outline `view3d.obstacleOutline` (1.6) times the decoration outline so they survive a greyscale check (`view3d.grayscaleCheck`, dev panel, luminance-only pass). Lily pads and bushes line the bank; fireflies drift above. Glow passes are multisampled and shader lines widen to one pixel minimum. Gold timers, echo pings, aim circle, partner circles and tap markers are drawn on the water. `?2d` keeps the flat prototype.

Rings warm light (#ffe2b0), echo cool blue (#7fe0ff), gold #ffc23d; shapes separate kinds without colour. All sound synthesized: stone "bloop" (sine 620 to 150 Hz plus noise splash), bell partials for lanterns, chord for gold, soft sigh on a missed window, low pad and water hush, generated reverb.

## §7 UX flow
First visit opens on a welcome card: "Drop stones on the pond. Ripples light the lanterns they touch. Light every lantern." Then the pond. **Top bar (2026-10-22): the level name on the left, itself the door to the map ("Reed Bend ›"), and one gear on the right.** Help, full screen and the map button leave the bar. Controls idle at 70% opacity, 100% on hover or press. Bottom: stone pips with a divider at par and the labelled Retry pill beside them, pulsing once stones run out (it stays: that is where the player looks). Completion card at the bottom so the lit pond stays visible. Keys: R restart, M mute, T panel, Enter continue, F full screen.

Settings sheet (basics only): Sound, Vibration (where supported), Timing help (§4.1 items 6 to 8), Full screen (iPhone: Add to Home Screen tip instead); quiet rows: How to play, Level map, Replay lessons, Developer tuning. Saved per device.

### §7.1 Teaching (src/ui/coach.ts)
Learning by doing, one short line at a time in a banner above the pond, plus pulsing "tap here" markers on lily pads. Lines react to play: a missed gold window says to tap both sooner. Each new element gets a one-sentence card with its icon before its intro pond. Teaching ponds never show a failure screen: out of stones resets the pond with a line. How to play lists only elements met so far.

## §8 Backlog
- Generated drift paths partly behind a rock from d12, so the catch must be timed.
- Star pips: the first N stone pips gold before the first throw, so the perfect count reads without words.
- Phase 2 feel: ring crossing sparks, gold slow-down, sky lantern finale (within the light budget).
- Plan mode (stones placed with time paused) if live timing still proves fiddly after §4.1.
- Daily pond with a fixed seed; koi home pond that fills from stars; currents, three-ring lanterns, lanterns that must stay dark.
