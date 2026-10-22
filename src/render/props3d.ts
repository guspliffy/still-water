import {
  BackSide,
  BoxGeometry,
  CatmullRomCurve3,
  TubeGeometry,
  CanvasTexture,
  DoubleSide,
  ExtrudeGeometry,
  Shape,
  RepeatWrapping,
  SRGBColorSpace,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  Group,
  IcosahedronGeometry,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  Object3D,
  OctahedronGeometry,
  RedFormat,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { rng } from '../sim/geometry';
import type { LanternKind } from '../sim/types';

/*
 * Hand-crafted props in a soft, painterly style: rounded shapes, a few gentle light bands
 * (toon shading), warm paper and wood against cool night water, and thin soft outlines in
 * deep blue rather than black.
 */

let gradient: DataTexture | null = null;
function toonGradient(): DataTexture {
  if (gradient) return gradient;
  // Five close steps: visible bands, but soft enough to stay calm.
  gradient = new DataTexture(new Uint8Array([70, 120, 170, 215, 255]), 5, 1, RedFormat);
  gradient.minFilter = gradient.magFilter = NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}

export function toon(color: number | Color, extra: Partial<ConstructorParameters<typeof MeshToonMaterial>[0]> = {}): MeshToonMaterial {
  return new MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra });
}

const outlineMat = (() => {
  let m: MeshBasicMaterial | null = null;
  return (thickness: number) => {
    if (m && m.userData.t === thickness) return m;
    const mat = new MeshBasicMaterial({ color: 0x0b1424, side: BackSide });
    mat.userData.t = thickness;
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed += normalize(normal) * ${thickness.toFixed(4)};`);
    };
    // The thickness lives in a closure, so give each value its own compiled program.
    mat.customProgramCacheKey = () => `outline-${thickness}`;
    m = mat;
    return mat;
  };
})();

/** Soft ink outline: the same geometry pushed out along its normals, drawn back-faces only. */
export function outlined(mesh: Mesh, thickness = 0.008): Mesh {
  const o = new Mesh(mesh.geometry, outlineMat(thickness));
  o.raycast = () => {};
  mesh.add(o);
  return mesh;
}

export interface LanternProp {
  root: Group;
  /** Part that pops when lit. */
  body: Object3D;
  /** Materials that glow when lit. */
  glowMats: MeshToonMaterial[];
  /** Optional spinning crystal (gold). */
  spinner: Object3D | null;
  /** Height of the light, for reflections. */
  lightY: number;
}

const WOOD_DARK = 0x43301f;

/** Draws a small canvas texture; cached by key so every lantern shares one upload. */
const texCache = new Map<string, CanvasTexture>();
function canvasTex(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true): CanvasTexture {
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new CanvasTexture(c);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.anisotropy = 8;
  texCache.set(key, t);
  return t;
}

/** Soft paper fibres, so surfaces look handmade instead of flat. */
function fibres(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number): void {
  const rand = rng(99);
  for (let i = 0; i < (w * h) / 40; i++) {
    ctx.fillStyle = `rgba(90,60,30,${alpha * rand()})`;
    ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 3, 1);
  }
}

/**
 * Paper lantern skin. `glow` variant is the emissive map: bright paper with the ribs and painted
 * motif left dark, so a lit lantern shows its pattern as a silhouette, like a real one.
 */
function paperSkin(glow: boolean): CanvasTexture {
  return canvasTex(`paper-${glow}`, 512, 256, (ctx, w, h) => {
    ctx.fillStyle = glow ? '#ffffff' : '#efdcb8';
    ctx.fillRect(0, 0, w, h);
    if (!glow) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(120,80,40,0.25)');
      g.addColorStop(0.5, 'rgba(120,80,40,0)');
      g.addColorStop(1, 'rgba(120,80,40,0.25)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      fibres(ctx, w, h, 0.18);
    }
    // Bamboo ribs: thin horizontal lines.
    ctx.fillStyle = glow ? 'rgba(60,40,20,0.35)' : 'rgba(90,60,35,0.45)';
    for (let i = 1; i < 10; i++) ctx.fillRect(0, (i / 10) * h - 1, w, 2);
    // Vermilion bands near top and bottom.
    ctx.fillStyle = glow ? 'rgba(140,30,10,0.75)' : '#b8432f';
    ctx.fillRect(0, h * 0.08, w, h * 0.05);
    ctx.fillRect(0, h * 0.87, w, h * 0.05);
    // Two painted blossoms around the lantern, five round petals and a dot.
    for (const cx of [w * 0.25, w * 0.75]) {
      const cy = h * 0.5;
      ctx.fillStyle = glow ? 'rgba(150,40,20,0.7)' : '#c4513a';
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * 16, cy + Math.sin(a) * 16, 11, 11, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = glow ? 'rgba(160,110,20,0.6)' : '#e8b44a';
      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      ctx.fill();
      // A brushed leaf stroke.
      ctx.strokeStyle = glow ? 'rgba(40,70,40,0.6)' : '#4f7a4a';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx + 22, cy + 20);
      ctx.quadraticCurveTo(cx + 45, cy + 30, cx + 60, cy + 12);
      ctx.stroke();
    }
  });
}

/** Shoji-style lattice panels for the pavilion lantern (6 faces around the cylinder). */
function latticeSkin(glow: boolean): CanvasTexture {
  return canvasTex(`lattice-${glow}`, 768, 256, (ctx, w, h) => {
    ctx.fillStyle = glow ? '#ffffff' : '#cfe3e8';
    ctx.fillRect(0, 0, w, h);
    if (!glow) fibres(ctx, w, h, 0.12);
    const pw = w / 6;
    ctx.fillStyle = glow ? 'rgba(40,30,20,0.85)' : '#4a3424';
    for (let i = 0; i < 6; i++) {
      const x0 = i * pw;
      ctx.fillRect(x0, 0, 6, h);
      ctx.fillRect(x0 + pw - 6, 0, 6, h);
      ctx.fillRect(x0 + pw / 2 - 2, 0, 4, h);
      for (const f of [0.06, 0.36, 0.64, 0.94]) ctx.fillRect(x0, f * h - 3, pw, 6);
    }
  });
}

/** Wood planks with grain for the floats. */
function woodSkin(): CanvasTexture {
  return canvasTex('wood', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#7a5538';
    ctx.fillRect(0, 0, w, h);
    const rand = rng(5);
    for (let p = 0; p < 4; p++) {
      const x = (p / 4) * w;
      ctx.fillStyle = `rgba(${90 + rand() * 30},${60 + rand() * 20},${35 + rand() * 15},0.5)`;
      ctx.fillRect(x, 0, w / 4, h);
      ctx.fillStyle = 'rgba(40,25,12,0.6)';
      ctx.fillRect(x, 0, 2, h);
      ctx.strokeStyle = 'rgba(50,30,15,0.25)';
      for (let g = 0; g < 6; g++) {
        ctx.beginPath();
        const gx = x + 6 + rand() * (w / 4 - 12);
        ctx.moveTo(gx, 0);
        ctx.bezierCurveTo(gx + 6, h * 0.3, gx - 6, h * 0.7, gx + 2, h);
        ctx.stroke();
      }
    }
  });
}

export function makeLantern(kind: LanternKind): LanternProp {
  if (kind === 'echo') return pavilionLantern();
  if (kind === 'gold') return lotusLantern();
  if (kind === 'moon') return moonLantern();
  return paperLantern();
}

function woodFloat(radius: number, sides: number): Mesh {
  const m = outlined(new Mesh(new CylinderGeometry(radius, radius * 1.06, 0.035, sides), toon(0xffffff, { map: woodSkin() })));
  m.position.y = 0.012;
  return m;
}

/** Round paper lantern: painted paper over bamboo ribs, wooden rims, a handle and tassel, on a float. */
function paperLantern(): LanternProp {
  const root = new Group();
  root.add(woodFloat(0.15, 10));
  // Four short legs lift the lantern off the float.
  const legMat = toon(WOOD_DARK);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new Mesh(new CylinderGeometry(0.008, 0.008, 0.05, 5), legMat);
    leg.position.set(Math.cos(a) * 0.05, 0.05, Math.sin(a) * 0.05);
    root.add(leg);
  }

  const body = new Group();
  body.position.y = 0.23;
  const prof: Vector2[] = [];
  const H = 0.15;
  for (let i = 0; i <= 60; i++) {
    const y = -H + (2 * H * i) / 60;
    const k = Math.sqrt(Math.max(0, 1 - (y / (H * 1.12)) ** 2));
    const rib = 1 - 0.03 * Math.abs(Math.sin((y / H) * Math.PI * 5));
    prof.push(new Vector2(Math.max(0.055, 0.15 * k * rib), y));
  }
  const paper = toon(0xffffff, { map: paperSkin(false), emissive: new Color(1.0, 0.68, 0.32), emissiveMap: paperSkin(true), emissiveIntensity: 0.05 });
  body.add(outlined(new Mesh(new LatheGeometry(prof, 40), paper)));
  const rimMat = toon(WOOD_DARK);
  for (const y of [-H, H]) {
    const rim = outlined(new Mesh(new CylinderGeometry(0.064, 0.064, 0.03, 20), rimMat));
    rim.position.y = y;
    body.add(rim);
    const lip = new Mesh(new TorusGeometry(0.064, 0.008, 6, 20), rimMat);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = y + Math.sign(y) * 0.015;
    body.add(lip);
  }
  // Domed lid in warmer wood, so from above it reads as a cap, not an open jar.
  const lidGeo = new SphereGeometry(0.066, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  lidGeo.scale(1, 0.4, 1);
  const lid = outlined(new Mesh(lidGeo, toon(0x9a6a45)), 0.005);
  lid.position.y = H + 0.015;
  // Tops are 20% larger so each kind's shape reads from the steep phone camera.
  lid.scale.setScalar(1.2);
  body.add(lid);
  const knob = new Mesh(new SphereGeometry(0.014, 10, 8), toon(0xb2453a));
  knob.position.y = H + 0.045;
  body.add(knob);
  const handle = new Mesh(new TorusGeometry(0.05, 0.008, 6, 20, Math.PI), rimMat);
  handle.position.y = H + 0.035;
  body.add(handle);
  const cord = new Mesh(new CylinderGeometry(0.004, 0.004, 0.04, 4), toon(0xb2453a));
  cord.position.y = -H - 0.03;
  body.add(cord);
  const tassel = new Mesh(new ConeGeometry(0.016, 0.055, 8), toon(0xb2453a));
  tassel.position.y = -H - 0.07;
  body.add(tassel);
  root.add(body);
  return { root, body, glowMats: [paper], spinner: null, lightY: 0.23 };
}

/** Hexagonal pavilion: lattice paper panels, posts, a curved roof with upturned eaves. */
function pavilionLantern(): LanternProp {
  const root = new Group();
  root.add(woodFloat(0.165, 6));

  const body = new Group();
  body.position.y = 0.03;
  const paper = toon(0xffffff, { map: latticeSkin(false), emissive: new Color(0.4, 0.82, 1.0), emissiveMap: latticeSkin(true), emissiveIntensity: 0.05 });
  const panels = outlined(new Mesh(new CylinderGeometry(0.11, 0.115, 0.2, 6, 1, true), paper));
  panels.position.y = 0.11;
  body.add(panels);
  const wood = toon(WOOD_DARK);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const post = new Mesh(new CylinderGeometry(0.012, 0.012, 0.24, 6), wood);
    post.position.set(Math.cos(a) * 0.118, 0.11, Math.sin(a) * 0.118);
    body.add(post);
  }
  for (const y of [0.0, 0.215]) {
    const band = outlined(new Mesh(new CylinderGeometry(0.128, 0.128, 0.022, 6), wood), 0.005);
    band.position.y = y;
    body.add(band);
  }
  // Curved roof: concave slope that flares up at the eaves.
  const roofProf = [
    [0.0, 0.13], [0.03, 0.115], [0.07, 0.08], [0.12, 0.04], [0.17, 0.012], [0.205, 0.004], [0.225, 0.02], [0.2, 0.0],
  ].map(([x, y]) => new Vector2(x, y));
  const roof = outlined(new Mesh(new LatheGeometry(roofProf, 6), toon(0x4f8aa0, { side: DoubleSide })));
  roof.position.y = 0.225;
  roof.rotation.y = Math.PI / 6;
  roof.scale.set(1.2, 1.1, 1.2);
  body.add(roof);
  // Darker ridges from the peak to each upturned corner, so the curve reads even from above.
  const ridgeMat = toon(0x2f5f74);
  for (let i = 0; i < 6; i++) {
    // Lathe vertices sit exactly on the hexagon corners: (sin phi * x, y, cos phi * x).
    const phi = (i / 6) * Math.PI * 2;
    const pts = roofProf.slice(0, 7).map((v) => new Vector3(Math.sin(phi) * v.x, v.y + 0.004, Math.cos(phi) * v.x));
    roof.add(new Mesh(new TubeGeometry(new CatmullRomCurve3(pts), 16, 0.007, 5), ridgeMat));
  }
  const finial = new Mesh(new SphereGeometry(0.02, 12, 10), toon(0xe8c37a));
  finial.position.y = 0.37;
  body.add(finial);
  const finialBase = new Mesh(new CylinderGeometry(0.008, 0.014, 0.03, 8), toon(0xe8c37a));
  finialBase.position.y = 0.345;
  body.add(finialBase);
  // Little bells hanging from the eave corners.
  const bellMat = toon(0xe8c37a);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const bell = new Mesh(new SphereGeometry(0.011, 8, 6), bellMat);
    bell.position.set(Math.cos(a) * 0.215, 0.215, Math.sin(a) * 0.215);
    body.add(bell);
  }
  root.add(body);
  return { root, body, glowMats: [paper], spinner: null, lightY: 0.15 };
}

/** Crescent outline: the outer circle minus an offset inner circle, as one closed path. */
function crescentShape(r1: number, cx: number, cy: number, r2: number): Shape {
  const d = Math.hypot(cx, cy);
  const phi = Math.atan2(cy, cx);
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const alpha = Math.acos(a / r1);
  const s = new Shape();
  const n = 40;
  // Outer arc, the long way round, away from the inner circle.
  for (let i = 0; i <= n; i++) {
    const t = phi + alpha + ((2 * Math.PI - 2 * alpha) * i) / n;
    const x = Math.cos(t) * r1;
    const y = Math.sin(t) * r1;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  // Inner arc back to the start, through the side facing the outer centre.
  const g0 = Math.atan2(Math.sin(phi - alpha) * r1 - cy, Math.cos(phi - alpha) * r1 - cx);
  let g1 = Math.atan2(Math.sin(phi + alpha) * r1 - cy, Math.cos(phi + alpha) * r1 - cx);
  const mid = (g: number) => Math.hypot(cx + Math.cos(g) * r2, cy + Math.sin(g) * r2) < r1;
  if (g1 > g0 && !mid((g0 + g1) / 2)) g1 -= 2 * Math.PI;
  else if (g1 < g0 && !mid((g0 + g1) / 2)) g1 += 2 * Math.PI;
  for (let i = 1; i <= n; i++) {
    const t = g0 + ((g1 - g0) * i) / n;
    s.lineTo(cx + Math.cos(t) * r2, cy + Math.sin(t) * r2);
  }
  return s;
}

/** Pale crescent moon on a stone post, with a silver bead on its tip: it answers to reflected light. */
function moonLantern(): LanternProp {
  const root = new Group();
  const base = outlined(new Mesh(new CylinderGeometry(0.12, 0.14, 0.05, 14), toon(0x7d8499)));
  base.position.y = 0.02;
  root.add(base);
  // A tall post lifts the crescent clear of the water so it reads as a moon, not a blob.
  const post = outlined(new Mesh(new CylinderGeometry(0.018, 0.024, 0.28, 8), toon(0x6c7287)), 0.004);
  post.position.y = 0.18;
  root.add(post);

  const body = new Group();
  body.position.y = 0.44;
  const geo = new ExtrudeGeometry(crescentShape(0.17, 0.075, 0.055, 0.14), { depth: 0.035, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 3, curveSegments: 24 });
  geo.center();
  // Muted lilac while asleep, so waking up to bright moonlight is a clear change.
  const moonMat = toon(0xb4b6d4, { emissive: new Color(0.85, 0.86, 1.0), emissiveIntensity: 0.05 });
  const crescent = outlined(new Mesh(geo, moonMat), 0.008);
  // Opening to the right and tipped toward the camera, so its face reads from above.
  crescent.rotation.set(-1.0, 0, -0.45);
  crescent.scale.setScalar(1.2);
  body.add(crescent);
  const bead = new Mesh(new SphereGeometry(0.016, 10, 8), toon(0xeef3ff, { emissive: new Color(0.7, 0.78, 0.95), emissiveIntensity: 0.6 }));
  bead.position.set(0.066, 0.163, 0.058);
  crescent.add(bead);
  root.add(body);
  return { root, body, glowMats: [moonMat], spinner: null, lightY: 0.44 };
}

/** Petal with a cream base fading to pink at the tip (vertex colours). */
function petalGeometry(len: number, width: number, tip: Color): BufferGeometry {
  const geo = new SphereGeometry(1, 16, 12);
  geo.translate(0, 0, 1);
  const pos = geo.getAttribute('position') as BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const base = new Color(0xfbf1e8);
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i) / 2;
    // Pointed tip and a slight upward cup.
    const taper = 1 - 0.55 * z * z;
    pos.setX(i, pos.getX(i) * taper);
    pos.setY(i, pos.getY(i) + z * z * 0.6);
    const c = base.clone().lerp(tip, Math.min(1, Math.max(0, (z - 0.35) / 0.65)) ** 1.4);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  geo.scale(width, 0.016, len / 2);
  geo.computeVertexNormals();
  return geo;
}

/** Lotus with three layers of petals and golden stamens, cradling a faceted gold crystal. */
function lotusLantern(): LanternProp {
  const root = new Group();
  root.add(makeLilyPad(0.22, false));

  const body = new Group();
  body.position.y = 0.025;
  const petalMat = toon(0xffffff, { vertexColors: true, emissive: new Color(1.0, 0.7, 0.25), emissiveIntensity: 0.05 });
  const ring = (n: number, len: number, width: number, tilt: number, offset: number, tip: number) => {
    const geo = petalGeometry(len, width, new Color(tip));
    for (let i = 0; i < n; i++) {
      const pivot = new Object3D();
      pivot.rotation.y = (i / n) * Math.PI * 2 + offset;
      pivot.scale.set(1.2, 1, 1.2);
      const p = new Mesh(geo, petalMat);
      p.rotation.x = -tilt;
      pivot.add(p);
      body.add(pivot);
    }
  };
  ring(10, 0.17, 0.05, 0.3, 0, 0xee9fb4);
  ring(8, 0.15, 0.045, 0.75, 0.2, 0xf1a9bc);
  ring(6, 0.11, 0.035, 1.15, 0.5, 0xf6c3cf);
  const stamenMat = toon(0xf0c24a);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const s = new Mesh(new CylinderGeometry(0.004, 0.004, 0.04, 4), stamenMat);
    s.position.set(Math.cos(a) * 0.035, 0.03, Math.sin(a) * 0.035);
    s.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
    body.add(s);
    const tip = new Mesh(new SphereGeometry(0.007, 6, 5), stamenMat);
    tip.position.set(Math.cos(a) * 0.042, 0.05, Math.sin(a) * 0.042);
    body.add(tip);
  }
  const crystalMat = toon(0xffd25a, { emissive: new Color(1.0, 0.68, 0.16), emissiveIntensity: 0.25 });
  // Non-indexed so every face gets its own normal: crisp facets.
  const crystalGeo = new OctahedronGeometry(0.075, 0).toNonIndexed();
  crystalGeo.scale(1, 1.5, 1);
  crystalGeo.computeVertexNormals();
  const crystal = outlined(new Mesh(crystalGeo, crystalMat), 0.006);
  crystal.position.y = 0.15;
  // Three tiny motes orbit the crystal.
  for (let i = 0; i < 3; i++) {
    const mote = new Mesh(new SphereGeometry(0.009, 8, 6), crystalMat);
    const a = (i / 3) * Math.PI * 2;
    mote.position.set(Math.cos(a) * 0.12, (i - 1) * 0.03, Math.sin(a) * 0.12);
    crystal.add(mote);
  }
  body.add(crystal);
  root.add(body);
  return { root, body, glowMats: [crystalMat, petalMat], spinner: crystal, lightY: 0.15 };
}

/**
 * Mirror wall: a low run of dark dressed stones capped with a thin polished silver strip, so it reads
 * as an obstacle without glowing like a tube, and the silver says rings bounce off it. Lies along x.
 * `outline` scales the ink line: obstacles read heavier than decoration (GDD §6).
 */
export function makeWall(length: number, seed: number, outline = 1): Group {
  const g = new Group();
  const rand = rng(seed * 13 + 7);
  const n = Math.max(2, Math.round(length / 0.14));
  const blockLen = length / n;
  const stone = toon(0x2e3540);
  for (let i = 0; i < n; i++) {
    const h = 0.11 + rand() * 0.03;
    const b = outlined(new Mesh(new BoxGeometry(blockLen * 0.94, h, 0.1), stone), 0.005 * outline);
    b.position.set(-length / 2 + blockLen * (i + 0.5), h / 2 - 0.02, (rand() - 0.5) * 0.008);
    b.rotation.y = (rand() - 0.5) * 0.04;
    g.add(b);
  }
  const silver = toon(0xc4ccd8);
  const cap = outlined(new Mesh(new BoxGeometry(length + 0.02, 0.02, 0.05), silver), 0.004 * outline);
  cap.position.y = 0.15;
  g.add(cap);
  // Rounded end posts.
  for (const x of [-length / 2, length / 2]) {
    const post = outlined(new Mesh(new CylinderGeometry(0.055, 0.06, 0.19, 12), stone), 0.005 * outline);
    post.position.set(x, 0.075, 0);
    g.add(post);
  }
  return g;
}

/** Lily pad with real thickness and its notch; optionally with a small water lily. */
export function makeLilyPad(radius: number, flower: boolean, seed = 1): Group {
  const g = new Group();
  const pad = outlined(new Mesh(new CylinderGeometry(radius, radius * 0.97, 0.018, 36, 1, false, 0.35, Math.PI * 2 - 0.5), toon(0x5a9450)), 0.005);
  pad.position.y = 0.006;
  g.add(pad);
  const vein = new Mesh(new CylinderGeometry(radius * 0.55, radius * 0.55, 0.02, 30, 1, false, 0.35, Math.PI * 2 - 0.5), toon(0x6fa860));
  vein.position.y = 0.008;
  g.add(vein);
  if (flower) {
    const rand = rng(seed);
    const f = waterLily(rand() > 0.5 ? 0xf7e7ef : 0xf4c9d6);
    f.position.set(radius * 0.35, 0.014, -radius * 0.25);
    f.scale.setScalar(0.8 + rand() * 0.3);
    g.add(f);
  }
  return g;
}

function waterLily(color: number): Group {
  const g = new Group();
  const geo = new SphereGeometry(1, 10, 8);
  geo.translate(0, 0, 1);
  geo.scale(0.022, 0.01, 0.04);
  const mat = toon(color);
  for (const [n, tilt, off] of [[8, 0.35, 0], [6, 0.9, 0.4]] as const) {
    for (let i = 0; i < n; i++) {
      const pivot = new Object3D();
      pivot.rotation.y = (i / n) * Math.PI * 2 + off;
      const p = new Mesh(geo, mat);
      p.rotation.x = -tilt;
      pivot.add(p);
      g.add(pivot);
    }
  }
  const heart = new Mesh(new SphereGeometry(0.014, 8, 6), toon(0xf2c24e));
  heart.position.y = 0.012;
  g.add(heart);
  return g;
}

/** Rounded grey boulder with moss on top, sitting low in the water. */
export function makeRock(radius: number, seed: number, outline = 1): Mesh {
  const geo = new IcosahedronGeometry(1, 3);
  const pos = geo.getAttribute('position') as BufferAttribute;
  const rand = rng(seed * 13 + 7);
  const ph = [rand() * 6, rand() * 6, rand() * 6];
  const colors = new Float32Array(pos.count * 3);
  const stone = new Color(0xaaa89e);
  const stoneDark = new Color(0x8a8a82);
  const moss = new Color(0x6f9258);
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const n = 1 + 0.12 * Math.sin(v.x * 3 + ph[0]) * Math.cos(v.z * 2.5 + ph[1]) + 0.06 * Math.sin(v.y * 5 + ph[2]);
    const p = v.clone().multiplyScalar(n);
    p.y = p.y * 0.62;
    if (p.y < -0.2) p.y = -0.2 + (p.y + 0.2) * 0.3;
    pos.setXYZ(i, p.x * radius, p.y * radius, p.z * radius);
    const c = stone.clone().lerp(stoneDark, 0.5 + 0.5 * Math.sin(v.x * 7 + v.z * 5 + ph[0]));
    const mossy = v.y > 0.55 && Math.sin(v.x * 6 + ph[1]) + Math.cos(v.z * 5 + ph[2]) > -0.2;
    if (mossy) c.lerp(moss, 0.85);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const m = outlined(new Mesh(geo, toon(0xffffff, { vertexColors: true })), 0.01 * outline);
  return m;
}

/** Soft round bush made of a few overlapping blobs. */
export function makeBush(seed: number, scale: number, shade = 1): Group {
  const g = new Group();
  const rand = rng(seed * 5 + 1);
  const mat = toon(new Color().setHSL(0.32 + rand() * 0.06, 0.32, (0.22 + rand() * 0.06) * shade));
  for (let i = 0; i < 4; i++) {
    const r = (0.18 + rand() * 0.14) * scale;
    const b = outlined(new Mesh(new IcosahedronGeometry(r, 2), mat), 0.01);
    b.position.set((rand() - 0.5) * 0.35 * scale, r * 0.7, (rand() - 0.5) * 0.35 * scale);
    b.scale.y = 0.85;
    g.add(b);
  }
  return g;
}

/** A dark pine seen against the night: a thin trunk and stacked, slightly ragged cones. */
export function makePine(seed: number, height: number): Group {
  const g = new Group();
  const rand = rng(seed * 17 + 3);
  const trunk = new Mesh(new CylinderGeometry(0.035, 0.06, height * 0.35, 6), toon(0x2a2018));
  trunk.position.y = height * 0.17;
  g.add(trunk);
  const needles = toon(0x1f3a30);
  const tiers = 5;
  for (let i = 0; i < tiers; i++) {
    const k = i / (tiers - 1);
    const r = height * (0.3 - k * 0.2) * (0.9 + rand() * 0.2);
    const h = height * 0.32;
    const cone = new Mesh(new ConeGeometry(r, h, 7), needles);
    cone.position.set((rand() - 0.5) * 0.04, height * (0.25 + k * 0.6), (rand() - 0.5) * 0.04);
    cone.rotation.y = rand() * 6;
    g.add(cone);
  }
  return g;
}

/** A single grass blade: thin, slightly curved cone, pivot at the base. */
export function grassBlade(): BufferGeometry {
  const geo = new ConeGeometry(0.012, 1, 3, 4);
  geo.translate(0, 0.5, 0);
  const pos = geo.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    pos.setX(i, pos.getX(i) + y * y * 0.12);
  }
  geo.computeVertexNormals();
  return geo;
}
