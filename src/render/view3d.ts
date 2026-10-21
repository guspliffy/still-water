import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DodecahedronGeometry,
  DoubleSide,
  ExtrudeGeometry,
  FogExp2,
  Group,
  HemisphereLight,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Points,
  Raycaster,
  Scene,
  ShaderMaterial,
  Shape,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
  ConeGeometry,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { dist, isOccluded, rng } from '../sim/geometry';
import type { Sim, SimEvent } from '../sim/sim';
import type { LanternKind, Vec } from '../sim/types';
import { tuning } from '../tuning';
import type { GoldPreview, PondRenderer } from './renderer';
import { createWaterMaterial, MARK, MAX_LIGHTS, MAX_MARKS, MAX_RIPPLES, MAX_ROCKS } from './water';

/** Pond units (600 x 900) to scene units. */
const S = 0.01;

const COL = {
  warm: new Color(1.0, 0.72, 0.38),
  echo: new Color(0.35, 0.82, 1.0),
  gold: new Color(1.0, 0.68, 0.16),
};

interface Lantern3D {
  kind: LanternKind;
  group: Group;
  body: Mesh;
  mat: MeshStandardMaterial;
  glow: Sprite;
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

function glowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.5)');
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
  private screen = { w: 1, h: 1, top: 0, bottom: 0 };
  private flies: { pts: Points; base: Float32Array; phase: Float32Array };
  private drops: Drop[] = [];
  private dropPts: Points;
  private marksExtra: { x: number; z: number; type: number; born: number; life: number }[] = [];
  private floaters: Floater[] = [];
  private floaterLayer: HTMLDivElement;
  private reeds!: InstancedMesh;
  private reedData: { m: Matrix4; phase: number; pos: Vector3; s: number; rot: number }[] = [];

  constructor() {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tuning.view3d.pixelRatioMax));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(0x02040a, 1);
    this.canvas = this.renderer.domElement;
    this.canvas.style.touchAction = 'none';

    this.scene.background = new Color(0x02040a);
    this.scene.fog = new FogExp2(0x02040a, 0.07);
    this.scene.add(new AmbientLight(0x3a5480, 1.2));
    this.scene.add(new HemisphereLight(0x3a5a90, 0x05070c, 0.6));
    const moon = new DirectionalLight(0xc8d8ff, 1.4);
    moon.position.set(-3, 6, -5);
    this.scene.add(moon);
    // Soft fill from the viewer's side so rocks and unlit lanterns read against the dark water.
    const fill = new DirectionalLight(0x8090b0, 0.9);
    fill.position.set(1, 4, 6);
    this.scene.add(fill);

    this.waterMesh = new Mesh(new PlaneGeometry(1, 1), this.water);
    this.waterMesh.rotation.x = -Math.PI / 2;
    this.scene.add(this.waterMesh, this.pondGroup);

    const ground = new Mesh(new PlaneGeometry(80, 80), new MeshStandardMaterial({ color: 0x05070c, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.12;
    this.scene.add(ground);

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
      const c = new Color().setHSL(0.13 + rand() * 0.05, 0.9, 0.55);
      col.set([c.r * 0.9, c.g * 0.9, c.b * 0.6], i * 3);
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

    this.composer = new EffectComposer(this.renderer);
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
      this.pondGroup.add(this.rockMesh(r.x, r.y, r.r, i));
    });

    for (const h of sim.pond.hints) this.pondGroup.add(this.lilyPad(this.toScene(h)));

    this.lanterns = sim.pond.lanterns.map((def, i) => this.lanternMesh(def.kind, this.toScene(def), i));
    this.layout(this.screen.w, this.screen.h, this.screen.top, this.screen.bottom);
  }

  layout(screenW: number, screenH: number, top: number, bottom: number): void {
    this.screen = { w: screenW, h: screenH, top, bottom };
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tuning.view3d.pixelRatioMax));
    this.renderer.setSize(screenW, screenH);
    this.composer.setSize(screenW, screenH);
    this.bloom.strength = tuning.view3d.bloomStrength;
    this.bloom.radius = tuning.view3d.bloomRadius;
    this.bloom.threshold = tuning.view3d.bloomThreshold;

    const cam = this.camera;
    cam.fov = tuning.view3d.fovDeg;
    cam.aspect = screenW / screenH;
    cam.clearViewOffset();
    // Portrait screens get a flatter view so the tall pond fills more of the screen.
    const tiltDeg = screenW < screenH ? tuning.view3d.tiltDegPortrait : tuning.view3d.tiltDeg;
    const tilt = (tiltDeg * Math.PI) / 180;
    const hw = (tuning.pond.width / 2) * S + (screenW < screenH ? 0.08 : 0.35);
    const hh = (tuning.pond.height / 2) * S + 0.35;
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
        const c = e.kind === 'gold' ? COL.gold : e.kind === 'echo' ? COL.echo : COL.warm;
        l.mat.emissive.copy(c);
        l.mat.color.set(e.kind === 'gold' ? 0xffd27a : 0xfff1dc);
        l.glow.material.color.copy(c);
        this.splash(l.pos.clone().setY(0.2), c, e.kind === 'gold' ? 34 : 14, 0.8);
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
      u.uRipB.value[n].set(r.maxR * S, r.source === 'echo' ? 1 : 0, 0, 0);
      n++;
    }
    u.uRipCount.value = n;

    // Lanterns, their light on the water, and surface marks.
    const marks: [number, number, number, number][] = [];
    let nl = 0;
    const lightDur = tuning.feel.lanternLightMs / 1000;
    this.lanterns.forEach((l, i) => {
      const st = sim.lanterns[i];
      const bob = Math.sin(this.clock * 1.3 + l.phase) * 0.012;
      l.group.position.set(l.pos.x, tuning.view3d.lanternFloat + bob, l.pos.z);
      l.group.rotation.z = Math.sin(this.clock * 0.9 + l.phase) * 0.05;
      l.group.rotation.x = Math.cos(this.clock * 0.8 + l.phase) * 0.05;
      if (l.kind === 'gold') l.body.rotation.y += dt * (l.lit ? 0.9 : 0.35);
      const flicker = 0.9 + 0.1 * Math.sin(this.clock * 2.3 + l.phase) * Math.sin(this.clock * 3.7 + l.phase * 2);
      if (l.lit) {
        const age = this.clock - l.litAt;
        const p = Math.min(1, age / lightDur);
        const pop = 1 + Math.sin(p * Math.PI) * (1 - p) * 0.8;
        l.body.scale.setScalar(pop);
        const isGold = l.kind === 'gold';
        l.mat.emissiveIntensity = (isGold ? 3.2 : 2.4) * flicker * Math.min(1, age / 0.12);
        l.glow.material.opacity = 0.75 * flicker * Math.min(1, age / 0.15);
        l.glow.scale.setScalar((isGold ? 1.5 : 1.15) * (1 + 0.6 * (1 - p)));
        if (nl < MAX_LIGHTS) {
          const c = isGold ? COL.gold : l.kind === 'echo' ? COL.echo : COL.warm;
          u.uLight.value[nl].set(l.pos.x, tuning.view3d.lanternFloat + 0.05, l.pos.z, flicker * Math.min(1, age / 0.15) * (isGold ? 1.3 : 1));
          u.uLightCol.value[nl].set(c.r, c.g, c.b);
          nl++;
        }
        return;
      }
      l.body.scale.setScalar(1);
      l.glow.material.opacity = 0;
      l.mat.emissiveIntensity = 0.35 + 0.08 * flicker;
      if (l.kind === 'echo') marks.push([l.pos.x, l.pos.z, MARK.echoPing, ((this.clock + l.phase) / 2.4) % 1]);
      if (l.kind === 'gold') {
        marks.push([l.pos.x, l.pos.z, MARK.goldRim, 0.5 + 0.5 * Math.sin(this.clock * 1.6 + l.phase)]);
        if (st.windowOpenedAt >= 0) {
          const left = 1 - (now - st.windowOpenedAt) / sim.p.goldWindow;
          if (left > 0) {
            marks.push([l.pos.x, l.pos.z, MARK.goldWindow, left]);
            l.mat.emissiveIntensity = 0.4 + 1.6 * left;
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
      if (ok) {
        sim.lanterns.forEach((l, i) => {
          if (l.lit || l.def.kind === 'gold') return;
          if (dist(pp, l.def) <= sim.p.maxRadius && !isOccluded(pp, l.def, sim.pond.rocks)) marks.push([this.lanterns[i].pos.x, this.lanterns[i].pos.z, MARK.reachOk, 1]);
        });
        for (const g of this.goldPreview) {
          const l = this.lanterns[g.lantern];
          if (g.match && tuning.assist.goldMatchPreview) marks.push([l.pos.x, l.pos.z, MARK.goldMatch, 0.6 + 0.4 * Math.sin(now * 12)]);
          else marks.push([l.pos.x, l.pos.z, MARK.goldNear, 1]);
        }
      }
    } else u.uPreview.value.w = 0;

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
    const outer = roundRectShape(hw + 0.55, hh + 0.55, cr + 0.55);
    outer.holes.push(roundRectShape(hw + 0.01, hh + 0.01, cr + 0.01) as unknown as import('three').Path);
    const geo = new ExtrudeGeometry(outer, { depth: 0.14, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.05, bevelSegments: 3, curveSegments: 24 });
    const rim = new Mesh(geo, new MeshStandardMaterial({ color: 0x2c3442, roughness: 0.92, metalness: 0 }));
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = -0.12;
    this.pondGroup.add(rim);

    // Pebbles scattered along the rim.
    const rand = rng(3);
    const count = 140;
    const pebbles = new InstancedMesh(new DodecahedronGeometry(1, 0), new MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), count);
    const e = new Object3D();
    const c = new Color();
    for (let i = 0; i < count; i++) {
      const p = this.rimPoint(hw, hh, cr, rand(), 0.08 + rand() * 0.42);
      const s = 0.03 + rand() * 0.07;
      e.position.set(p.x, 0.06 + s * 0.3, p.y);
      e.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      e.scale.set(s * (1 + rand() * 0.6), s * 0.6, s);
      e.updateMatrix();
      pebbles.setMatrixAt(i, e.matrix);
      c.setHSL(0.6, 0.08 + rand() * 0.08, 0.22 + rand() * 0.18);
      pebbles.setColorAt(i, c);
    }
    this.pondGroup.add(pebbles);

    // Reeds clustered near a few spots on the rim, swaying.
    const reedCount = 70;
    this.reeds = new InstancedMesh(new ConeGeometry(0.012, 1, 4, 1).translate(0, 0.5, 0), new MeshStandardMaterial({ color: 0x1d3a2a, roughness: 1 }), reedCount);
    this.reedData = [];
    const clusters = [0.08, 0.31, 0.57, 0.83];
    for (let i = 0; i < reedCount; i++) {
      const base = clusters[i % clusters.length] + (rand() - 0.5) * 0.05;
      const p = this.rimPoint(hw, hh, cr, (base + 1) % 1, 0.15 + rand() * 0.35);
      this.reedData.push({ m: new Matrix4(), phase: rand() * 10, pos: new Vector3(p.x, 0.05, p.y), s: 0.25 + rand() * 0.55, rot: rand() * 6 });
    }
    this.pondGroup.add(this.reeds);
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

  private rockMesh(x: number, y: number, r: number, seed: number): Mesh {
    const geo = new DodecahedronGeometry(r * S, 1);
    const pos = geo.getAttribute('position') as BufferAttribute;
    const rand = rng(seed * 17 + 3);
    const jitter = new Map<string, number>();
    for (let i = 0; i < pos.count; i++) {
      const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
      if (!jitter.has(key)) jitter.set(key, 0.85 + rand() * 0.3);
      const j = jitter.get(key)!;
      pos.setXYZ(i, pos.getX(i) * j, pos.getY(i) * j * 0.7, pos.getZ(i) * j);
    }
    geo.computeVertexNormals();
    const m = new Mesh(geo, new MeshStandardMaterial({ color: 0x4a5468, roughness: 0.85, flatShading: true }));
    const p = this.toScene({ x, y });
    m.position.set(p.x, 0.02, p.z);
    m.rotation.y = seed * 1.7;
    return m;
  }

  private lilyPad(p: Vector3): Mesh {
    const m = new Mesh(
      new CircleGeometry(0.24, 32, 0.4, Math.PI * 2 - 0.5),
      new MeshStandardMaterial({ color: 0x1f5238, roughness: 0.6, emissive: 0x0b2216, emissiveIntensity: 0.6, side: DoubleSide }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(p.x, 0.006, p.z);
    return m;
  }

  private lanternMesh(kind: LanternKind, pos: Vector3, i: number): Lantern3D {
    const group = new Group();
    let geo: BufferGeometry;
    if (kind === 'gold') {
      geo = new OctahedronGeometry(0.16, 0);
      geo.scale(1, 1.35, 1);
    } else if (kind === 'echo') {
      geo = new CylinderGeometry(0.13, 0.13, 0.22, 6);
    } else {
      const prof = [
        [0.0, -0.12], [0.06, -0.118], [0.115, -0.08], [0.14, -0.02], [0.14, 0.02], [0.115, 0.08], [0.06, 0.118], [0.0, 0.12],
      ].map(([x, y]) => new Vector2(x, y));
      geo = new LatheGeometry(prof, 24);
    }
    const base = kind === 'gold' ? COL.gold : kind === 'echo' ? COL.echo : COL.warm;
    const mat = new MeshStandardMaterial({
      color: kind === 'gold' ? 0x8a6a2c : kind === 'echo' ? 0x2c5a70 : 0x6a5a48,
      roughness: kind === 'gold' ? 0.3 : 0.75,
      metalness: kind === 'gold' ? 0.6 : 0,
      emissive: base.clone(),
      emissiveIntensity: 0.25,
    });
    const body = new Mesh(geo, mat);
    group.add(body);
    if (kind === 'echo') {
      // Dark caps top and bottom, like a paper lantern's frame.
      const capMat = new MeshStandardMaterial({ color: 0x3a2e22, roughness: 0.8 });
      const segs = 6;
      const r = 0.135;
      const top = new Mesh(new CylinderGeometry(r, r, 0.025, segs), capMat);
      top.position.y = 0.12;
      const bot = top.clone();
      bot.position.y = -top.position.y;
      body.add(top, bot);
    }
    const glow = new Sprite(new SpriteMaterial({ map: this.glowTex, color: base.clone(), blending: AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, opacity: 0 }));
    glow.scale.setScalar(1.2);
    glow.renderOrder = 10;
    group.add(glow);
    group.position.copy(pos);
    this.pondGroup.add(group);
    return { kind, group, body, mat, glow, lit: false, litAt: -1, touchedAt: -1, missAt: -1, phase: i * 1.7, pos };
  }
}
