import { Audio, haptic } from './audio/audio';
import { afterComplete, afterSkip, difficultyFor, freshProgress, isLesson, levelOf, loadProgress, saveProgress, starsFor, tierAt, totalStars, type Progress } from './progress';
import type { PondRenderer } from './render/renderer';
import { computeGoldPreview } from './render/renderer';
import { INTROS, LEVEL_NAMES, pondAt, TUTORIAL } from './sim/levels';
import { mapHtml } from './ui/map';
import { Sim, type SimEvent } from './sim/sim';
import type { PondDef, StoneDrop, Vec } from './sim/types';
import { genParams, levelParams, simParams, tuning } from './tuning';
import { Coach, ICONS, POND_CARDS } from './ui/coach';
import { createDevPanel } from './ui/devpanel';
import { applySettings, loadSettings, saveSettings, settingsHtml, type Settings } from './ui/settings';

const $ = (id: string) => document.getElementById(id)!;

const isTouch = matchMedia('(pointer: coarse)').matches;


async function start() {
  // 3D is the default; ?2d keeps the original flat prototype for comparison and slow devices.
  const use2d = new URLSearchParams(location.search).has('2d');
  const view: PondRenderer = use2d ? await (await import('./render/view')).PondView.create() : new (await import('./render/view3d')).Pond3D();
  $('app').appendChild(view.canvas);
  const audio = new Audio();

  const fresh = freshProgress(levelParams());
  // ?fresh starts over from the welcome screen (handy for replaying the introduction).
  let progress: Progress = new URLSearchParams(location.search).has('fresh') ? fresh : loadProgress(fresh);
  let pond: PondDef;
  let sim: Sim;
  let fails = 0;
  // Every stone thrown on this level, retries included; stars are counted from this.
  let throws = 0;
  // Lily pads revealed on this level, one per request (GDD §5).
  let hintCount = 0;
  // First visit to a stop that introduces a new idea: its intro pond plays before the level.
  let playingIntro = false;
  // This attempt's stones, and the half-speed Watch replay of a settled attempt (GDD §4.1).
  let attempt: StoneDrop[] = [];
  let replay: { drops: StoneDrop[]; next: number; offset: number; over: boolean } | null = null;
  let acc = 0;
  let cascadeStep = 0;
  let lastLight = -10;
  const timers: number[] = [];

  const relayout = () => view.layout(window.innerWidth, window.innerHeight, $('top').offsetHeight + $('coach').offsetHeight - 8, $('bottom').offsetHeight);

  // ---------- coaching ----------
  let sayTimer = 0;
  const say = (text: string) => {
    const el = $('coach-text');
    if (el.textContent === text) return;
    el.classList.remove('show');
    clearTimeout(sayTimer);
    sayTimer = window.setTimeout(() => {
      el.textContent = text;
      if (text) el.classList.add('show');
    }, 220);
  };
  const coach = new Coach(
    {
      say,
      point: (targets) => {
        view.targets = targets;
      },
    },
    isTouch,
  );
  let welcomed = false;
  let cardShownFor = '';

  function load(regenerate = true) {
    timers.splice(0).forEach(clearTimeout);
    if (regenerate) {
      const level = levelOf(progress.index);
      const intro = isLesson(progress.index) ? undefined : INTROS[level];
      playingIntro = !!intro && !progress.introsDone.includes(level);
      pond = intro && playingIntro ? intro : pondAt(progress.index, difficultyFor(level, tierAt(progress, progress.index), levelParams()), simParams(), genParams());
    }
    startSim();
    attempt = [];
    hideOverlay();
    const tut = isLesson(progress.index);
    const n = levelOf(progress.index) + 1;
    $('title').innerHTML = tut ? `Lesson <b>${progress.index + 1}</b> · ${pond.title}` : `Level <b>${n}</b> · ${pond.title}`;
    $('mood').textContent = `★ ${totalStars(progress)}`;
    $('mood').style.display = tut ? 'none' : '';
    $('stones-caption').textContent = `stones · par ${pond.par}`;
    relayout();
    coach.start(pond, progress.index, TUTORIAL.length, throws === 0);
    if (progress.index === 0 && !welcomed) {
      welcomed = true;
      showWelcome();
    } else showPondCard();
  }

  /** The one-sentence card before a pond that brings something new, shown once. */
  function showPondCard() {
    const c = POND_CARDS[pond.id];
    if (!c || cardShownFor === pond.id) return;
    cardShownFor = pond.id;
    showOverlay(`<div class="icon-row">${c.icon}</div><h2>${c.title}</h2><p class="lead">${c.body}</p><div class="row"><button class="primary" data-act="ok">Got it</button></div>`, { ok: hideOverlay }, hideOverlay, 'center');
  }

  /** A fresh run of the current pond, with any revealed lily pads. */
  function startSim() {
    const shown = hintCount > 0 ? { ...pond, hints: pond.solution.slice(0, hintCount).map(({ x, y }) => ({ x, y })) } : pond;
    sim = new Sim(shown, simParams());
    view.build(sim);
    acc = 0;
    cascadeStep = 0;
    lastLight = -10;
    replay = null;
    view.ghost = false;
    renderStones();
  }

  /** Replays the settled attempt at half speed, aiming each stone just before it lands. */
  function watch() {
    timers.splice(0).forEach(clearTimeout);
    hideOverlay();
    const drops = attempt;
    startSim();
    // Skip the thinking time before the first stone, in whole steps so the replay stays exact.
    // Not with drifting lanterns: where they are depends on the pond's clock.
    const step = 1 / tuning.sim.stepHz;
    const drifting = pond.lanterns.some((l) => l.drift);
    const offset = drifting ? 0 : Math.max(0, Math.floor((drops[0].t - tuning.feel.replayAimLead) / step)) * step;
    replay = { drops, next: 0, offset, over: false };
    view.targets = [];
    say('Your last try, at half speed');
  }

  function feedReplay(r: NonNullable<typeof replay>) {
    while (r.next < r.drops.length && r.drops[r.next].t <= sim.time + r.offset + 1e-9) {
      const d = r.drops[r.next++];
      if (sim.dropStone(d)) audio.plop(panOf(d.x));
      renderStones();
    }
  }

  function endReplay() {
    if (!replay || replay.over) return;
    replay.over = true;
    view.ghost = false;
    say('');
    showSettled();
  }

  function showWelcome() {
    showOverlay(
      `<div class="icon-row">${ICONS.ring}${ICONS.plain}</div><h2>Still Water</h2>
       <p class="lead">Drop stones on the pond.<br>Ripples light the lanterns they touch.<br><b>Light every lantern.</b></p>
       <div class="row"><button class="primary" data-act="ok">Begin</button></div>`,
      { ok: hideOverlay },
      hideOverlay,
      'center',
    );
  }

  function showHowTo() {
    const aim = isTouch ? 'Hold a finger down to aim, lift it to drop.' : 'Point to aim, click to drop.';
    // Only what the player has met so far; the rest arrives along the map.
    const met = (level: number) => progress.introsDone.includes(level) || (playingIntro && levelOf(progress.index) === level);
    showOverlay(
      `<h2>How to play</h2>
       <p class="lead">Tap the water to drop a stone. Its ripple lights every lantern it touches. Light them all to clear the pond.</p>
       <div class="legend">
         ${ICONS.ring}<div>Ripple<small>Spreads out to the dashed circle you see while aiming, then fades.</small></div>
         ${ICONS.plain}<div>Lantern<small>Lights when any ripple touches it.</small></div>
         ${met(3) ? `${ICONS.echo}<div>Echo lantern<small>Lights, then sends out a smaller ripple of its own.</small></div>` : ''}
         ${met(0) ? `${ICONS.gold}<div>Gold lantern<small>Needs two ripples touching it within ${tuning.gold.window} s. The gold arc shows the time left.</small></div>` : ''}
         ${met(6) ? `${ICONS.rock}<div>Rock<small>Blocks ripples.</small></div>` : ''}
         ${met(9) ? `${ICONS.wall}<div>Mirror wall<small>Blocks ripples and bounces them back.</small></div>` : ''}
         ${met(12) ? `${ICONS.moon}<div>Moon lantern<small>Only a ripple bounced off a mirror wall can light it.</small></div>` : ''}
         ${met(16) ? `${ICONS.drift}<div>Drifting lantern<small>Glides along its dotted path. Rocks can hide it on the way.</small></div>` : ''}
       </div>
       <p>${aim} Use par or fewer stones for three stars.</p>
       <div class="row"><button class="primary" data-act="ok">Got it</button></div>`,
      { ok: hideOverlay },
      hideOverlay,
      'center wide',
    );
  }

  function renderStones() {
    const el = $('stones');
    const parts: string[] = [];
    for (let i = 0; i < pond.stones; i++) {
      if (i === pond.par) parts.push('<span class="par" title="par"></span>');
      parts.push(`<span class="stone${i < sim.stonesUsed ? ' used' : ''}"></span>`);
    }
    el.innerHTML = parts.join('');
    // Retry is always visible; dim before the first stone, and it calls out once you're out of stones.
    const retry = $('btn-restart');
    retry.classList.toggle('idle', sim.stonesUsed === 0);
    retry.classList.toggle('nudge', sim.stonesUsed >= pond.stones && sim.done !== 'complete');
  }

  function goTo(p: Progress) {
    progress = p;
    fails = 0;
    throws = 0;
    hintCount = 0;
    saveProgress(progress);
    load();
  }

  // ---------- overlay ----------
  const overlay = $('overlay');
  let overlayPrimary: (() => void) | null = null;
  function showOverlay(html: string, actions: Record<string, () => void>, primary: () => void, kind = '') {
    overlay.innerHTML = `<div class="card ${kind.includes('wide') ? 'wide' : ''} ${kind.includes('map') ? 'map' : ''}">${html}</div>`;
    overlay.className = kind.includes('center') ? 'show center' : 'show';
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
    overlay.className = '';
    overlay.innerHTML = '';
    overlayPrimary = null;
  }

  function showMap(intro: boolean) {
    const { html, playable } = mapHtml(progress, tuning.levels.count);
    const play = (index: number) => {
      // Going back to the pond you're in the middle of just closes the map.
      if (index === progress.index && sim.done === 'playing') {
        hideOverlay();
        showPondCard();
      } else goTo({ ...progress, index });
    };
    const actions: Record<string, () => void> = { continue: () => play(progress.reached) };
    for (const i of playable) actions[`go${i}`] = () => play(i);
    showOverlay(intro ? html.replace('<h2>The path</h2>', `<h2>The path ahead</h2><p class="lead">${tuning.levels.count} ponds, each a little deeper.</p>`) : html, actions, actions.continue, 'center map');
    // The map is taller than the card: start it scrolled to where the player is.
    const scroller = overlay.querySelector<HTMLElement>('.map-scroll');
    const here = overlay.querySelector<HTMLElement>('.stop.current');
    if (scroller && here) scroller.scrollTop = here.offsetTop + 20 - scroller.clientHeight / 2;
  }

  function onComplete(stonesUsed: number) {
    if (playingIntro) {
      // An intro pond has no stars: it teaches the idea, then the level itself begins.
      audio.complete(3);
      const level = levelOf(progress.index);
      const next = () => goTo({ ...progress, introsDone: [...progress.introsDone, level] });
      timers.push(
        window.setTimeout(() => {
          showOverlay(
            `<h2>Still.</h2><p>Now try it on ${LEVEL_NAMES[level] ?? 'open water'}.</p><div class="row"><button class="primary" data-act="next">Next</button></div>`,
            { next },
            next,
          );
        }, tuning.feel.completeDelayMs),
      );
      return;
    }
    const stars = starsFor(throws, pond.par);
    audio.complete(stars);
    const diff = throws - pond.par;
    const retried = throws > stonesUsed;
    const line =
      diff < 0 ? `${-diff} under par. Lovely.` : diff === 0 ? `Perfect, ${throws} stone${throws > 1 ? 's' : ''}.` : `${throws} throws${retried ? ' with your earlier tries' : ''}, par is ${pond.par}.`;
    const before = progress;
    const next = () => {
      const p = afterComplete(before, stars, levelParams());
      // Leaving the lessons: show the map once so the path ahead is clear.
      if (isLesson(before.index) && !isLesson(p.index)) {
        goTo(p);
        // The map covers the first intro's card; it shows when the player continues.
        cardShownFor = '';
        showMap(true);
      } else goTo(p);
    };
    timers.push(
      window.setTimeout(() => {
        showOverlay(
          `<h2>Still.</h2><div class="stars">${[0, 1, 2].map((i) => `<span class="${i < stars ? 'on' : ''}">★</span>`).join('')}</div>
           <p>${line}</p><div class="row">${isLesson(progress.index) ? '' : '<button data-act="map">Map</button>'}<button data-act="again">Again</button><button class="primary" data-act="next">${isLesson(progress.index) ? 'Next' : 'Next level'}</button></div>`,
          {
            again: () => {
              throws = 0;
              load(false);
            },
            next,
            map: () => {
              progress = afterComplete(before, stars, levelParams());
              saveProgress(progress);
              showMap(false);
            },
          },
          next,
        );
      }, tuning.feel.completeDelayMs),
    );
  }

  function onStilled() {
    fails++;
    audio.stilled();
    if (isLesson(progress.index) || playingIntro) {
      // Teaching ponds never show a failure screen; they reset with a hint line.
      coach.onRetry();
      if (pond.id === 't5') hintCount = pond.solution.length;
      timers.push(window.setTimeout(() => load(false), 1800));
      return;
    }
    timers.push(window.setTimeout(showSettled, 700));
  }

  /** The failure card: watch the try back, take one lily pad after 2 fails, skip after 3. */
  function showSettled() {
    const lit = sim.lanterns.filter((l) => l.lit).length;
    const canHint = fails >= 2 && hintCount < pond.solution.length;
    const retry = () => load(false);
    showOverlay(
      `<h2>The water settles</h2><p>${lit} of ${sim.lanterns.length} lanterns lit</p>
       <div class="row"><button data-act="watch">▶ Watch</button>${canHint ? `<button data-act="hint">${hintCount ? 'One more lily pad' : 'Show a lily pad'}</button>` : ''}${fails >= 3 ? '<button data-act="skip">Skip</button>' : ''}<button class="primary" data-act="retry">Try again</button></div>`,
      {
        retry,
        watch,
        hint: () => {
          hintCount++;
          load(false);
        },
        skip: () => goTo(afterSkip(progress)),
      },
      retry,
    );
  }

  // ---------- events ----------
  const panOf = (x: number) => (x / tuning.pond.width) * 1.6 - 0.8;
  function handle(events: SimEvent[]) {
    for (const e of events) {
      view.onEvent(e);
      if (replay) {
        // The replay only shows and sounds; it never scores, coaches or ends the level.
        if (e.type === 'light') audio[e.kind === 'gold' ? 'gold' : 'lantern'](0, panOf(sim.pond.lanterns[e.lantern].x));
        if ((e.type === 'stilled' || e.type === 'complete') && !replay.over) timers.push(window.setTimeout(endReplay, 1200));
        continue;
      }
      coach.onEvent(e);
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
    if (overlay.classList.contains('show') || replay) return;
    const t = sim.time;
    const r = sim.dropStone(p);
    if (r) {
      throws++;
      attempt.push({ x: p.x, y: p.y, t });
      audio.plop(panOf(p.x));
      haptic(8);
      renderStones();
      coach.onDrop(p);
    } else if (sim.done === 'playing') audio.tock();
  }

  const canvas = view.canvas;
  canvas.addEventListener('pointerdown', (e) => {
    audio.unlock();
    if (overlay.classList.contains('show')) return;
    // A tap during the replay skips to the end of it.
    if (replay) return endReplay();
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
  let settings: Settings = loadSettings();
  const setSettings = (s: Settings) => {
    settings = s;
    saveSettings(s);
    applySettings(s);
    audio.setMuted(!s.sound);
  };
  setSettings(settings);
  const toggleSound = () => {
    audio.unlock();
    setSettings({ ...settings, sound: !settings.sound });
  };
  function showSettings() {
    const flip = (key: keyof Settings) => () => {
      setSettings({ ...settings, [key]: !settings[key] });
      showSettings();
    };
    showOverlay(
      settingsHtml(settings),
      {
        sound: flip('sound'),
        vibration: flip('vibration'),
        timingHelp: flip('timingHelp'),
        done: hideOverlay,
        tune: () => {
          hideOverlay();
          devState.index = progress.index;
          devState.tier = progress.tier;
          panel.toggle();
        },
      },
      hideOverlay,
      'center',
    );
  }
  $('btn-restart').addEventListener('click', () => {
    audio.unlock();
    load(false);
  });
  $('btn-settings').addEventListener('click', () => {
    audio.unlock();
    showSettings();
  });

  // Full screen: the standard API, the older WebKit one, or (iPhone Safari) a tip to add it to the home screen.
  type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
  type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };
  const fsDoc = document as FsDoc;
  const fsRoot = document.documentElement as FsEl;
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  if (standalone) $('btn-full').style.display = 'none';
  const toggleFull = () => {
    audio.unlock();
    if (fsDoc.fullscreenElement || fsDoc.webkitFullscreenElement) {
      (fsDoc.exitFullscreen ?? fsDoc.webkitExitFullscreen)?.call(fsDoc);
    } else if (fsRoot.requestFullscreen) {
      fsRoot.requestFullscreen().catch(() => {});
    } else if (fsRoot.webkitRequestFullscreen) {
      fsRoot.webkitRequestFullscreen();
    } else {
      showOverlay(
        `<h2>Full screen</h2><p class="lead">On iPhone, tap <b>Share</b> then <b>Add to Home Screen</b>.<br>Still Water then opens full screen from its icon.</p><div class="row"><button class="primary" data-act="ok">Got it</button></div>`,
        { ok: hideOverlay },
        hideOverlay,
        'center',
      );
    }
  };
  $('btn-full').addEventListener('click', toggleFull);
  const openMap = () => {
    audio.unlock();
    if (!isLesson(progress.reached)) showMap(false);
  };
  $('btn-map').addEventListener('click', openMap);
  $('title').addEventListener('click', openMap);
  $('btn-help').addEventListener('click', () => {
    audio.unlock();
    showHowTo();
  });

  const devState = { index: progress.index, tier: progress.tier };
  let rebuildTimer = 0;
  const panel = createDevPanel({
    state: devState,
    onChange: (section) => {
      audio.applyVolumes();
      if (section === 'feel' || section === 'assist') return;
      clearTimeout(rebuildTimer);
      rebuildTimer = window.setTimeout(() => load(true), 250);
    },
    // Jumping to a level replays its intro pond, so new ideas can be checked again.
    onJump: () =>
      goTo({
        ...progress,
        index: devState.index,
        reached: Math.max(progress.reached, devState.index),
        tier: devState.tier,
        introsDone: progress.introsDone.filter((l) => l !== levelOf(devState.index)),
      }),
    onShowSolution: () => {
      hintCount = pond.solution.length;
      load(false);
    },
  });
  if (new URLSearchParams(location.search).has('dev')) panel.toggle();

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'r' || e.key === 'R') load(false);
    else if (e.key === 'm' || e.key === 'M') toggleSound();
    else if (e.key === 'f' || e.key === 'F') toggleFull();
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
  let last = performance.now();
  const frame = (t: number) => {
    const dt = Math.min((t - last) / 1000, 0.1);
    last = t;
    const step = 1 / tuning.sim.stepHz;
    acc += dt * (replay ? tuning.feel.replaySpeed : 1);
    while (acc >= step) {
      if (replay && !replay.over) feedReplay(replay);
      handle(sim.step(step));
      acc -= step;
    }
    if (replay) {
      // The replay aims for you: the reach circle appears where the next stone is about to land.
      const d = replay.over ? undefined : replay.drops[replay.next];
      view.ghost = true;
      view.previewAt = d && d.t - (sim.time + replay.offset) <= tuning.feel.replayAimLead ? d : null;
      view.goldPreview = [];
    } else {
      const pp = previewPoint();
      view.previewAt = pp;
      view.goldPreview = pp ? computeGoldPreview(sim, pp) : [];
    }
    view.render(sim.time + acc, dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void start();
