import { ShaderMaterial, Vector3, Vector4 } from 'three';

export const MAX_RIPPLES = 24;
export const MAX_ROCKS = 4;
export const MAX_LIGHTS = 24;
export const MAX_MARKS = 24;

/** Mark types drawn on the water surface by the shader. */
export const MARK = {
  goldWindow: 1, // param: fraction of window left
  goldMiss: 2, // param: 0..1 progress of the fade
  echoPing: 3, // param: 0..1 phase of the ping
  goldMatch: 4, // param: pulse 0..1
  goldNear: 5,
  goldRim: 6, // param: breathe 0..1
  target: 7,
  flare: 8, // param: 0..1 progress
  splash: 9, // param: 0..1 progress
  reachOk: 10, // lantern this stone would reach
} as const;

const vertex = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const fragment = /* glsl */ `
#define MAX_RIP ${MAX_RIPPLES}
#define MAX_ROCK ${MAX_ROCKS}
#define MAX_LIGHT ${MAX_LIGHTS}
#define MAX_MARK ${MAX_MARKS}
#define PI 3.14159265

uniform float uTime;
uniform vec3 uCam;
uniform vec3 uPond;          // half width, half height, corner radius
uniform int uRipCount;
uniform vec4 uRip[MAX_RIP];  // x, z, radius, alpha
uniform vec4 uRipB[MAX_RIP]; // maxR, kind (0 stone, 1 echo)
uniform int uRockCount;
uniform vec3 uRock[MAX_ROCK];
uniform int uLightCount;
uniform vec4 uLight[MAX_LIGHT];   // x, y, z, intensity
uniform vec3 uLightCol[MAX_LIGHT];
uniform int uMarkCount;
uniform vec4 uMark[MAX_MARK];     // x, z, type, param
uniform vec4 uPreview;            // x, z, R, alpha
uniform vec3 uMoonDir;
uniform float uLine;
uniform float uGlow;
uniform float uWave;
varying vec3 vWorld;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

bool shadowed(vec2 c, vec2 p) {
  for (int k = 0; k < MAX_ROCK; k++) {
    if (k >= uRockCount) break;
    vec3 r = uRock[k];
    vec2 ab = p - c;
    float t = clamp(dot(r.xy - c, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    if (length(c + ab * t - r.xy) < r.z) return true;
  }
  return false;
}

// World size of one screen pixel, set once per fragment so thin lines never alias.
float px = 0.001;

float ring(float d, float r, float w) {
  float ww = max(w, px * 0.85);
  float u = (d - r) / ww;
  return exp(-u * u) * (w / ww);
}

// Anti-aliased version of step(edge, x), softened over about one pixel of x.
float aaStep(float edge, float x, float pxInX) {
  return smoothstep(edge - pxInX, edge + pxInX, x);
}

void main() {
  vec2 p = vWorld.xz;
  px = length(fwidth(p));
  float sd = sdRoundBox(p, uPond.xy, uPond.z);
  if (sd > 0.0) discard;

  // Gentle ambient swell so the surface is never dead flat.
  vec2 grad = 0.005 * uWave * vec2(
    cos(p.x * 3.1 + uTime * 0.7) + 0.6 * cos((p.x + p.y) * 5.3 + uTime * 1.3),
    cos(p.y * 2.4 - uTime * 0.55) + 0.6 * cos((p.x - p.y) * 4.7 - uTime * 1.1)
  );
  vec3 emis = vec3(0.0);

  for (int i = 0; i < MAX_RIP; i++) {
    if (i >= uRipCount) break;
    vec4 a = uRip[i];
    vec2 dv = p - a.xy;
    float d = length(dv);
    float u = d - a.z;
    if (u > 0.25 || u < -0.9) continue;
    if (shadowed(a.xy, p)) continue;
    vec2 dir = dv / max(d, 1e-4);
    float amp = a.w;
    // Wave packet trailing behind the bright front: a few crests that decay inward.
    float w = 0.28;
    float k = 24.0;
    float env = exp(-u * u / (w * w));
    float dh = amp * env * (-2.0 * u / (w * w) * sin(u * k) + k * cos(u * k)) * 0.0024 * uWave;
    grad += dir * dh;
    vec3 col = uRipB[i].y > 0.5 ? vec3(0.32, 0.78, 1.0) : vec3(1.0, 0.86, 0.62);
    float core = ring(d, a.z, uLine);
    float glow = ring(d, a.z, uGlow);
    float wake = 0.28 * ring(d, a.z - 0.16, uLine * 0.8) + 0.12 * ring(d, a.z - 0.34, uLine * 0.7);
    emis += col * amp * (core * 1.25 + glow * 0.12 + wake * 0.6);
  }

  vec3 n = normalize(vec3(-grad.x, 1.0, -grad.y));
  vec3 V = normalize(uCam - vWorld);
  vec3 R = reflect(-V, n);
  float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, V), 0.0), 5.0);

  // Deep ink-blue body, slightly lighter toward the middle of the pond.
  float centre = 1.0 - clamp(length(p / (uPond.xy * 1.3)), 0.0, 1.0);
  // Soft painterly colour patches so the water feels hand-tinted rather than flat.
  float patchy = 0.5 + 0.5 * sin(p.x * 1.3 + 0.7) * sin(p.y * 1.1 - 0.4);
  vec3 deep = mix(vec3(0.004, 0.016, 0.03), vec3(0.012, 0.05, 0.075), centre);
  deep = mix(deep, deep * vec3(0.85, 1.15, 1.1), patchy * 0.6);
  vec3 sky = mix(vec3(0.012, 0.03, 0.05), vec3(0.03, 0.07, 0.12), clamp(R.y, 0.0, 1.0));
  float md = max(dot(R, uMoonDir), 0.0);
  float moon = pow(md, 900.0) * 1.1 + pow(md, 60.0) * 0.025;
  vec3 col = mix(deep, sky, fres) + vec3(0.75, 0.82, 1.0) * moon;

  // Lantern light: a pool on the water plus a specular glint that ripples break into streaks.
  for (int i = 0; i < MAX_LIGHT; i++) {
    if (i >= uLightCount) break;
    vec4 L = uLight[i];
    vec3 toL = normalize(L.xyz - vWorld);
    float spec = pow(max(dot(R, toL), 0.0), 90.0);
    vec2 dl = p - L.xz;
    float pool = exp(-dot(dl, dl) / 0.22);
    col += uLightCol[i] * L.w * (spec * 1.6 + pool * 0.12);
  }

  col += emis;

  // Surface marks: gold timers, echo pings, aim hints, teaching targets.
  for (int i = 0; i < MAX_MARK; i++) {
    if (i >= uMarkCount) break;
    vec4 m = uMark[i];
    vec2 dm = p - m.xy;
    float d = length(dm);
    int t = int(m.z + 0.5);
    float q = m.w;
    if (t == 1) {
      float ang = mod(atan(dm.x, -dm.y) + 2.0 * PI, 2.0 * PI) / (2.0 * PI);
      float arc = aaStep(ang, q, px / (2.0 * PI * max(d, 0.05)));
      col += vec3(1.0, 0.72, 0.18) * (ring(d, 0.3, 0.018) * 2.6 * arc + ring(d, 0.3, 0.06) * 0.25 * arc);
      col += vec3(1.0, 0.7, 0.2) * exp(-d * d / 0.05) * 0.25 * q;
    } else if (t == 2) {
      col += vec3(0.55, 0.4, 0.15) * ring(d, 0.3 + q * 0.1, 0.02) * (1.0 - q) * 1.5;
    } else if (t == 3) {
      col += vec3(0.32, 0.78, 1.0) * ring(d, 0.22 + q * 0.3, 0.014) * (1.0 - q) * 0.9;
    } else if (t == 4) {
      col += vec3(1.0, 0.75, 0.2) * (ring(d, 0.34, 0.02) * 2.0 + ring(d, 0.42, 0.015) * 0.8) * q;
    } else if (t == 5) {
      col += vec3(1.0, 0.75, 0.2) * ring(d, 0.32, 0.012) * 0.35;
    } else if (t == 6) {
      col += vec3(1.0, 0.72, 0.2) * ring(d, 0.27, 0.01) * (0.12 + 0.12 * q);
    } else if (t == 7) {
      for (int k = 0; k < 2; k++) {
        float f = fract(uTime / 1.4 + float(k) * 0.5);
        col += vec3(1.0) * ring(d, 0.46 - f * 0.34, 0.016) * sin(f * PI) * 0.9;
      }
      col += vec3(1.0) * exp(-d * d / 0.0012) * (0.5 + 0.3 * sin(uTime * 4.5));
    } else if (t == 8) {
      col += vec3(1.0, 0.78, 0.25) * ring(d, 0.2 + q * 0.9, 0.03) * (1.0 - q) * 2.5;
    } else if (t == 9) {
      col += vec3(1.0, 0.95, 0.85) * ring(d, 0.03 + q * 0.12, 0.02) * (1.0 - q) * 2.0;
    } else if (t == 10) {
      col += vec3(1.0, 0.8, 0.5) * ring(d, 0.24, 0.012) * 0.6;
    }
  }

  // Aiming: dashed circle where this stone's ring fades out.
  if (uPreview.w > 0.0) {
    vec2 dp = p - uPreview.xy;
    float d = length(dp);
    float ang = atan(dp.y, dp.x);
    float f = fract(ang * 48.0 / (2.0 * PI) + uTime * 0.05);
    float e = px * 48.0 / (2.0 * PI * max(d, 0.05));
    float dash = aaStep(0.5, f, e) * (1.0 - aaStep(1.0 - e, f, e));
    col += vec3(0.8, 0.86, 0.95) * ring(d, uPreview.z, 0.014) * dash * 0.55 * uPreview.w;
    col += vec3(1.0) * ring(d, 0.07, 0.01) * 0.8 * uPreview.w;
  }

  // Darken toward the stone rim, with a faint wet edge line.
  col *= mix(0.45, 1.0, smoothstep(0.0, 0.35, -sd));
  col += vec3(0.1, 0.14, 0.22) * exp(-sd * sd / 0.0006) * 0.5;

  gl_FragColor = vec4(min(col, vec3(3.0)), 1.0);
}
`;

export function createWaterMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      uTime: { value: 0 },
      uCam: { value: new Vector3() },
      uPond: { value: new Vector3(3, 4.5, 1.2) },
      uRipCount: { value: 0 },
      uRip: { value: Array.from({ length: MAX_RIPPLES }, () => new Vector4()) },
      uRipB: { value: Array.from({ length: MAX_RIPPLES }, () => new Vector4()) },
      uRockCount: { value: 0 },
      uRock: { value: Array.from({ length: MAX_ROCKS }, () => new Vector3()) },
      uLightCount: { value: 0 },
      uLight: { value: Array.from({ length: MAX_LIGHTS }, () => new Vector4()) },
      uLightCol: { value: Array.from({ length: MAX_LIGHTS }, () => new Vector3()) },
      uMarkCount: { value: 0 },
      uMark: { value: Array.from({ length: MAX_MARKS }, () => new Vector4()) },
      uPreview: { value: new Vector4() },
      uMoonDir: { value: new Vector3(-0.12, 0.5, -0.86).normalize() },
      uLine: { value: 0.022 },
      uGlow: { value: 0.1 },
      uWave: { value: 1 },
    },
  });
}
