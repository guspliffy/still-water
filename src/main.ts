import { Application } from 'pixi.js';
import { Audio, haptic } from './audio/audio';
import { afterComplete, afterSkip, loadProgress, moodLabel, saveProgress, starsFor, type AdaptParams, type Progress } from './progress';
import { PondView } from './render/view';
import { pondAt, TUTORIAL } from './sim/levels';
import { Sim, type SimEvent } from './sim/sim';
import type { PondDef, Vec } from './sim/types';
import { genParams, simParams, tuning } from './tuning';
import { createDevPanel } from './ui/devpanel';

const $ = (id: string) => document.getElementById(id)!;

const adapt = (): AdaptParams => ({
  startDifficulty: tuning.generator.startDifficulty,
  maxDifficulty: tuning.generator.maxDifficulty,
  stepUpOnPar: tuning.generator.stepUpOnPar,
  stepDownOnFail: tuning.generator.stepDownOnFail,
});

const isTouch = matchMedia('(pointer: coarse)').matches;

const HELP: Record<string, string> = {
  t1: 'Tap the water',
  t2: isTouch ? 'Hold a finger down to see a stone’s reach' : 'Hover to see a stone’s reach',
  t3: 'Gold lights only where two rings meet',
  t4: 'Echo lanterns ring out on their own',
  t5: 'Rocks cast shadows on the water',
};

async function start() {
  const app = new Application();
  await app.init({
    background: 0x02040a,
    resizeTo: window,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });
  $('app').appendChild(app.canvas);

  const view = new PondView(app);
  const audio = new Audio();

  let progress: Progress = loadProgress({ index: 0, difficulty: tuning.generator.startDifficulty });
  let pond: PondDef;
  let sim: Sim;
  let fails = 0;
  let showSolution = false;
  let acc = 0;
  let cascadeStep = 0;
  let lastLight = -10;
  const timers: number[] = [];

  const relayout = () => view.layout(window.innerWidth, window.innerHeight, $('top').offsetHeight, $('bottom').offsetHeight);

  function load(regenerate = true) {
    timers.splice(0).forEach(clearTimeout);
    if (regenerate) pond = pondAt(progress.index, progress.difficulty, simParams(), genParams());
    const shown = showSolution ? { ...pond, hints: pond.solution.map(({ x, y }) => ({ x, y })) } : pond;
    sim = new Sim(shown, simParams());
    view.build(sim);
    acc = 0;
    cascadeStep = 0;
    lastLight = -10;
    hideOverlay();
    const tut = progress.index < TUTORIAL.length;
    $('title').innerHTML = `Pond <b>${progress.index + 1}</b>${tut ? ` · ${pond.title}` : ''}`;
    $('mood').textContent = moodLabel(progress.index, progress.difficulty);
    const help = HELP[pond.id];
    $('help').textContent = help ?? '';
    $('help').classList.toggle('show', !!help);
    renderStones();
    relayout();
  }

  function renderStones() {
    const el = $('stones');
    const parts: string[] = [];
    for (let i = 0; i < pond.stones; i++) {
      if (i === pond.par) parts.push('<span class="par" title="par"></span>');
      parts.push(`<span class="stone${i < sim.stonesUsed ? ' used' : ''}"></span>`);
    }
    el.innerHTML = parts.join('');
  }

  function goTo(p: Progress) {
    progress = p;
    fails = 0;
    showSolution = false;
    saveProgress(progress);
    load();
  }

  // ---------- overlay ----------
  const overlay = $('overlay');
  let overlayPrimary: (() => void) | null = null;
  function showOverlay(html: string, actions: Record<string, () => void>, primary: () => void) {
    overlay.innerHTML = `<div class="card">${html}</div>`;
    overlay.classList.add('show');
    overlayPrimary = primary;
    overlay.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        audio.unlock();
        actions[b.dataset.act!]();
      });
    });
  }
  function hideOverlay() {
    overlay.classList.remove('show');
    overlay.innerHTML = '';
    overlayPrimary = null;
  }

  function onComplete(stonesUsed: number) {
    const stars = starsFor(stonesUsed, pond.par);
    audio.complete(stars);
    const diff = stonesUsed - pond.par;
    const line = diff < 0 ? `${-diff} under par. Lovely.` : diff === 0 ? `Lit at par, ${stonesUsed} stone${stonesUsed > 1 ? 's' : ''}.` : `${stonesUsed} stones, par is ${pond.par}.`;
    const next = () => goTo(afterComplete(progress, stonesUsed, pond.par, fails, adapt()));
    timers.push(
      window.setTimeout(() => {
        showOverlay(
          `<h2>Still.</h2><div class="stars">${[0, 1, 2].map((i) => `<span class="${i < stars ? 'on' : ''}">★</span>`).join('')}</div>
           <p>${line}</p><div class="row"><button data-act="again">Again</button><button class="primary" data-act="next">Next pond</button></div>`,
          { again: () => load(false), next },
          next,
        );
      }, tuning.feel.completeDelayMs),
    );
  }

  function onStilled() {
    fails++;
    audio.stilled();
    const lit = sim.lanterns.filter((l) => l.lit).length;
    const canHint = !showSolution && progress.index >= 1;
    const retry = () => load(false);
    timers.push(
      window.setTimeout(() => {
        showOverlay(
          `<h2>The water settles</h2><p>${lit} of ${sim.lanterns.length} lanterns lit</p>
           <div class="row">${canHint && fails >= 1 ? '<button data-act="hint">Show lily pads</button>' : ''}${fails >= 2 ? '<button data-act="skip">Skip</button>' : ''}<button class="primary" data-act="retry">Try again</button></div>`,
          {
            retry,
            hint: () => {
              showSolution = true;
              load(false);
            },
            skip: () => goTo(afterSkip(progress, adapt())),
          },
          retry,
        );
      }, 700),
    );
  }

  // ---------- events ----------
  const panOf = (x: number) => (x / tuning.pond.width) * 1.6 - 0.8;
  function handle(events: SimEvent[]) {
    for (const e of events) {
      view.onEvent(e);
      switch (e.type) {
        case 'light': {
          // Lanterns lit close together climb the scale, so a cascade plays a rising phrase.
          cascadeStep = e.t - lastLight < tuning.feel.cascadeNoteWindow ? cascadeStep + 1 : 0;
          lastLight = e.t;
          const x = sim.pond.lanterns[e.lantern].x;
          if (e.kind === 'gold') {
            audio.gold(cascadeStep, panOf(x));
            haptic(25);
          } else audio.lantern(cascadeStep, panOf(x));
          break;
        }
        case 'echo': {
          const x = sim.pond.lanterns[e.lantern].x;
          timers.push(window.setTimeout(() => audio.echoPlop(panOf(x)), tuning.ripple.echoDelay * 1000));
          break;
        }
        case 'goldTouch':
          audio.goldTouch(panOf(sim.pond.lanterns[e.lantern].x));
          break;
        case 'goldMiss':
          audio.goldMiss(panOf(sim.pond.lanterns[e.lantern].x));
          break;
        case 'complete':
          $('help').classList.remove('show');
          onComplete(e.stonesUsed);
          break;
        case 'stilled':
          onStilled();
          break;
        default:
          break;
      }
    }
  }

  // ---------- input ----------
  // Mouse drops on press and previews on hover. Touch holds the stone while the finger is down
  // (showing its reach) and lets go on release, so aiming is possible without a second gesture.
  const held = new Map<number, { p: Vec; downAt: number }>();
  let hover: Vec | null = null;

  function drop(p: Vec) {
    if (overlay.classList.contains('show')) return;
    const r = sim.dropStone(p);
    if (r) {
      audio.plop(panOf(p.x));
      haptic(8);
      renderStones();
      if (pond.id === 't1') $('help').classList.remove('show');
    } else if (sim.done === 'playing') audio.tock();
  }

  const canvas = app.canvas;
  canvas.addEventListener('pointerdown', (e) => {
    audio.unlock();
    if (overlay.classList.contains('show')) return;
    const p = view.toWorld(e.clientX, e.clientY);
    if (e.pointerType === 'mouse') {
      if (e.button === 0) drop(p);
      hover = p;
    } else {
      held.set(e.pointerId, { p, downAt: performance.now() });
      canvas.setPointerCapture(e.pointerId);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = view.toWorld(e.clientX, e.clientY);
    if (e.pointerType === 'mouse') hover = p;
    else {
      const h = held.get(e.pointerId);
      if (h) h.p = p;
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    const h = held.get(e.pointerId);
    if (h) {
      held.delete(e.pointerId);
      drop(h.p);
    }
  });
  canvas.addEventListener('pointercancel', (e) => held.delete(e.pointerId));
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') hover = null;
  });
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay && overlayPrimary) overlayPrimary();
  });

  function previewPoint(): Vec | null {
    let best: { p: Vec; downAt: number } | null = null;
    for (const h of held.values()) if (!best || h.downAt > best.downAt) best = h;
    if (best) return performance.now() - best.downAt >= tuning.assist.touchHoldPreviewMs ? best.p : null;
    return hover;
  }

  // ---------- buttons and keys ----------
  const toggleSound = () => {
    audio.unlock();
    audio.setMuted(!audio.muted);
    $('btn-sound').style.opacity = audio.muted ? '0.4' : '1';
  };
  $('btn-restart').addEventListener('click', () => {
    audio.unlock();
    load(false);
  });
  $('btn-sound').addEventListener('click', toggleSound);

  const devState = { index: progress.index, difficulty: progress.difficulty };
  let rebuildTimer = 0;
  const panel = createDevPanel({
    state: devState,
    onChange: (section) => {
      audio.applyVolumes();
      if (section === 'feel' || section === 'assist') return;
      clearTimeout(rebuildTimer);
      rebuildTimer = window.setTimeout(() => load(true), 250);
    },
    onJump: () => goTo({ index: devState.index, difficulty: devState.difficulty }),
    onShowSolution: () => {
      showSolution = true;
      load(false);
    },
  });
  $('btn-tune').addEventListener('click', () => {
    devState.index = progress.index;
    devState.difficulty = progress.difficulty;
    panel.toggle();
  });
  if (new URLSearchParams(location.search).has('dev')) panel.toggle();

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'r' || e.key === 'R') load(false);
    else if (e.key === 'm' || e.key === 'M') toggleSound();
    else if (e.key === 't' || e.key === 'T') panel.toggle();
    else if ((e.key === 'Enter' || e.key === ' ') && overlayPrimary) {
      e.preventDefault();
      overlayPrimary();
    }
  });
  window.addEventListener('resize', relayout);

  // Handle for automated play-testing and debugging in the console.
  (window as unknown as { stillWater: object }).stillWater = { get sim() { return sim; }, drop, load };

  // ---------- loop ----------
  load();
  app.ticker.add((ticker) => {
    const dt = Math.min(ticker.deltaMS / 1000, 0.1);
    const step = 1 / tuning.sim.stepHz;
    acc += dt;
    while (acc >= step) {
      handle(sim.step(step));
      acc -= step;
    }
    const pp = previewPoint();
    view.previewAt = pp;
    view.goldPreview = pp ? view.computeGoldPreview(pp) : [];
    view.render(sim.time + acc, dt);
  });
}

void start();
