import { ShaderMaterial, Vector3, Vector4 } from 'three';

export const MAX_RIPPLES = 24;
export const MAX_ROCKS = 8;
export const MAX_LIGHTS = 24;
export const MAX_MARKS = 24;
export const MAX_WALLS = 3;

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
  missed: 11, // unlit lantern after the water settles; param: pulse 0..1
  partner: 12, // dashed circle around a gold where a partner stone would meet; param: radius
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
#define MAX_WALL ${MAX_WALLS}
#define PI 3.14159265

uniform float uTime;
uniform vec3 uCam;
uniform vec3 uPond;          // half width, half height, corner radius
uniform int uRipCount;
uniform vec4 uRip[MAX_RIP];  // x, z, radius, alpha
uniform vec4 uRipB[MAX_RIP]; // maxR, kind (0 stone, 1 echo), mirror wall + 1 (0 = real ring), core boost
uniform int uWallCount;
uniform vec4 uWall[MAX_WALL]; // ax, az, bx, bz
uniform int uRockCount;
uniform vec3 uRock[MAX_ROCK];
uniform int uLightCount;
uniform vec4 uLight[MAX_LIGHT];   // x, y, z, intensity
uniform vec3 uLightCol[MAX_LIGHT];
uniform vec3 uLightGain; // pool, glint, soft cap
uniform int uMarkCount;
uniform vec4 uMark[MAX_MARK];     // x, z, type, param
uniform vec4 uPreview;            // x, z, R, alpha
uniform float uMeet;              // 1 while aiming: show where the new ring meets moving rings
uniform float uWinW;              // gold window as a distance (speed * window)
uniform vec3 uMoonDir;
uniform float uLine;
uniform float uGlow;
uniform float uWave;
varying vec3 vWorld;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// Where segment pq crosses segment ab, as a fraction along pq, or -1.
float crossAt(vec2 p, vec2 q, vec2 a, vec2 b) {
  vec2 r = q - p;
  vec2 s = b - a;
  float den = r.x * s.y - r.y * s.x;
  if (abs(den) < 1e-7) return -1.0;
  vec2 ap = a - p;
  float t = (ap.x * s.y - ap.y * s.x) / den;
  float u = (ap.x * r.y - ap.y * r.x) / den;
  return (t >= 0.0 && t <= 1.0 && u >= 0.0 && u <= 1.0) ? t : -1.0;
}

// A rock or a wall (other than skip) between c and p.
bool shadowed(vec2 c, vec2 p, int skip) {
  for (int k = 0; k < MAX_ROCK; k++) {
    if (k >= uRockCount) break;
    vec3 r = uRock[k];
    vec2 ab = p - c;
    float t = clamp(dot(r.xy - c, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    if (length(c + ab * t - r.xy) < r.z) return true;
  }
  for (int k = 0; k < MAX_WALL; k++) {
    if (k >= uWallCount) break;
    if (k != skip && crossAt(c, p, uWall[k].xy, uWall[k].zw) >= 0.0) return true;
  }
  return false;
}

// Whether ring i shows at p. A bounced ring is centred on the mirror image of its source; it
// shows only on the source's side of its wall, along paths that really touch the wall.
bool ripVisible(int i, vec2 p) {
  vec2 c = uRip[i].xy;
  int m = int(uRipB[i].z + 0.5) - 1;
  if (m < 0) return !shadowed(c, p, -1);
  for (int k = 0; k < MAX_WALL; k++) {
    if (k != m) continue;
    vec2 wa = uWall[k].xy;
    vec2 wb = uWall[k].zw;
    vec2 n = normalize(vec2(wa.y - wb.y, wb.x - wa.x));
    vec2 src = c - 2.0 * dot(c - wa, n) * n;
    if (dot(p - wa, n) * dot(src - wa, n) <= 0.0) return false;
    float t = crossAt(c, p, wa, wb);
    if (t < 0.0) return false;
    vec2 hit = c + (p - c) * t;
    return !shadowed(src, hit, m) && !shadowed(hit, p, m);
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
    if (!ripVisible(i, p)) continue;
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
    emis += col * amp * (core * 1.25 * uRipB[i].w + glow * 0.12 + wake * 0.6);
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
  // The moon sits just above the frame: a sharp glint, a soft halo, and a broad sheen on the far water.
  float moon = pow(md, 900.0) * 1.1 + pow(md, 60.0) * 0.025 + pow(md, 6.0) * 0.045;
  vec3 col = mix(deep, sky, fres) + vec3(0.75, 0.82, 1.0) * moon;

  // Lantern light: a pool on the water plus a specular glint that ripples break into streaks.
  // The sum is soft-clamped so a solved pond glows rather than blazes (GDD §4.2).
  vec3 lit = vec3(0.0);
  for (int i = 0; i < MAX_LIGHT; i++) {
    if (i >= uLightCount) break;
    vec4 L = uLight[i];
    vec3 toL = normalize(L.xyz - vWorld);
    float spec = pow(max(dot(R, toL), 0.0), 90.0);
    vec2 dl = p - L.xz;
    float pool = exp(-dot(dl, dl) / 0.22);
    lit += uLightCol[i] * L.w * (spec * uLightGain.y + pool * uLightGain.x);
  }
  col += uLightGain.z * (1.0 - exp(-lit / uLightGain.z));

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
    } else if (t == 11) {
      col += vec3(1.0, 0.62, 0.55) * (ring(d, 0.26 + q * 0.05, 0.012) * (0.35 + 0.35 * q));
    } else if (t == 12) {
      float f = fract(atan(dm.y, dm.x) * 36.0 / (2.0 * PI) - uTime * 0.04);
      float e = px * 36.0 / (2.0 * PI * max(d, 0.05));
      float dash = aaStep(0.5, f, e) * (1.0 - aaStep(1.0 - e, f, e));
      col += vec3(1.0, 0.78, 0.35) * ring(d, q, 0.011) * dash * 0.45;
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

    // Meeting band: where the ring you'd drop now meets each ring already moving. Inside the
    // soft band both arrive within the gold window; the bright line is "exactly together".
    if (uMeet > 0.5 && d < uPreview.z && !shadowed(uPreview.xy, p, -1)) {
      for (int i = 0; i < MAX_RIP; i++) {
        if (i >= uRipCount) break;
        vec4 a = uRip[i];
        float maxR = uRipB[i].x;
        float di = length(p - a.xy);
        if (a.z >= maxR || di < a.z || di > maxR) continue;
        if (!ripVisible(i, p)) continue;
        float f = d - di + a.z;
        float band = 1.0 - smoothstep(uWinW * 0.75, uWinW, abs(f));
        float fade = 1.0 - smoothstep(maxR * 0.8, maxR, di);
        col += vec3(1.0, 0.76, 0.3) * (band * 0.06 + ring(f, 0.0, uLine * 0.7) * 0.4) * fade;
      }
    }
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
      uWallCount: { value: 0 },
      uWall: { value: Array.from({ length: MAX_WALLS }, () => new Vector4()) },
      uLightCount: { value: 0 },
      uLightGain: { value: new Vector3(0.1, 1.2, 0.6) },
      uLight: { value: Array.from({ length: MAX_LIGHTS }, () => new Vector4()) },
      uLightCol: { value: Array.from({ length: MAX_LIGHTS }, () => new Vector3()) },
      uMarkCount: { value: 0 },
      uMark: { value: Array.from({ length: MAX_MARKS }, () => new Vector4()) },
      uPreview: { value: new Vector4() },
      uMeet: { value: 0 },
      uWinW: { value: 0.5 },
      uMoonDir: { value: new Vector3(-0.12, 0.5, -0.86).normalize() },
      uLine: { value: 0.022 },
      uGlow: { value: 0.1 },
      uWave: { value: 1 },
    },
  });
}
