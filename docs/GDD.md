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
- §3.5 **End.** All lanterns lit: complete. Out of stones and no ring moving: "the water settles", instant retry. Stars count every throw on the level, retries included: 3 for a perfect solve (par or under, no wasted stone), 2 for one wasted throw, else 1. "Again" after a solve starts the count fresh.
- §3.6 **Level map and adaptive difficulty** (Jonny, 2026-10-21). After the five lessons comes a map of 12 named stops, then endless open water. Each stop has three versions (easier, normal, harder: 36 ponds), seeded so every player gets the same ponds. Difficulty = `levels.baseStart + level * baseStep + (tier - 1) * tierStep`, so the path gets steadily deeper. Tier starts normal. 3 stars: next level harder. 2 stars: same; `twoStarsToEase` 2-star results in a row: easier. 1 star or skip: easier. The tier is never shown, so nobody is labelled weak. Replays from the map use the version played and only improve stars.

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
5. **Meeting band.** While aiming, a soft gold band marks where the ring you'd drop now meets each ring already moving, as wide as the gold window; its bright centre line is "exactly together". A gold lantern inside the band will light (`assist.meetPreview`).
6. **Missed lanterns.** After the water settles, unlit lanterns pulse softly so the failure is readable.
7. **Generous window.** `gold.window` 0.7 s (raised from 0.5 after Jonny found doubles stressful) and a slow ring (130 u/s).

## §5 Content
Five hand-made tutorial ponds teach one idea each: one lantern; one stone lights two; gold between two lily pads; echo chain of five; rock plus gold plus echo. Then generated ponds. Generator works backwards: place the hidden solution stones and drop times, put gold where two solution rings arrive together, echo lanterns with a lantern only their echo reaches, plain lanterns on solution rings, rocks near lanterns, then verify by simulation. After a failure, "Show lily pads" reveals the solution stone spots.

## §6 Art and audio
**3D (default, `view3d.*`):** night pond seen at a gentle tilt (36° landscape, 22° portrait so the tall pond fills a phone). Water is one shader: ripples bend the surface normals and glow along the ring, lit lanterns cast light pools and glints that the ripples break into streaks, a faint moon glint, darkening toward a stone rim with pebbles and swaying reeds. Hand-crafted, calm storybook look (src/render/props3d.ts): soft toon light bands, thin deep-blue outlines, warm paper and wood against teal night water. Lanterns float and bob, with canvas-painted detail: paper lantern with bamboo ribs, vermilion bands, painted blossoms that show as silhouettes when lit, domed lid and tassel on a plank float (plain); hexagonal pavilion with shoji lattice panels, curved roof with ridges and eave bells (echo); lotus with three rings of cream-to-pink petals, golden stamens and a faceted crystal with orbiting motes (gold). Glow passes are multisampled and shader lines widen to one pixel minimum, so the image stays clean at any resolution. Rocks are light grey rounded boulders with moss so they stand out. Lily pads have thickness, some with water lilies; grass, reeds and round bushes line the bank. Fireflies drift above. Bloom makes lit things glow. Gold timers, echo pings, aim circle and tap markers are drawn on the water surface. `?2d` keeps the flat prototype.

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
