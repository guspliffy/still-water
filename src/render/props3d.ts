import {
  BackSide,
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

const WOOD = 0x6e4b31;
const WOOD_DARK = 0x43301f;

export function makeLantern(kind: LanternKind): LanternProp {
  if (kind === 'echo') return pavilionLantern();
  if (kind === 'gold') return lotusLantern();
  return paperLantern();
}

/** Round paper lantern with horizontal ribs, wooden rims and a little handle, on a wooden float. */
function paperLantern(): LanternProp {
  const root = new Group();
  const float = outlined(new Mesh(new CylinderGeometry(0.15, 0.16, 0.035, 8), toon(WOOD)));
  float.position.y = 0.012;
  root.add(float);

  const body = new Group();
  body.position.y = 0.2;
  const prof: Vector2[] = [];
  const H = 0.15;
  for (let i = 0; i <= 40; i++) {
    const y = -H + (2 * H * i) / 40;
    const k = Math.sqrt(Math.max(0, 1 - (y / (H * 1.12)) ** 2));
    const rib = 1 - 0.035 * Math.abs(Math.sin((y / H) * Math.PI * 4.5));
    prof.push(new Vector2(Math.max(0.055, 0.15 * k * rib), y));
  }
  const paper = toon(0xc2ae8c, { emissive: new Color(1.0, 0.7, 0.35), emissiveIntensity: 0.12 });
  body.add(outlined(new Mesh(new LatheGeometry(prof, 28), paper)));
  const rimMat = toon(WOOD_DARK);
  for (const y of [-H, H]) {
    const rim = outlined(new Mesh(new CylinderGeometry(0.062, 0.062, 0.028, 18), rimMat));
    rim.position.y = y;
    body.add(rim);
  }
  const handle = new Mesh(new TorusGeometry(0.045, 0.008, 6, 18, Math.PI), rimMat);
  handle.position.y = H + 0.012;
  body.add(handle);
  // A thin red cord tassel underneath, a small warm accent.
  const tassel = new Mesh(new ConeGeometry(0.014, 0.05, 6), toon(0xb2453a));
  tassel.position.y = -H - 0.035;
  tassel.rotation.x = Math.PI;
  body.add(tassel);
  root.add(body);
  return { root, body, glowMats: [paper], spinner: null, lightY: 0.2 };
}

/** Little hexagonal pavilion with blue paper panels, wooden posts and a roof, on a hex float. */
function pavilionLantern(): LanternProp {
  const root = new Group();
  const float = outlined(new Mesh(new CylinderGeometry(0.165, 0.175, 0.035, 6), toon(WOOD)));
  float.position.y = 0.012;
  root.add(float);

  const body = new Group();
  body.position.y = 0.03;
  const paper = toon(0x9fc4d0, { emissive: new Color(0.35, 0.8, 1.0), emissiveIntensity: 0.14 });
  const panels = outlined(new Mesh(new CylinderGeometry(0.11, 0.115, 0.2, 6), paper));
  panels.position.y = 0.11;
  body.add(panels);
  const wood = toon(WOOD_DARK);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const post = new Mesh(new CylinderGeometry(0.011, 0.011, 0.22, 5), wood);
    post.position.set(Math.cos(a) * 0.118, 0.11, Math.sin(a) * 0.118);
    body.add(post);
  }
  const band = new Mesh(new CylinderGeometry(0.122, 0.122, 0.02, 6), wood);
  band.position.y = 0.012;
  body.add(band);
  const roof = outlined(new Mesh(new ConeGeometry(0.19, 0.1, 6), toon(0x4f8aa0)));
  roof.position.y = 0.26;
  body.add(roof);
  const finial = new Mesh(new SphereGeometry(0.022, 10, 8), toon(0xe8c37a));
  finial.position.y = 0.325;
  body.add(finial);
  root.add(body);
  return { root, body, glowMats: [paper], spinner: null, lightY: 0.15 };
}

/** Lotus flower on a pad, cradling a gold crystal that floats and slowly turns. */
function lotusLantern(): LanternProp {
  const root = new Group();
  const pad = makeLilyPad(0.2, false);
  root.add(pad);

  const body = new Group();
  body.position.y = 0.025;
  const petalMat = toon(0xf6dcd2, { emissive: new Color(1.0, 0.7, 0.2), emissiveIntensity: 0.05 });
  const petalGeo = new SphereGeometry(1, 14, 10);
  petalGeo.translate(0, 0, 1);
  petalGeo.scale(0.045, 0.018, 0.075);
  const ring = (n: number, tilt: number, offset: number) => {
    for (let i = 0; i < n; i++) {
      const p = new Mesh(petalGeo, petalMat);
      const pivot = new Object3D();
      pivot.rotation.y = (i / n) * Math.PI * 2 + offset;
      p.rotation.x = -tilt;
      pivot.add(p);
      body.add(pivot);
    }
  };
  ring(9, 0.45, 0);
  ring(7, 0.95, 0.3);
  const crystalMat = toon(0xffc94a, { emissive: new Color(1.0, 0.68, 0.16), emissiveIntensity: 0.25 });
  const crystalGeo = new OctahedronGeometry(0.075, 0);
  crystalGeo.scale(1, 1.45, 1);
  const crystal = outlined(new Mesh(crystalGeo, crystalMat), 0.006);
  crystal.position.y = 0.15;
  body.add(crystal);
  root.add(body);
  return { root, body, glowMats: [crystalMat, petalMat], spinner: crystal, lightY: 0.15 };
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
export function makeRock(radius: number, seed: number): Mesh {
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
  const m = outlined(new Mesh(geo, toon(0xffffff, { vertexColors: true })), 0.01);
  return m;
}

/** Soft round bush made of a few overlapping blobs. */
export function makeBush(seed: number, scale: number): Group {
  const g = new Group();
  const rand = rng(seed * 5 + 1);
  const mat = toon(new Color().setHSL(0.32 + rand() * 0.06, 0.32, 0.22 + rand() * 0.06));
  for (let i = 0; i < 4; i++) {
    const r = (0.18 + rand() * 0.14) * scale;
    const b = outlined(new Mesh(new IcosahedronGeometry(r, 2), mat), 0.01);
    b.position.set((rand() - 0.5) * 0.35 * scale, r * 0.7, (rand() - 0.5) * 0.35 * scale);
    b.scale.y = 0.85;
    g.add(b);
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
