# State

**Milestone:** working toward alpha (phase 1 of 4). Bloom goes to alpha in parallel in its own repo.

**Playable:** welcome card, 5 coached lessons (`?fresh` replays them), a map of 12 levels with three hidden versions each chosen by stars (GDD §3.6), then endless open water. Touch and mouse. Synth audio. Tuning panel.

**3D:** default renderer since 2026-10-21 (Jonny asked for a beautiful 3D experience); `?2d` keeps the flat version. Multisampled glow pass and pixel-aware shader lines keep edges clean; resolution steps down on its own if a phone drops below 40 fps.

**HUD:** full screen button (iPhone shows the Add to Home Screen tip), labelled Retry pill beside the stones that pulses once stones run out.

**Alpha:** Jonny (2026-10-22) is taking both Still Water and Bloom to alpha. Plan: Claude Doc "Still Water: road to alpha" https://claude.ai/artifact/Cc4xjJrwVcqCbszjsxtsTA, with four phases: Understand, Satisfy, Depth, Alpha ready.
Phase 1 progress: done = meeting band (aim to see where your ring meets moving rings, gold-window wide; `assist.meetPreview`), unlit lanterns pulse after the water settles. Next = "Watch" half-speed replay on the stilled card; lessons teach basics only (t1, t2), with t3/t4/t5 played as intro ponds at levels 1/4/7 and generator features gated by level; hint reveals one lily pad at a time, skip after 3 fails; par line at level start.

## Open owner questions
1. New ideas for alpha: mirror walls, moon lanterns (echo light only), drifting lanterns? (Asked 2026-10-22, unanswered.)
2. OK to collect anonymous play data in the alpha test? (Asked 2026-10-22, unanswered.)
3. Who are the 5 to 10 outside testers; private or public link? (Asked 2026-10-22, unanswered.)
4. Keep the gold match preview as a permanent assist, an option, or tutorial-only? Default: option, on.

## Decisions
- Three.js for the 3D view, sim untouched: the renderer interface let 2D and 3D share all game logic.
- Touch drops on release, mouse on press: lets touch players hold to aim without a second gesture.
- Gold window 0.7 s (was 0.5, too stressful in playtest), ring speed 130 u/s: generous by design while timing readability is the open risk.
- Pond is a fixed 600x900 world scaled to fit, so every device sees the same pond (fair for a future daily pond).
- No plan mode yet: the prototype should test whether live timing reads by eye first.
- Stars count retries' throws too, so 3 stars means a perfect solve (Jonny wanted 3 stars harder).
- Retry lives beside the stones, not in the top bar: that is where the player looks when they run out.
- Near-miss note shows ring gap in seconds, neutral wording, so it teaches without blaming.
