import { tuning } from '../tuning';

// Major pentatonic on D, two octaves: every cascade climbs this ladder, so any order sounds right.
const BASE = 293.66;
const PENTA = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3];
export function pentaNote(step: number): number {
  const s = Math.max(0, step);
  const octave = Math.floor(s / PENTA.length);
  return BASE * PENTA[s % PENTA.length] * 2 ** Math.min(octave, 2);
}

/** Synthesized sound: no files, everything built from oscillators, noise and a generated reverb. */
export class Audio {
  private ctx: AudioContext | null = null;
  private sfx!: GainNode;
  private ambient!: GainNode;
  private wet!: GainNode;
  private noise!: AudioBuffer;
  muted = false;

  /** Must run inside a user gesture (browsers block audio until then). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    comp.connect(ctx.destination);

    const master = ctx.createGain();
    master.connect(comp);
    this.sfx = ctx.createGain();
    this.sfx.connect(master);
    this.ambient = ctx.createGain();
    this.ambient.connect(master);

    const verb = ctx.createConvolver();
    verb.buffer = this.impulse(3.2);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.45;
    this.wet.connect(verb);
    verb.connect(master);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.applyVolumes();
    this.startAmbient();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyVolumes();
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sfx.gain.setTargetAtTime(this.muted ? 0 : tuning.feel.sfxVolume, t, 0.05);
    this.ambient.gain.setTargetAtTime(this.muted ? 0 : tuning.feel.ambientVolume, t, 0.3);
  }

  /** Stone entering water: a falling sine "bloop" plus a short splash of filtered noise. */
  plop(pan: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.panner(pan);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(620, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.14);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.25);
    this.noiseBurst(out, t, 0.06, 2400, 0.12);
    this.send(g, 0.6);
  }

  /** Soft splash of an echo ring leaving a lantern. */
  echoPlop(pan: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(380, t + 0.1);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g).connect(this.panner(pan));
    this.send(g, 0.8);
    o.start(t);
    o.stop(t + 0.2);
  }

  /** A struck bell with slightly inharmonic partials. */
  bell(freq: number, vol: number, pan: number, length = 1.8): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = this.panner(pan);
    const partials: [number, number, number][] = [
      [1, 1, length],
      [2.01, 0.35, length * 0.6],
      [3.0, 0.12, length * 0.35],
      [4.17, 0.06, length * 0.2],
    ];
    for (const [ratio, amp, dec] of partials) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq * ratio;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol * amp, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dec);
      o.connect(g).connect(out);
      this.send(g, 0.9);
      o.start(t);
      o.stop(t + dec + 0.05);
    }
  }

  lantern(step: number, pan: number): void {
    this.bell(pentaNote(step), 0.26, pan);
  }

  /** First ring touched a gold lantern: a quiet high shimmer so the window can be heard. */
  goldTouch(pan: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = pentaNote(12);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.02);
    g.gain.linearRampToValueAtTime(0.0, t + tuning.gold.window);
    o.connect(g).connect(this.panner(pan));
    this.send(g, 0.8);
    o.start(t);
    o.stop(t + tuning.gold.window + 0.05);
  }

  gold(step: number, pan: number): void {
    const f = pentaNote(step + 2);
    this.bell(f, 0.24, pan, 2.6);
    this.bell(f * 1.25, 0.14, pan, 2.4);
    this.bell(f * 1.5, 0.12, pan, 2.2);
    this.bell(f * 4.0, 0.03, pan, 1.2);
  }

  /** Window closed without a second ring: a soft low sigh, never a buzzer. */
  goldMiss(pan: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(pentaNote(5), t);
    o.frequency.exponentialRampToValueAtTime(pentaNote(3), t + 0.4);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.5);
    o.connect(g).connect(this.panner(pan));
    this.send(g, 0.6);
    o.start(t);
    o.stop(t + 0.55);
  }

  /** Stone refused (rock or out of stones): a dry little tock. */
  tock(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.noiseBurst(this.sfx, ctx.currentTime, 0.03, 900, 0.18);
  }

  complete(stars: number): void {
    const steps = stars >= 3 ? [5, 7, 9, 10, 12] : stars === 2 ? [5, 7, 9, 10] : [5, 7, 9];
    steps.forEach((s, i) => setTimeout(() => this.bell(pentaNote(s), 0.2, (i - 2) * 0.2, 2.4), i * 140));
  }

  stilled(): void {
    this.bell(pentaNote(0), 0.12, 0, 2.6);
    setTimeout(() => this.bell(pentaNote(2), 0.08, 0, 2.6), 180);
  }

  private startAmbient(): void {
    const ctx = this.ctx!;
    // Low drifting pad: two detuned sines through a slowly breathing filter.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    lp.connect(this.ambient);
    for (const [f, a] of [
      [73.42, 0.22],
      [110.0, 0.14],
      [146.8 * 1.003, 0.06],
    ] as const) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.value = a;
      o.connect(g).connect(lp);
      o.start();
    }
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.05;
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();
    // Faint water hush: looping noise through a low band-pass.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 500;
    bp.Q.value = 0.6;
    const ng = ctx.createGain();
    ng.gain.value = 0.05;
    src.connect(bp).connect(ng).connect(this.ambient);
    src.start();
  }

  private noiseBurst(out: AudioNode, t: number, len: number, freq: number, vol: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random());
    src.stop(t + len + 0.02);
  }

  private panner(pan: number): AudioNode {
    const ctx = this.ctx!;
    if (!ctx.createStereoPanner) return this.sfx;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.sfx);
    return p;
  }

  private send(node: AudioNode, amount: number): void {
    const g = this.ctx!.createGain();
    g.gain.value = amount * (this.muted ? 0 : tuning.feel.sfxVolume);
    node.connect(g).connect(this.wet);
  }

  private impulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    return buf;
  }
}

export function haptic(ms: number): void {
  if (tuning.feel.haptics && 'vibrate' in navigator) navigator.vibrate(ms);
}
