import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { dist, isOccluded, rng, rockShadow } from '../sim/geometry';
import type { Sim, SimEvent } from '../sim/sim';
import type { LanternKind, PondDef, Vec } from '../sim/types';
import { tuning } from '../tuning';
import type { GoldPreview, PondRenderer } from './renderer';
import { visibleArcs } from './arcs';

const COLORS = {
  screen: 0x02040a,
  edge: 0x1d2d4a,
  stoneRing: 0xffe2b0,
  echoRing: 0x5fd4ff,
  warm: 0xffcf87,
  echoLit: 0x7fe0ff,
  echoDim: 0x4aa3c4,
  gold: 0xffc23d,
  unlitFill: 0x0f1828,
  unlitStroke: 0x3a4a66,
  goldDim: 0x8a6a2a,
  rock: 0x161d2b,
  rockEdge: 0x2b3548,
  lily: 0x14382a,
  koi: 0x10223a,
};

const LANTERN_R = 16;

function radialTexture(size: number, stops: [number, string][]): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(c);
}

interface LanternView {
  root: Container;
  glow: Sprite;
  reflection: Sprite;
  body: Graphics;
  fx: Graphics;
  kind: LanternKind;
  lit: boolean;
  litAt: number;
  touchedAt: number;
  missAt: number;
  phase: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  color: number;
  size: number;
}

interface Floater {
  text: Text;
  born: number;
  y: number;
}

/** Everything drawn. Reads the sim; never changes it. */
export class PondView implements PondRenderer {
  readonly app: Application;
  readonly world = new Container();
  private glowTex = radialTexture(128, [
    [0, 'rgba(255,255,255,1)'],
    [0.25, 'rgba(255,255,255,0.45)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  private waterTex = radialTexture(256, [
    [0, '#10223f'],
    [0.6, '#0a162c'],
    [1, '#060d1c'],
  ]);
  private water = new Sprite(this.waterTex);
  private mask = new Graphics();
  private edge = new Graphics();
  private motes: { s: Sprite; x: number; y: number; vx: number; vy: number; tw: number }[] = [];
  private moteLayer = new Container();
  private koi: Graphics[] = [];
  private staticLayer = new Container();
  private ripples = new Graphics();
  private lanternLayer = new Container();
  private preview = new Graphics();
  private particles = new Graphics();
  private floaterLayer = new Container();
  private lanterns: LanternView[] = [];
  private parts: Particle[] = [];
  private floaters: Floater[] = [];
  private sim!: Sim;
  private scale = 1;
  previewAt: Vec | null = null;
  goldPreview: GoldPreview[] = [];
  ghost = false;
  /** Teaching markers: pulsing "tap here" rings. */
  targets: Vec[] = [];
  /** Real-time clock (seconds) for idle motion that should keep going between ponds. */
  private clock = 0;

  /** Creates the Pixi application and a 2D view on it. */
  static async create(): Promise<PondView> {
    const app = new Application();
    await app.init({
      background: COLORS.screen,
      resizeTo: window,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    return new PondView(app);
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  constructor(app: Application) {
    this.app = app;
    app.stage.addChild(this.world);
    const pondLayer = new Container();
    pondLayer.addChild(this.water, this.moteLayer);
    this.world.addChild(this.mask, pondLayer, this.edge, this.staticLayer, this.ripples, this.lanternLayer, this.preview, this.particles, this.floaterLayer);
    pondLayer.mask = this.mask;
    this.ripples.mask = this.mask;
    this.ripples.blendMode = 'add';
    this.particles.blendMode = 'add';

    const rand = rng(7);
    for (let i = 0; i < 46; i++) {
      const s = new Sprite(this.glowTex);
      s.anchor.set(0.5);
      s.blendMode = 'add';
      s.tint = 0x9fc4ff;
      const sz = 3 + rand() * 6;
      s.width = s.height = sz;
      this.moteLayer.addChild(s);
      this.motes.push({ s, x: rand(), y: rand(), vx: (rand() - 0.5) * 0.006, vy: -0.002 - rand() * 0.006, tw: rand() * 10 });
    }
    for (let i = 0; i < 2; i++) {
      const k = new Graphics();
      k.ellipse(0, 0, 26, 9).fill({ color: COLORS.koi });
      k.moveTo(-22, 0).lineTo(-44, -11).lineTo(-40, 0).lineTo(-44, 11).closePath().fill({ color: COLORS.koi });
      k.ellipse(6, -9, 8, 3).fill({ color: COLORS.koi });
      k.ellipse(6, 9, 8, 3).fill({ color: COLORS.koi });
      this.koi.push(k);
      this.moteLayer.addChildAt(k, 0);
    }
  }

  /** Rebuild everything that belongs to one pond. */
  build(sim: Sim): void {
    this.sim = sim;
    const { width: W, height: H, cornerRadius: CR } = sim.p;
    const pond: PondDef = sim.pond;
    this.water.width = W;
    this.water.height = H;
    this.mask.clear().roundRect(0, 0, W, H, CR).fill({ color: 0xffffff });
    this.edge.clear();
    this.edge.roundRect(-3, -3, W + 6, H + 6, CR + 3).stroke({ width: 10, color: COLORS.edge, alpha: 0.18 });
    this.edge.roundRect(0, 0, W, H, CR).stroke({ width: 1.5, color: COLORS.edge, alpha: 0.9 });

    this.staticLayer.removeChildren().forEach((c) => c.destroy());
    this.lanternLayer.removeChildren().forEach((c) => c.destroy());
    this.floaterLayer.removeChildren().forEach((c) => c.destroy());
    this.parts = [];
    this.floaters = [];

    for (const h of pond.hints) this.staticLayer.addChild(this.lilyPad(h));
    pond.rocks.forEach((r, i) => this.staticLayer.addChild(this.rock(r.x, r.y, r.r, i)));

    this.lanterns = pond.lanterns.map((def, i) => {
      const root = new Container();
      root.position.set(def.x, def.y);
      const reflection = new Sprite(this.glowTex);
      reflection.anchor.set(0.5, 0.15);
      reflection.blendMode = 'add';
      reflection.width = 26;
      reflection.height = 90;
      reflection.alpha = 0;
      const glow = new Sprite(this.glowTex);
      glow.anchor.set(0.5);
      glow.blendMode = 'add';
      glow.width = glow.height = 120;
      glow.alpha = 0;
      const fx = new Graphics();
      const body = new Graphics();
      root.addChild(reflection, glow, fx, body);
      this.lanternLayer.addChild(root);
      const v: LanternView = { root, glow, reflection, body, fx, kind: def.kind, lit: false, litAt: -1, touchedAt: -1, missAt: -1, phase: i * 1.7 };
      this.drawBody(v);
      return v;
    });
  }

  layout(screenW: number, screenH: number, top: number, bottom: number): void {
    const { width: W, height: H } = tuning.pond;
    const pad = 14;
    const availH = screenH - top - bottom - pad * 2;
    const availW = screenW - pad * 2;
    this.scale = Math.min(availW / W, availH / H);
    this.world.scale.set(this.scale);
    this.world.position.set((screenW - W * this.scale) / 2, top + pad + (availH - H * this.scale) / 2);
  }

  toWorld(clientX: number, clientY: number): Vec {
    return { x: (clientX - this.world.x) / this.scale, y: (clientY - this.world.y) / this.scale };
  }

  toScreen(p: Vec): Vec {
    return { x: this.world.x + p.x * this.scale, y: this.world.y + p.y * this.scale };
  }

  onEvent(e: SimEvent): void {
    switch (e.type) {
      case 'drop':
        this.splash(e.x, e.y, COLORS.stoneRing, 12);
        break;
      case 'light': {
        const v = this.lanterns[e.lantern];
        v.lit = true;
        v.litAt = e.t;
        this.drawBody(v);
        const def = this.sim.pond.lanterns[e.lantern];
        this.splash(def.x, def.y, e.kind === 'gold' ? COLORS.gold : COLORS.warm, e.kind === 'gold' ? 22 : 10);
        break;
      }
      case 'goldTouch':
        this.lanterns[e.lantern].touchedAt = e.t;
        break;
      case 'goldMiss':
        this.lanterns[e.lantern].missAt = e.t;
        break;
      case 'goldNearMiss': {
        const def = this.sim.pond.lanterns[e.lantern];
        this.float(def, `${(e.lateBy + this.sim.p.goldWindow).toFixed(2)}s apart`);
        break;
      }
      default:
        break;
    }
  }

  /** Short calm word above a lantern or point. */
  float(p: Vec, msg: string): void {
    const text = new Text({ text: msg, style: { fill: 0xe8dcc0, fontSize: 20, fontFamily: 'system-ui, sans-serif', fontWeight: '500' } });
    text.anchor.set(0.5);
    text.position.set(p.x, p.y - 34);
    this.floaterLayer.addChild(text);
    this.floaters.push({ text, born: this.clock, y: p.y - 34 });
  }

  render(now: number, realDt: number): void {
    this.clock += realDt;
    this.drawWater(realDt);
    this.drawRipples(now);
    this.drawLanterns(now);
    this.drawPreview(now);
    this.drawTargets();
    this.drawParticles();
    this.drawFloaters();
  }

  private drawWater(dt: number): void {
    const { width: W, height: H } = tuning.pond;
    const t = this.clock;
    for (const m of this.motes) {
      m.x = (m.x + m.vx * dt + 1) % 1;
      m.y = (m.y + m.vy * dt + 1) % 1;
      m.s.position.set(m.x * W, m.y * H);
      m.s.alpha = 0.12 + 0.1 * Math.sin(t * 0.8 + m.tw);
    }
    this.koi.forEach((k, i) => {
      const s = t * (0.05 + i * 0.017) + i * 2.4;
      const x = W / 2 + Math.sin(s) * W * 0.36;
      const y = H / 2 + Math.sin(s * 1.7 + i) * H * 0.38;
      const dx = Math.cos(s) * W * 0.36;
      const dy = Math.cos(s * 1.7 + i) * 1.7 * H * 0.38;
      k.position.set(x, y);
      k.rotation = Math.atan2(dy, dx) + Math.sin(t * 3 + i) * 0.06;
      k.alpha = 0.55;
    });
  }

  private drawRipples(now: number): void {
    const g = this.ripples;
    g.clear();
    const sim = this.sim;
    const { lineWidth, glowWidth, fadePower } = tuning.ripple;
    for (const r of sim.ripples) {
      const rad = sim.radiusAt(r, now);
      if (rad <= 0 || rad > r.maxR) continue;
      const k = rad / r.maxR;
      const a = (1 - k ** fadePower) * (r.source === 'echo' ? 0.75 : 1);
      const color = r.source === 'echo' ? COLORS.echoRing : COLORS.stoneRing;
      const gaps: [number, number][] = [];
      for (const rock of sim.pond.rocks) {
        const sh = rockShadow(r, rock);
        if (sh && rad > sh.fromR) gaps.push([sh.a0, sh.a1]);
      }
      const arcs = gaps.length ? visibleArcs(gaps) : null;
      const ring = (radius: number, width: number, alpha: number) => {
        if (radius <= 0) return;
        if (!arcs) {
          g.circle(r.x, r.y, radius).stroke({ width, color, alpha });
          return;
        }
        for (const [s, e] of arcs) {
          g.moveTo(r.x + Math.cos(s) * radius, r.y + Math.sin(s) * radius);
          g.arc(r.x, r.y, radius, s, e).stroke({ width, color, alpha, cap: 'round' });
        }
      };
      ring(rad, glowWidth, a * 0.1);
      ring(rad, glowWidth * 0.45, a * 0.22);
      ring(rad, lineWidth, a * 0.95);
      // Two faint trailing wakes give the ring direction and make its speed easy to read.
      ring(rad - 16, lineWidth * 0.6, a * 0.22);
      ring(rad - 34, lineWidth * 0.5, a * 0.09);
    }
  }

  private drawLanterns(now: number): void {
    const sim = this.sim;
    const win = sim.p.goldWindow;
    const lightDur = tuning.feel.lanternLightMs / 1000;
    const flareDur = tuning.feel.goldFlareMs / 1000;
    this.lanterns.forEach((v, i) => {
      const st = sim.lanterns[i];
      v.fx.clear();
      const flicker = 0.92 + 0.08 * Math.sin(this.clock * 2.3 + v.phase) * Math.sin(this.clock * 3.7 + v.phase * 2);
      if (v.lit) {
        const age = Math.max(0, now - v.litAt);
        const p = Math.min(1, age / lightDur);
        // Elastic pop: overshoot then settle.
        const pop = 1 + Math.sin(p * Math.PI) * (1 - p) * 0.9;
        v.body.scale.set(pop);
        const isGold = v.kind === 'gold';
        const base = isGold ? 1 : 0.8;
        v.glow.alpha = base * flicker * Math.min(1, age / 0.12);
        v.glow.tint = isGold ? COLORS.gold : v.kind === 'echo' ? COLORS.echoLit : COLORS.warm;
        v.glow.width = v.glow.height = (isGold ? 150 : 110) * (1 + 0.6 * (1 - p));
        v.reflection.alpha = 0.22 * flicker * Math.min(1, age / 0.3);
        v.reflection.tint = v.glow.tint;
        if (isGold && age < flareDur) {
          const f = age / flareDur;
          v.fx.circle(0, 0, 20 + f * 90).stroke({ width: 3 * (1 - f) + 0.5, color: COLORS.gold, alpha: 1 - f });
          v.fx.circle(0, 0, 10 + f * 50).stroke({ width: 2, color: 0xffffff, alpha: (1 - f) * 0.6 });
        }
        return;
      }
      v.body.scale.set(1);
      v.glow.alpha = 0;
      v.reflection.alpha = 0.04;
      if (v.kind === 'echo') {
        // Sonar ping: a small ring leaves the lantern every 2.4 s, hinting that it sends ripples.
        const f = ((this.clock + v.phase) / 2.4) % 1;
        if (f < 0.7) {
          const k = f / 0.7;
          v.fx.circle(0, 0, 20 + k * 26).stroke({ width: 1.5, color: COLORS.echoRing, alpha: (1 - k) * 0.5 });
        }
      }
      if (v.kind === 'gold') {
        // Breathing rim so gold reads as special before anything happens.
        const breathe = 0.5 + 0.5 * Math.sin(this.clock * 1.6 + v.phase);
        v.fx.circle(0, 0, 25).stroke({ width: 1, color: COLORS.gold, alpha: 0.12 + 0.1 * breathe });
        if (st.windowOpenedAt >= 0) {
          const left = 1 - (now - st.windowOpenedAt) / win;
          if (left > 0) {
            // Window open: half glow plus an arc that drains as time runs out.
            v.glow.tint = COLORS.gold;
            v.glow.alpha = 0.45 * left + 0.1;
            v.glow.width = v.glow.height = 90;
            const a0 = -Math.PI / 2;
            v.fx.moveTo(0, -27);
            v.fx.arc(0, 0, 27, a0, a0 + Math.PI * 2 * left).stroke({ width: 4, color: COLORS.gold, alpha: 0.95, cap: 'round' });
          }
        }
        if (v.missAt >= 0 && now - v.missAt < 0.6) {
          const f = (now - v.missAt) / 0.6;
          v.fx.circle(0, 0, 27 + f * 8).stroke({ width: 2, color: COLORS.goldDim, alpha: 1 - f });
        }
      }
    });
  }

  private drawPreview(now: number): void {
    const g = this.preview;
    g.clear();
    const p = this.previewAt;
    if (!p || !tuning.assist.reachPreview || this.sim.done !== 'playing') return;
    const ok = this.sim.canDropAt(p) && this.sim.stonesLeft > 0;
    const R = this.sim.p.maxRadius;
    // Dashed reach circle: where this stone's ring will fade out.
    const segs = 48;
    for (let i = 0; i < segs; i += 2) {
      const a0 = (i / segs) * Math.PI * 2 + this.clock * 0.05;
      const a1 = ((i + 1) / segs) * Math.PI * 2 + this.clock * 0.05;
      g.moveTo(p.x + Math.cos(a0) * R, p.y + Math.sin(a0) * R);
      g.arc(p.x, p.y, R, a0, a1).stroke({ width: 1.5, color: 0xcfd8ea, alpha: ok ? 0.22 : 0.08 });
    }
    g.circle(p.x, p.y, 7).stroke({ width: 2, color: 0xffffff, alpha: ok ? 0.6 : 0.2 });
    if (!ok) return;
    this.sim.lanterns.forEach((l) => {
      if (l.lit || l.def.kind === 'gold') return;
      if (dist(p, l.def) <= R && !isOccluded(p, l.def, this.sim.pond.rocks)) {
        g.circle(l.def.x, l.def.y, LANTERN_R + 7).stroke({ width: 1.5, color: COLORS.warm, alpha: 0.45 });
      }
    });
    for (const gp of this.goldPreview) {
      const l = this.sim.pond.lanterns[gp.lantern];
      if (gp.match && tuning.assist.goldMatchPreview) {
        const pulse = 0.6 + 0.4 * Math.sin(now * 12);
        g.circle(l.x, l.y, 32).stroke({ width: 3, color: COLORS.gold, alpha: 0.9 * pulse });
        g.circle(l.x, l.y, 40).stroke({ width: 1.5, color: COLORS.gold, alpha: 0.4 * pulse });
      } else {
        g.circle(l.x, l.y, 30).stroke({ width: 1.5, color: COLORS.gold, alpha: 0.3 });
      }
    }
  }

  private drawTargets(): void {
    const g = this.preview;
    for (const t of this.targets) {
      // Two rings converge on the spot every 1.4 s, like a gentle "here".
      for (let k = 0; k < 2; k++) {
        const f = ((this.clock / 1.4 + k * 0.5) % 1);
        g.circle(t.x, t.y, 46 - f * 34).stroke({ width: 2.5, color: 0xffffff, alpha: Math.sin(f * Math.PI) * 0.7 });
      }
      g.circle(t.x, t.y, 6).fill({ color: 0xffffff, alpha: 0.55 + 0.3 * Math.sin(this.clock * 4.5) });
    }
  }

  private drawParticles(): void {
    const g = this.particles;
    g.clear();
    const t = this.clock;
    this.parts = this.parts.filter((p) => t - p.born < p.life);
    for (const p of this.parts) {
      const age = t - p.born;
      const k = age / p.life;
      const x = p.x + p.vx * age;
      const y = p.y + p.vy * age + 60 * age * age;
      g.circle(x, y, p.size * (1 - k * 0.5)).fill({ color: p.color, alpha: (1 - k) * 0.8 });
    }
  }

  private drawFloaters(): void {
    const t = this.clock;
    this.floaters = this.floaters.filter((f) => {
      const age = t - f.born;
      if (age > 1.8) {
        f.text.destroy();
        return false;
      }
      f.text.alpha = Math.min(1, age * 4) * (1 - Math.max(0, age - 1.1) / 0.7);
      f.text.y = f.y - age * 14;
      return true;
    });
  }

  private splash(x: number, y: number, color: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 40 + Math.random() * 90;
      this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, born: this.clock, life: 0.4 + Math.random() * 0.4, color, size: 1.5 + Math.random() * 2 });
    }
  }

  private drawBody(v: LanternView): void {
    const g = v.body;
    g.clear();
    const r = LANTERN_R;
    if (v.kind === 'gold') {
      const d = r + 4;
      const diamond = [0, -d, d, 0, 0, d, -d, 0];
      if (v.lit) {
        g.poly(diamond).fill({ color: COLORS.gold });
        g.poly([0, -d * 0.45, d * 0.45, 0, 0, d * 0.45, -d * 0.45, 0]).fill({ color: 0xfff4d0 });
      } else {
        g.poly(diamond).fill({ color: COLORS.unlitFill }).stroke({ width: 2, color: COLORS.goldDim });
        g.poly([0, -d * 0.4, d * 0.4, 0, 0, d * 0.4, -d * 0.4, 0]).fill({ color: COLORS.gold, alpha: 0.18 });
      }
      return;
    }
    if (v.kind === 'echo') {
      // Hexagon in cool blue: a different shape and colour from the round warm lanterns.
      const hex = (rad: number) => Array.from({ length: 12 }, (_, i) => {
        const a = Math.floor(i / 2) * (Math.PI / 3) - Math.PI / 2;
        return i % 2 === 0 ? Math.cos(a) * rad : Math.sin(a) * rad;
      });
      if (v.lit) {
        g.poly(hex(r + 3)).fill({ color: COLORS.echoLit });
        g.poly(hex((r + 3) * 0.45)).fill({ color: 0xffffff, alpha: 0.75 });
      } else {
        g.poly(hex(r + 3)).fill({ color: COLORS.unlitFill }).stroke({ width: 2, color: COLORS.echoDim });
        g.poly(hex((r + 3) * 0.4)).fill({ color: COLORS.echoLit, alpha: 0.3 });
      }
      return;
    }
    if (v.lit) {
      g.circle(0, 0, r).fill({ color: COLORS.warm });
      g.circle(0, 0, r * 0.5).fill({ color: 0xffffff, alpha: 0.7 });
    } else {
      g.circle(0, 0, r).fill({ color: COLORS.unlitFill }).stroke({ width: 2, color: COLORS.unlitStroke });
      g.circle(0, 0, r * 0.35).fill({ color: COLORS.warm, alpha: 0.16 });
    }
  }

  private rock(x: number, y: number, r: number, seed: number): Graphics {
    const g = new Graphics();
    const rand = rng(seed * 31 + 5);
    const pts: number[] = [];
    const n = 11;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (0.9 + rand() * 0.2);
      pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.circle(x, y, r + 8).stroke({ width: 1, color: 0x6c86b0, alpha: 0.12 });
    g.poly(pts).fill({ color: COLORS.rock }).stroke({ width: 2, color: COLORS.rockEdge });
    g.ellipse(x - r * 0.25, y - r * 0.3, r * 0.4, r * 0.22).fill({ color: 0x3a4660, alpha: 0.45 });
    return g;
  }

  private lilyPad(p: Vec): Graphics {
    const g = new Graphics();
    const r = 24;
    g.moveTo(p.x, p.y);
    g.arc(p.x, p.y, r, 0.35, Math.PI * 2 - 0.1).lineTo(p.x, p.y).fill({ color: COLORS.lily, alpha: 0.85 });
    g.circle(p.x, p.y, r + 5).stroke({ width: 1, color: 0x2d6b4f, alpha: 0.35 });
    return g;
  }
}
