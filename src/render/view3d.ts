import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  ExtrudeGeometry,
  FogExp2,
  Group,
  HalfFloatType,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Points,
  Raycaster,
  Scene,
  ShaderMaterial,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  ShapeGeometry,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { rng } from '../sim/geometry';
import type { Sim, SimEvent } from '../sim/sim';
import type { LanternKind, Vec } from '../sim/types';
import { tuning } from '../tuning';
import type { GoldPreview, PondRenderer } from './renderer';
import { grassBlade, makeBush, makeLantern, makeLilyPad, makePine, makeRock, makeWall, toon, type LanternProp } from './props3d';
import { createWaterMaterial, MARK, MAX_LIGHTS, MAX_MARKS, MAX_RIPPLES, MAX_ROCKS, MAX_WALLS } from './water';

/** Pond units (600 x 900) to scene units. */
const S = 0.01;

const COL = {
  warm: new Color(1.0, 0.72, 0.38),
  echo: new Color(0.35, 0.82, 1.0),
  gold: new Color(1.0, 0.68, 0.16),
  moon: new Color(0.8, 0.82, 1.0),
};
const colorOf = (kind: LanternKind) => (kind === 'gold' ? COL.gold : kind === 'echo' ? COL.echo : kind === 'moon' ? COL.moon : COL.warm);

interface Lantern3D {
  kind: LanternKind;
  group: Group;
  prop: LanternProp;
  glow: Sprite;
  /** Dim candle dot while unlit, so a lantern reads as a lantern (null for gold). */
  candle: Sprite | null;
  lit: boolean;
  litAt: number;
  touchedAt: number;
  missAt: number;
  phase: number;
  pos: Vector3;
}

interface Drop {
  p: Vector3;
  v: Vector3;
  born: number;
  life: number;
  c: Color;
}

interface Floater {
  el: HTMLDivElement;
  pos: Vector3;
  born: number;
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/**
 * The bank around the pond: dark moss near the rim falling away to near-black at the frame's edge,
 * with soft blotches so it reads as ground rather than void (design review: "give the pond a place").
 */
function groundTexture(): CanvasTexture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, size * 0.08, size / 2, size / 2, size / 2);
  grad.addColorStop(0, '#1b2a24');
  grad.addColorStop(0.35, '#16231f');
  grad.addColorStop(1, '#06090b');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const rand = rng(29);
  for (let i = 0; i < 140; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 6 + rand() * 26;
    const b = g.createRadialGradient(x, y, 0, x, y, r);
    b.addColorStop(0, rand() < 0.5 ? 'rgba(40,62,44,0.35)' : 'rgba(4,8,8,0.35)');
    b.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = b;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

function glowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  // Gentle core: the halo surrounds the lantern instead of washing its painted detail out.
  g.addColorStop(0, 'rgba(255,255,255,0.4)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function roundRectShape(hw: number, hh: number, r: number, s = new Shape()): Shape {
  s.moveTo(-hw + r, -hh);
  s.lineTo(hw - r, -hh);
  s.quadraticCurveTo(hw, -hh, hw, -hh + r);
  s.lineTo(hw, hh - r);
  s.quadraticCurveTo(hw, hh, hw - r, hh);
  s.lineTo(-hw + r, hh);
  s.quadraticCurveTo(-hw, hh, -hw, hh - r);
  s.lineTo(-hw, -hh + r);
  s.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  return s;
}

/** Soft additive point sprites, used for fireflies and splash droplets. */
function pointsMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uScale: { value: 300 } },
    vertexShader: /* glsl */ `
      attribute float size;
      attribute vec3 color;
      varying vec3 vColor;
      uniform float uScale;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vColor * a, a);
      }`,
  });
}

/**
 * The pond in 3D: a night scene seen from a gentle tilt. Ripples, lantern reflections and surface
 * marks are drawn by one water shader; lanterns, rocks and the stone rim are meshes; bloom adds glow.
 * Reads the sim; never changes it.
 */
export class Pond3D implements PondRenderer {
  readonly canvas: HTMLCanvasElement;
  previewAt: Vec | null = null;
  goldPreview: GoldPreview[] = [];
  targets: Vec[] = [];
  ghost = false;

  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(38, 1, 0.1, 100);
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private water = createWaterMaterial();
  private waterMesh: Mesh;
  private pondGroup = new Group();
  private lanterns: Lantern3D[] = [];
  private glowTex = glowTexture();
  private raycaster = new Raycaster();
  private plane = new Plane(new Vector3(0, 1, 0), 0);
  private sim!: Sim;
  private clock = 0;
  /** Clock time the pond was solved, or -1; drives the lanterns breathing together. */
  private doneAt = -1;
  private screen = { w: 1, h: 1, top: 0, bottom: 0 };
  private flies: { pts: Points; base: Float32Array; phase: Float32Array };
  private drops: Drop[] = [];
  private dropPts: Points;
  private marksExtra: { x: number; z: number; type: number; born: number; life: number }[] = [];
  private floaters: Floater[] = [];
  private floaterLayer: HTMLDivElement;
  private reeds!: InstancedMesh;
  private reedData: { m: Matrix4; phase: number; pos: Vector3; s: number; rot: number }[] = [];
  /** Auto quality: pixel ratio scale drops a step if the device can't hold ~40 fps. */
  private quality = 1;
  private perf = { frames: 0, time: 0, warm: 0 };

  constructor() {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(0x06090b, 1);
    this.canvas = this.renderer.domElement;
    this.canvas.style.touchAction = 'none';

    this.scene.background = new Color(0x06090b);
    this.scene.fog = new FogExp2(0x06090b, 0.05);
    this.scene.add(new AmbientLight(0x5868a0, 1.1));
    this.scene.add(new HemisphereLight(0x8fa8e0, 0x1a2a22, 0.7));
    const moon = new DirectionalLight(0xd2deff, 1.8);
    moon.position.set(-3, 6, -5);
    this.scene.add(moon);
    // Soft fill from the viewer's side so rocks and unlit lanterns read against the dark water.
    const fill = new DirectionalLight(0xffdcb0, 0.55);
    fill.position.set(1, 4, 6);
    this.scene.add(fill);

    this.waterMesh = new Mesh(new PlaneGeometry(1, 1), this.water);
    this.waterMesh.rotation.x = -Math.PI / 2;
    this.scene.add(this.waterMesh, this.pondGroup);

    const ground = new Mesh(new PlaneGeometry(26, 26), new MeshBasicMaterial({ map: groundTexture() }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.12;
    const far = new Mesh(new PlaneGeometry(200, 200), new MeshBasicMaterial({ color: 0x06090b }));
    far.rotation.x = -Math.PI / 2;
    far.position.y = -0.13;
    this.scene.add(ground, far);

    // Fireflies drifting above the water.
    const n = tuning.view3d.fireflies;
    const rand = rng(11);
    const base = new Float32Array(n * 3);
    const phase = new Float32Array(n);
    const fg = new BufferGeometry();
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      base.set([(rand() - 0.5) * 7.5, 0.25 + rand() * 1.1, (rand() - 0.5) * 10.5], i * 3);
      phase[i] = rand() * 100;
      // Warm firefly light, #ffe7a3, a little dimmer or brighter per fly.
      const c = new Color(0xffe7a3).multiplyScalar(0.7 + rand() * 0.3);
      col.set([c.r, c.g, c.b], i * 3);
      size[i] = 0.05 + rand() * 0.05;
    }
    fg.setAttribute('position', new BufferAttribute(base.slice(), 3));
    fg.setAttribute('color', new BufferAttribute(col, 3));
    fg.setAttribute('size', new BufferAttribute(size, 1));
    this.flies = { pts: new Points(fg, pointsMaterial()), base, phase };
    this.scene.add(this.flies.pts);

    // Splash droplet pool.
    const POOL = 320;
    const dg = new BufferGeometry();
    dg.setAttribute('position', new BufferAttribute(new Float32Array(POOL * 3), 3));
    dg.setAttribute('color', new BufferAttribute(new Float32Array(POOL * 3), 3));
    dg.setAttribute('size', new BufferAttribute(new Float32Array(POOL), 1));
    this.dropPts = new Points(dg, pointsMaterial());
    this.dropPts.frustumCulled = false;
    this.scene.add(this.dropPts);

    // Multisampled targets: without them the glow pass renders with no anti-aliasing at all,
    // which made every edge look jagged.
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new Vector2(256, 256), tuning.view3d.bloomStrength, tuning.view3d.bloomRadius, tuning.view3d.bloomThreshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.floaterLayer = document.createElement('div');
    Object.assign(this.floaterLayer.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '5' });
    document.body.appendChild(this.floaterLayer);
  }

  build(sim: Sim): void {
    this.sim = sim;
    const { width: W, height: H, cornerRadius: CR } = sim.p;
    const hw = (W / 2) * S;
    const hh = (H / 2) * S;
    const cr = CR * S;
    this.waterMesh.scale.set(W * S, H * S, 1);
    this.water.uniforms.uPond.value.set(hw, hh, cr);

    for (const c of [...this.pondGroup.children]) {
      this.pondGroup.remove(c);
      c.traverse((o) => {
        const m = o as Mesh;
        m.geometry?.dispose();
      });
    }
    this.floaters.forEach((f) => f.el.remove());
    this.floaters = [];
    this.drops = [];
    this.marksExtra = [];

    this.buildRim(hw, hh, cr);

    const rocks = sim.pond.rocks.slice(0, MAX_ROCKS);
    this.water.uniforms.uRockCount.value = rocks.length;
    rocks.forEach((r, i) => {
      this.water.uniforms.uRock.value[i].set((r.x - W / 2) * S, (r.y - H / 2) * S, r.r * S);
      const rock = makeRock(r.r * S, i, tuning.view3d.obstacleOutline);
      const rp = this.toScene(r);
      rock.position.set(rp.x, 0.0, rp.z);
      rock.rotation.y = i * 1.7;
      this.pondGroup.add(rock);
    });

    const walls = sim.walls.slice(0, MAX_WALLS);
    this.water.uniforms.uWallCount.value = walls.length;
    walls.forEach((w, i) => {
      const a = this.toScene({ x: w.ax, y: w.ay });
      const b = this.toScene({ x: w.bx, y: w.by });
      this.water.uniforms.uWall.value[i].set(a.x, a.z, b.x, b.z);
      const mesh = makeWall(Math.hypot(b.x - a.x, b.z - a.z), i, tuning.view3d.obstacleOutline);
      mesh.position.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
      mesh.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
      this.pondGroup.add(mesh);
    });

    sim.pond.hints.forEach((h, i) => {
      const pad = makeLilyPad(0.24, i % 2 === 0, i + 3);
      pad.position.copy(this.toScene(h));
      pad.rotation.y = i * 2.1;
      this.pondGroup.add(pad);
    });

    // A drifting lantern's path: a faint line of dots on the water.
    const dotGeo = new SphereGeometry(0.022, 8, 6);
    const dotMat = new MeshBasicMaterial({ color: 0xb8c2dc, transparent: true, opacity: 0.85 });
    for (const def of sim.pond.lanterns) {
      if (!def.drift) continue;
      const a = this.toScene(def);
      const b = this.toScene({ x: def.x + def.drift.dx, y: def.y + def.drift.dy });
      const n = Math.max(2, Math.round(a.distanceTo(b) / 0.13));
      for (let k = 0; k <= n; k++) {
        const dot = new Mesh(dotGeo, dotMat);
        dot.position.lerpVectors(a, b, k / n).setY(0.004);
        dot.scale.y = 0.3;
        this.pondGroup.add(dot);
      }
    }

    this.lanterns = sim.pond.lanterns.map((def, i) => this.lanternMesh(def.kind, this.toScene(def), i));
    this.layout(this.screen.w, this.screen.h, this.screen.top, this.screen.bottom);
  }

  layout(screenW: number, screenH: number, top: number, bottom: number): void {
    this.screen = { w: screenW, h: screenH, top, bottom };
    const ratio = this.pixelRatio();
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(screenW, screenH);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(screenW, screenH);
    this.bloom.strength = tuning.view3d.bloomStrength;
    this.bloom.radius = tuning.view3d.bloomRadius;
    this.bloom.threshold = tuning.view3d.bloomThreshold;
    // Dev check (GDD §6): obstacles must still read against the water in greyscale.
    this.renderer.domElement.style.filter = tuning.view3d.grayscaleCheck ? 'grayscale(1)' : '';

    const cam = this.camera;
    cam.fov = tuning.view3d.fovDeg;
    cam.aspect = screenW / screenH;
    cam.clearViewOffset();
    // Portrait screens get a flatter view so the tall pond fills more of the screen.
    const tiltDeg = screenW < screenH ? tuning.view3d.tiltDegPortrait : tuning.view3d.tiltDeg;
    const tilt = (tiltDeg * Math.PI) / 180;
    const hw = (tuning.pond.width / 2) * S + (screenW < screenH ? 0.08 : 0.35);
    // Portrait may crop the rim's top and bottom a little so the pond itself fills the screen.
    const hh = (tuning.pond.height / 2) * S + 0.35 - (screenW < screenH ? tuning.view3d.portraitCrop * S : 0);
    const corners = [new Vector3(-hw, 0.1, -hh), new Vector3(hw, 0.1, -hh), new Vector3(-hw, 0.1, hh), new Vector3(hw, 0.1, hh)];
    const pad = 10;
    const availW = 2 * (1 - (2 * pad) / screenW);
    const topN = 1 - (2 * (top + 4)) / screenH;
    const botN = -1 + (2 * (bottom + 4)) / screenH;
    const availH = topN - botN;

    const place = (d: number) => {
      cam.position.set(0, Math.cos(tilt) * d, Math.sin(tilt) * d);
      cam.lookAt(0, 0, 0);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const c of corners) {
        const v = c.clone().project(cam);
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x);
        y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
      }
      return { x0, x1, y0, y1 };
    };
    let lo = 2;
    let hi = 80;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      const b = place(mid);
      if (b.x1 - b.x0 <= availW && b.y1 - b.y0 <= availH) hi = mid;
      else lo = mid;
    }
    const b = place(hi);
    // Fog only darkens what lies beyond the pond, whatever the camera distance.
    (this.scene.fog as FogExp2).density = 0.5 / hi;
    // Shift the view so the pond sits centred between the top and bottom bars.
    const cy = (b.y0 + b.y1) / 2;
    const want = (topN + botN) / 2;
    cam.setViewOffset(screenW, screenH, 0, ((want - cy) * screenH) / 2, screenW, screenH);
    cam.updateProjectionMatrix();
    this.water.uniforms.uCam.value.copy(cam.position);
    for (const l of this.lanterns) l.group.scale.setScalar(this.propScale());
    (this.flies.pts.material as ShaderMaterial).uniforms.uScale.value = screenH * this.renderer.getPixelRatio() * 0.6;
    (this.dropPts.material as ShaderMaterial).uniforms.uScale.value = screenH * this.renderer.getPixelRatio() * 0.6;
  }

  toWorld(clientX: number, clientY: number): Vec {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new Vector3();
    if (!this.raycaster.ray.intersectPlane(this.plane, hit)) return { x: -9999, y: -9999 };
    return { x: hit.x / S + tuning.pond.width / 2, y: hit.z / S + tuning.pond.height / 2 };
  }

  onEvent(e: SimEvent): void {
    switch (e.type) {
      case 'drop': {
        const p = this.toScene(e);
        this.splash(p, new Color(0.9, 0.92, 1.0), 26, 1.0);
        this.marksExtra.push({ x: p.x, z: p.z, type: MARK.splash, born: this.clock, life: 0.35 });
        break;
      }
      case 'light': {
        const l = this.lanterns[e.lantern];
        l.lit = true;
        l.litAt = this.clock;
        const c = colorOf(e.kind);
        l.glow.material.color.copy(c);
        this.splash(l.pos.clone().setY(l.prop.lightY * l.group.scale.y), c, e.kind === 'gold' ? 34 : 14, 0.8);
        if (e.kind === 'gold') this.marksExtra.push({ x: l.pos.x, z: l.pos.z, type: MARK.flare, born: this.clock, life: tuning.feel.goldFlareMs / 1000 });
        break;
      }
      case 'goldTouch':
        this.lanterns[e.lantern].touchedAt = e.t;
        break;
      case 'goldMiss':
        this.lanterns[e.lantern].missAt = this.clock;
        break;
      case 'goldNearMiss': {
        const l = this.lanterns[e.lantern];
        this.float(l.pos, `${(e.lateBy + this.sim.p.goldWindow).toFixed(2)}s apart`);
        break;
      }
      default:
        break;
    }
  }

  render(now: number, dt: number): void {
    this.clock += dt;
    const sim = this.sim;
    const u = this.water.uniforms;
    u.uTime.value = this.clock;
    u.uWave.value = tuning.view3d.waveHeight;
    u.uLine.value = tuning.ripple.lineWidth * S * 0.75;
    u.uGlow.value = tuning.ripple.glowWidth * S * 0.75;

    // Rings.
    let n = 0;
    for (const r of sim.ripples) {
      if (n >= MAX_RIPPLES) break;
      const rad = sim.radiusAt(r, now);
      if (rad <= 0 || rad > r.maxR) continue;
      const k = rad / r.maxR;
      const a = (1 - k ** tuning.ripple.fadePower) * (r.source === 'echo' ? 0.85 : 1);
      u.uRip.value[n].set((r.x - tuning.pond.width / 2) * S, (r.y - tuning.pond.height / 2) * S, rad * S, a);
      // A newborn ring's core starts 1.3x bright and eases to normal (GDD §4).
      const birth = Math.min(1, (now - r.t0) / (tuning.feel.ringBirthMs / 1000));
      u.uRipB.value[n].set(r.maxR * S, r.source === 'echo' ? 1 : 0, r.mirror + 1, 1 + 0.3 * (1 - smooth(birth)));
      n++;
    }
    u.uRipCount.value = n;

    // Lanterns, their light on the water, and surface marks.
    const marks: [number, number, number, number][] = [];
    let nl = 0;
    const lightDur = tuning.feel.lanternLightMs / 1000;
    const aiming = !!this.previewAt && tuning.assist.reachPreview && sim.done === 'playing';
    const v3 = tuning.view3d;
    u.uLightGain.value.set(v3.poolGain, v3.glintGain, v3.lightCap);
    // Light budget (GDD §4.2): the newest light is brightest, the rest settle and share a budget.
    const litCount = this.lanterns.reduce((c, l) => c + (l.lit ? 1 : 0), 0);
    const share = Math.min(1, v3.litBudget / Math.max(1, litCount));
    if (sim.done === 'complete') {
      if (this.doneAt < 0) this.doneAt = this.clock;
    } else this.doneAt = -1;
    const together = this.doneAt < 0 ? 0 : smooth(Math.min(1, (this.clock - this.doneAt) / (tuning.feel.breatheTogetherMs / 1000)));
    this.lanterns.forEach((l, i) => {
      const st = sim.lanterns[i];
      if (st.def.drift) l.pos.copy(this.toScene(sim.lanternPos(i, now)));
      const bob = Math.sin(this.clock * 1.3 + l.phase) * 0.008;
      l.group.position.set(l.pos.x, bob, l.pos.z);
      l.group.rotation.z = Math.sin(this.clock * 0.9 + l.phase) * 0.035;
      l.group.rotation.x = Math.cos(this.clock * 0.8 + l.phase) * 0.035;
      if (l.prop.spinner) {
        l.prop.spinner.rotation.y += dt * (l.lit ? 0.9 : 0.35);
        l.prop.spinner.position.y = 0.15 + Math.sin(this.clock * 1.7 + l.phase) * 0.012;
      }
      const setGlow = (v: number) => l.prop.glowMats.forEach((m, k) => (m.emissiveIntensity = k === 0 ? v : v * 0.35));
      const flicker = 0.9 + 0.1 * Math.sin(this.clock * 2.3 + l.phase) * Math.sin(this.clock * 3.7 + l.phase * 2);
      if (l.candle) l.candle.visible = !l.lit;
      if (l.lit) {
        const age = this.clock - l.litAt;
        const p = Math.min(1, age / lightDur);
        const pop = 1 + Math.sin(p * Math.PI) * (1 - p) * 0.8;
        l.prop.body.scale.setScalar(pop);
        const isGold = l.kind === 'gold';
        // Pop at full, then settle to a shared steady glow that breathes; one intensity drives all.
        const peak = isGold ? 1.3 : 1;
        const steady = Math.max(v3.litFloor, (isGold ? v3.litSteadyGold : v3.litSteady) * share);
        const settle = smooth(Math.min(1, Math.max(0, age - lightDur) / (tuning.feel.lanternSettleMs / 1000)));
        const breath = 1 + v3.litBreath * settle * Math.sin(this.clock * Math.PI * 2 * v3.litBreathHz + l.phase * (1 - together));
        const I = (peak + (steady - peak) * settle) * breath * Math.min(1, age / 0.12);
        // The pale crescent blooms easily, so it glows a little lower than the paper lanterns.
        setGlow((isGold ? 3.2 / 1.3 : l.kind === 'moon' ? 0.75 : 1.15) * I);
        l.glow.material.opacity = 0.6 * I;
        l.glow.scale.setScalar((isGold ? 1.1 : 0.85) * (1 + 0.6 * (1 - p)));
        if (nl < MAX_LIGHTS) {
          const c = colorOf(l.kind);
          u.uLight.value[nl].set(l.pos.x, l.prop.lightY * l.group.scale.y, l.pos.z, I);
          u.uLightCol.value[nl].set(c.r, c.g, c.b);
          nl++;
        }
        return;
      }
      l.prop.body.scale.setScalar(1);
      l.glow.material.opacity = 0;
      setGlow(0.05 + 0.02 * flicker);
      // While aiming, idle marks step aside so the stone's reach circle is the only circle.
      if (l.kind === 'echo' && !aiming) marks.push([l.pos.x, l.pos.z, MARK.echoPing, ((this.clock + l.phase) / 2.4) % 1]);
      if (l.kind === 'gold') {
        if (!aiming) marks.push([l.pos.x, l.pos.z, MARK.goldRim, 0.5 + 0.5 * Math.sin(this.clock * 1.6 + l.phase)]);
        if (st.windowOpenedAt >= 0) {
          const left = 1 - (now - st.windowOpenedAt) / sim.p.goldWindow;
          if (left > 0) {
            marks.push([l.pos.x, l.pos.z, MARK.goldWindow, left]);
            setGlow(0.4 + 1.8 * left);
            l.glow.material.color.copy(COL.gold);
            l.glow.material.opacity = 0.35 * left;
            l.glow.scale.setScalar(0.9);
          }
        }
        if (l.missAt >= 0 && this.clock - l.missAt < 0.6) marks.push([l.pos.x, l.pos.z, MARK.goldMiss, (this.clock - l.missAt) / 0.6]);
      }
    });
    u.uLightCount.value = nl;

    // Aiming.
    const pp = this.previewAt;
    const canAim = !!pp && tuning.assist.reachPreview && sim.done === 'playing';
    if (canAim && pp) {
      const ok = sim.canDropAt(pp) && sim.stonesLeft > 0;
      const sp = this.toScene(pp);
      u.uPreview.value.set(sp.x, sp.z, sim.p.maxRadius * S, ok ? 1 : 0.35);
      // Only the stone's own reach circle shows while aiming (Jonny, 2026-10-22: more circles confused).
      // Timing help speaks through the gold lantern itself: it glows in pulses when dropping now lights it.
      u.uMeet.value = 0;
      u.uWinW.value = sim.p.speed * sim.p.goldWindow * S;
      if (ok && tuning.assist.goldMatchPreview) {
        const pulse = 0.5 + 0.5 * Math.sin(this.clock * Math.PI * 2 * tuning.feel.goldMatchPulseHz);
        for (const g of this.goldPreview) {
          if (!g.match) continue;
          const l = this.lanterns[g.lantern];
          l.prop.glowMats.forEach((m, k) => (m.emissiveIntensity = (0.5 + 1.6 * pulse) * (k === 0 ? 1 : 0.35)));
          l.glow.material.color.copy(COL.gold);
          l.glow.material.opacity = 0.15 + 0.35 * pulse;
          l.glow.scale.setScalar(0.9);
        }
      }
    } else {
      u.uPreview.value.w = 0;
      u.uMeet.value = 0;
    }
    // After the water settles, unlit lanterns pulse softly so it's clear what was missed.
    if (sim.done === 'stilled') {
      sim.lanterns.forEach((l, i) => {
        if (!l.lit) marks.push([this.lanterns[i].pos.x, this.lanterns[i].pos.z, MARK.missed, 0.5 + 0.5 * Math.sin(this.clock * 3)]);
      });
    }

    for (const t of this.targets) {
      const sp = this.toScene(t);
      marks.push([sp.x, sp.z, MARK.target, 1]);
    }
    this.marksExtra = this.marksExtra.filter((m) => this.clock - m.born < m.life);
    for (const m of this.marksExtra) marks.push([m.x, m.z, m.type, (this.clock - m.born) / m.life]);
    const nm = Math.min(marks.length, MAX_MARKS);
    for (let i = 0; i < nm; i++) u.uMark.value[i].set(...marks[i]);
    u.uMarkCount.value = nm;

    this.updateFlies();
    this.updateDrops(dt);
    this.updateReeds();
    this.updateFloaters();
    this.composer.render(dt);
    this.watchPerf(dt);
  }

  private pixelRatio(): number {
    return Math.max(1, Math.min(window.devicePixelRatio || 1, tuning.view3d.pixelRatioMax) * this.quality);
  }

  /** After a warm-up, average two seconds of frames; step resolution down on slow devices. */
  private watchPerf(dt: number): void {
    const pf = this.perf;
    if (this.quality <= 0.6 || dt <= 0 || dt > 0.25) return;
    if (pf.warm < 2.5) {
      pf.warm += dt;
      return;
    }
    pf.frames++;
    pf.time += dt;
    if (pf.time < 2) return;
    const fps = pf.frames / pf.time;
    pf.frames = 0;
    pf.time = 0;
    if (fps < 40) {
      this.quality = Math.max(0.6, this.quality - 0.2);
      pf.warm = 0;
      this.layout(this.screen.w, this.screen.h, this.screen.top, this.screen.bottom);
    }
  }

  // ---------- helpers ----------

  private toScene(p: Vec): Vector3 {
    return new Vector3((p.x - tuning.pond.width / 2) * S, 0, (p.y - tuning.pond.height / 2) * S);
  }

  private float(pos: Vector3, msg: string): void {
    const el = document.createElement('div');
    el.textContent = msg;
    Object.assign(el.style, {
      position: 'absolute', transform: 'translate(-50%, -100%)', color: '#f0e4c8', font: '500 15px system-ui, sans-serif',
      textShadow: '0 1px 8px #000', whiteSpace: 'nowrap', transition: 'none',
    });
    this.floaterLayer.appendChild(el);
    this.floaters.push({ el, pos: pos.clone().setY(0.45), born: this.clock });
  }

  private updateFloaters(): void {
    this.floaters = this.floaters.filter((f) => {
      const age = this.clock - f.born;
      if (age > 1.8) {
        f.el.remove();
        return false;
      }
      const v = f.pos.clone().setY(f.pos.y + age * 0.12).project(this.camera);
      f.el.style.left = `${((v.x + 1) / 2) * this.screen.w}px`;
      f.el.style.top = `${((1 - v.y) / 2) * this.screen.h}px`;
      f.el.style.opacity = String(Math.min(1, age * 4) * (1 - Math.max(0, age - 1.1) / 0.7));
      return true;
    });
  }

  private splash(at: Vector3, c: Color, count: number, power: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const h = (0.25 + Math.random() * 0.6) * power;
      this.drops.push({
        p: at.clone().setY(at.y + 0.02),
        v: new Vector3(Math.cos(a) * h, (1.1 + Math.random() * 1.3) * power, Math.sin(a) * h),
        born: this.clock,
        life: 0.5 + Math.random() * 0.4,
        c,
      });
    }
    if (this.drops.length > 320) this.drops.splice(0, this.drops.length - 320);
  }

  private updateDrops(dt: number): void {
    const g = this.dropPts.geometry;
    const pos = g.getAttribute('position') as BufferAttribute;
    const col = g.getAttribute('color') as BufferAttribute;
    const size = g.getAttribute('size') as BufferAttribute;
    this.drops = this.drops.filter((d) => this.clock - d.born < d.life && d.p.y > -0.02);
    for (let i = 0; i < 320; i++) {
      const d = this.drops[i];
      if (!d) {
        size.setX(i, 0);
        continue;
      }
      d.v.y -= 6 * dt;
      d.p.addScaledVector(d.v, dt);
      const k = 1 - (this.clock - d.born) / d.life;
      pos.setXYZ(i, d.p.x, d.p.y, d.p.z);
      col.setXYZ(i, d.c.r * k * 1.4, d.c.g * k * 1.4, d.c.b * k * 1.4);
      size.setX(i, 0.035);
    }
    pos.needsUpdate = col.needsUpdate = size.needsUpdate = true;
  }

  private updateFlies(): void {
    const { pts, base, phase } = this.flies;
    const pos = pts.geometry.getAttribute('position') as BufferAttribute;
    const t = this.clock;
    for (let i = 0; i < phase.length; i++) {
      const ph = phase[i];
      pos.setXYZ(
        i,
        base[i * 3] + Math.sin(t * 0.13 + ph) * 0.6,
        base[i * 3 + 1] + Math.sin(t * 0.5 + ph * 2) * 0.12,
        base[i * 3 + 2] + Math.cos(t * 0.11 + ph) * 0.6,
      );
    }
    pos.needsUpdate = true;
    const size = pts.geometry.getAttribute('size') as BufferAttribute;
    for (let i = 0; i < phase.length; i++) size.setX(i, Math.max(0, Math.sin(t * 0.9 + phase[i] * 3)) * 0.09);
    size.needsUpdate = true;
  }

  private updateReeds(): void {
    if (!this.reeds) return;
    const e = new Object3D();
    this.reedData.forEach((r, i) => {
      e.position.copy(r.pos);
      e.rotation.set(Math.sin(this.clock * 0.8 + r.phase) * 0.06, r.rot, Math.cos(this.clock * 0.7 + r.phase) * 0.06);
      e.scale.set(1, r.s, 1);
      e.updateMatrix();
      this.reeds.setMatrixAt(i, e.matrix);
    });
    this.reeds.instanceMatrix.needsUpdate = true;
  }

  private buildRim(hw: number, hh: number, cr: number): void {
    // Wet dark stone with a thin lighter lip where it meets the water.
    const outer = roundRectShape(hw + 0.55, hh + 0.55, cr + 0.55);
    outer.holes.push(roundRectShape(hw + 0.01, hh + 0.01, cr + 0.01) as unknown as import('three').Path);
    const geo = new ExtrudeGeometry(outer, { depth: 0.14, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.05, bevelSegments: 3, curveSegments: 24 });
    const rim = new Mesh(geo, toon(0x3a4244));
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = -0.12;
    this.pondGroup.add(rim);
    const lipShape = roundRectShape(hw + 0.035, hh + 0.035, cr + 0.035);
    lipShape.holes.push(roundRectShape(hw + 0.012, hh + 0.012, cr + 0.012) as unknown as import('three').Path);
    const lip = new Mesh(new ShapeGeometry(lipShape, 24), new MeshBasicMaterial({ color: 0x6a7678 }));
    lip.rotation.x = -Math.PI / 2;
    lip.position.y = 0.072;
    this.pondGroup.add(lip);

    // A few pebbles, warm grey and darker than the rocks in the water so they stay scenery.
    const rand = rng(3);
    const count = 40;
    const pebbles = new InstancedMesh(new IcosahedronGeometry(1, 1), toon(0xffffff), count);
    const e = new Object3D();
    const c = new Color();
    for (let i = 0; i < count; i++) {
      const p = this.rimPoint(hw, hh, cr, rand(), 0.08 + rand() * 0.4);
      const sz = 0.035 + rand() * 0.035;
      e.position.set(p.x, 0.06 + sz * 0.25, p.y);
      e.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      e.scale.set(sz * (1 + rand() * 0.5), sz * 0.55, sz);
      e.updateMatrix();
      pebbles.setMatrixAt(i, e.matrix);
      c.set(0x8c8a84).multiplyScalar(0.5 + rand() * 0.2);
      pebbles.setColorAt(i, c);
    }
    this.pondGroup.add(pebbles);

    // Moss at the four corners of the rim.
    const moss = new InstancedMesh(new IcosahedronGeometry(1, 2), toon(0xffffff), 20);
    const corner = Math.atan2(hh, hw) / (Math.PI * 2);
    const corners = [corner, 0.5 - corner, 0.5 + corner, 1 - corner];
    for (let i = 0; i < 20; i++) {
      const p = this.rimPoint(hw, hh, cr, corners[i % 4] + (rand() - 0.5) * 0.05, 0.1 + rand() * 0.4);
      const sz = 0.04 + rand() * 0.06;
      e.position.set(p.x, 0.06, p.y);
      e.rotation.set(0, rand() * 6, 0);
      e.scale.set(sz * 1.4, sz * 0.3, sz);
      e.updateMatrix();
      moss.setMatrixAt(i, e.matrix);
      c.setHSL(0.27 + rand() * 0.05, 0.3, 0.08 + rand() * 0.04);
      moss.setColorAt(i, c);
    }
    this.pondGroup.add(moss);

    // Grass on the bank; reed clumps at two water corners and where four of the bushes stood.
    const blades = 460;
    this.reeds = new InstancedMesh(grassBlade(), toon(0xffffff), blades);
    this.reedData = [];
    const reedSpots = [
      { t: 0.5 - corner, out: -0.1 },
      { t: 1 - corner, out: -0.1 },
      { t: 0.03, out: 0.75 },
      { t: 0.45, out: 0.75 },
      { t: 0.74, out: 0.75 },
      { t: 0.93, out: 0.75 },
    ];
    for (let i = 0; i < blades; i++) {
      const tall = i % 4 === 0;
      const spot = reedSpots[i % reedSpots.length];
      const t = tall ? spot.t + (rand() - 0.5) * 0.03 : Math.floor(rand() * 36) / 36 + (rand() - 0.5) * 0.012;
      const p = this.rimPoint(hw, hh, cr, (t + 1) % 1, tall ? spot.out + rand() * 0.25 : 0.5 + rand() * 0.6);
      const y = tall ? (spot.out < 0 ? -0.02 : -0.1) : -0.1;
      this.reedData.push({ m: new Matrix4(), phase: rand() * 10, pos: new Vector3(p.x, y, p.y), s: tall ? 0.45 + rand() * 0.45 : 0.14 + rand() * 0.2, rot: rand() * 6 });
      c.setHSL(0.26 + rand() * 0.08, 0.35 + rand() * 0.15, tall ? 0.17 + rand() * 0.08 : 0.2 + rand() * 0.1);
      this.reeds.setColorAt(i, c);
    }
    this.pondGroup.add(this.reeds);

    // Two darker bushes, and one pine leaning in over the far left corner.
    [0.2, 0.62].forEach((t, i) => {
      const p = this.rimPoint(hw, hh, cr, t, 0.95 + rand() * 0.3);
      const bush = makeBush(i, 0.9 + rand() * 0.4, 0.7);
      bush.position.set(p.x, -0.1, p.y);
      this.pondGroup.add(bush);
    });
    const pp = this.rimPoint(hw, hh, cr, 0.5 + corner, 1.5);
    const pine = makePine(1, 2.4);
    pine.position.set(pp.x, -0.1, pp.y);
    pine.rotation.set(0.08, 0, -0.1);
    this.pondGroup.add(pine);

    // A few small lily pads tucked against the edge, purely decorative.
    [0.12, 0.135, 0.37, 0.625, 0.64, 0.875].forEach((t, i) => {
      const p = this.rimPoint(hw, hh, cr, t, -0.16 - rand() * 0.08);
      const pad = makeLilyPad(0.09 + rand() * 0.06, i % 3 === 0, 40 + i);
      pad.position.set(p.x, 0, p.y);
      pad.rotation.y = rand() * 6;
      this.pondGroup.add(pad);
    });
  }

  /** A point on the rim band: t in 0..1 around the perimeter, out = distance outside the water edge. */
  private rimPoint(hw: number, hh: number, cr: number, t: number, out: number): Vec {
    const a = t * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    // Walk out from the centre until outside the rounded rect, then push further by `out`.
    let r = 0;
    const inside = (x: number, z: number) => {
      const qx = Math.abs(x) - hw + cr;
      const qz = Math.abs(z) - hh + cr;
      return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - cr < 0;
    };
    while (inside(dx * r, dz * r) && r < 20) r += 0.02;
    return { x: dx * (r + out), y: dz * (r + out) };
  }

  private lanternMesh(kind: LanternKind, pos: Vector3, i: number): Lantern3D {
    const prop = makeLantern(kind);
    const group = prop.root;
    group.scale.setScalar(this.propScale());
    const base = colorOf(kind);
    const glow = new Sprite(new SpriteMaterial({ map: this.glowTex, color: base.clone(), blending: AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, opacity: 0 }));
    glow.scale.setScalar(1.2);
    glow.position.y = prop.lightY;
    glow.renderOrder = 10;
    group.add(glow);
    let candle: Sprite | null = null;
    if (kind !== 'gold') {
      const warm = kind === 'moon' ? new Color(0.55, 0.6, 0.85) : new Color(1.0, 0.62, 0.3);
      candle = new Sprite(new SpriteMaterial({ map: this.glowTex, color: warm, blending: AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, opacity: 0.4 }));
      candle.scale.setScalar(0.16);
      candle.position.y = prop.lightY;
      candle.renderOrder = 9;
      group.add(candle);
    }
    group.position.copy(pos);
    // The crescent faces the camera; the round lanterns turn freely.
    group.rotation.y = kind === 'moon' ? 0 : i * 0.9;
    this.pondGroup.add(group);
    return { kind, group, prop, glow, candle, lit: false, litAt: -1, touchedAt: -1, missAt: -1, phase: i * 1.7, pos };
  }

  /** Lanterns are drawn larger than life, and larger still on portrait screens where the camera is steep. */
  private propScale(): number {
    return 1.35 * (this.screen.w < this.screen.h ? tuning.view3d.propScalePortrait : 1);
  }
}
