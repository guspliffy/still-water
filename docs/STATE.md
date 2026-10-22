# State

**Milestone:** working toward alpha (phase 1 of 4). Bloom goes to alpha in parallel in its own repo.

**Playable:** welcome card, 2 coached lessons (`?fresh` replays them), a scrolling map of 24 levels with three hidden versions each chosen by stars (GDD §3.6), intro ponds for gold/echo/rock/moon at levels 1/4/7/10, then endless open water. Touch and mouse. Synth audio. Tuning panel.

**3D:** default renderer since 2026-10-21 (Jonny asked for a beautiful 3D experience); `?2d` keeps the flat version. Multisampled glow pass and pixel-aware shader lines keep edges clean; resolution steps down on its own if a phone drops below 40 fps.

**HUD:** map, help, full screen (iPhone shows the Add to Home Screen tip), settings (sound, vibration, timing help). Labelled Retry pill beside the stones that pulses once stones run out.

**Alpha:** Jonny (2026-10-22) is taking both Still Water and Bloom to alpha. Plan: Claude Doc "Still Water: road to alpha" https://claude.ai/artifact/Cc4xjJrwVcqCbszjsxtsTA, with four phases: Understand, Satisfy, Depth, Alpha ready.
Phase 1 progress: done = meeting band, missed lanterns pulse, Watch replay, intro ponds with generator features gated by level, one lily pad per hint (skip after 3 fails), par line at level start. Saves from the five-lesson layout migrate (key v3). Pulled forward from phase 3 at Jonny's ask (2026-10-22): moon lanterns, 24 levels, denser late ponds, basic settings. Mirror walls done (intro level 13, in most later levels). Next = drifting lanterns (intro level 17); then phase 2 (ring crossing sparks, gold slow-down, sky lantern finale) and play data.

## Open owner questions
None open. Answered 2026-10-22: yes to mirror walls, moon lanterns, drifting lanterns; yes to anonymous play data; public link for testers; gold match preview stays as an option, on by default.

## Decisions
- Settings stay basic (Jonny, 2026-10-22): good defaults, player only toggles basics like sound.
- More levels and more lanterns/obstacles per level (Jonny, 2026-10-22).
- Three.js for the 3D view, sim untouched: the renderer interface let 2D and 3D share all game logic.
- Touch drops on release, mouse on press: lets touch players hold to aim without a second gesture.
- Gold window 0.7 s (was 0.5, too stressful in playtest), ring speed 130 u/s: generous by design while timing readability is the open risk.
- Pond is a fixed 600x900 world scaled to fit, so every device sees the same pond (fair for a future daily pond).
- No plan mode yet: the prototype should test whether live timing reads by eye first.
- Stars count retries' throws too, so 3 stars means a perfect solve (Jonny wanted 3 stars harder).
- Retry lives beside the stones, not in the top bar: that is where the player looks when they run out.
- Near-miss note shows ring gap in seconds, neutral wording, so it teaches without blaming.
