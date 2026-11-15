import { clamp, sanitizeSampleRate } from './smoothing';

export type OscillatorWaveform = 'sine' | 'triangle' | 'saw' | 'pulse';

const TWO_PI = Math.PI * 2;

/**
 * Polynomial Band-Limited Step (PolyBLEP) residual for step discontinuities.
 * `t` is normalized phase in [0, 1) and `dt` is normalized frequency (hz / sampleRate).
 */
export function polyBlep(t: number, dt: number): number {
  if (dt <= 0) return 0;
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/**
 * Polynomial Band-Limited Ramp (PolyBLAMP) residual for slope discontinuities
 * (used for alias-reduced triangle corners without integrator drift).
 */
export function polyBlamp(t: number, dt: number): number {
  if (dt <= 0) return 0;
  if (t < dt) {
    const u = 1 - t / dt;
    return (dt / 3) * u * u * u;
  }
  if (t > 1 - dt) {
    const u = 1 + (t - 1) / dt;
    return (dt / 3) * u * u * u;
  }
  return 0;
}

/**
 * Band-limited oscillator supporting sine, triangle, saw, and variable-width pulse.
 */
export class PolyBlepOscillator {
  private sampleRate: number;
  private freqHz = 110;
  private dt = 110 / 48000;
  private phase = 0;
  private pulseWidth = 0.5;
  private waveform: OscillatorWaveform = 'saw';

  constructor(sampleRate = 48000) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.updateDt();
  }

  public setSampleRate(sampleRate: number): void {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.updateDt();
  }

  public setFreq(hz: number, sampleRate?: number): void {
    if (sampleRate !== undefined) {
      this.sampleRate = sanitizeSampleRate(sampleRate);
    }
    this.freqHz = Number.isFinite(hz) ? clamp(hz, 0, this.sampleRate * 0.49) : 0;
    this.updateDt();
  }

  public setWaveform(type: OscillatorWaveform): void {
    this.waveform = type;
  }

  public setPulseWidth(pw: number): void {
    this.pulseWidth = clamp(pw, 0.02, 0.98);
  }

  public reset(phase = 0): void {
    if (!Number.isFinite(phase)) {
      this.phase = 0;
      return;
    }
    let wrapped = phase % 1;
    if (wrapped < 0) wrapped += 1;
    this.phase = wrapped;
  }

  public processSample(): number {
    const p = this.phase;
    const dt = this.dt;
    let out = 0;

    switch (this.waveform) {
      case 'sine': {
        out = Math.sin(TWO_PI * p);
        break;
      }
      case 'saw': {
        out = 2 * p - 1 - polyBlep(p, dt);
        break;
      }
      case 'pulse': {
        const pw = this.pulseWidth;
        const naive = p < pw ? 1 : -1;
        let fallingPhase = p - pw;
        if (fallingPhase < 0) fallingPhase += 1;
        out = naive + polyBlep(p, dt) - polyBlep(fallingPhase, dt);
        break;
      }
      case 'triangle': {
        const naive = 4 * (p < 0.5 ? p : 1 - p) - 1;
        let topCorner = p - 0.5;
        if (topCorner < 0) topCorner += 1;
        out = naive + 4 * polyBlamp(p, dt) - 4 * polyBlamp(topCorner, dt);
        break;
      }
    }

    let nextPhase = p + dt;
    if (nextPhase >= 1) nextPhase -= Math.floor(nextPhase);
    this.phase = nextPhase;

    return out;
  }

  private updateDt(): void {
    this.dt = clamp(this.freqHz / this.sampleRate, 0, 0.49);
  }
}

/**
 * Deterministic xorshift32 pseudo-random white noise generator.
 * Guarantees bit-identical output across offline renders given the same seed.
 */
export class WhiteNoiseGenerator {
  private initialSeed: number;
  private state: number;

  constructor(seed = 0x12345678) {
    this.initialSeed = WhiteNoiseGenerator.normalizeSeed(seed);
    this.state = this.initialSeed;
  }

  private static normalizeSeed(seed: number): number {
    if (!Number.isFinite(seed)) return 0x9e3779b9;
    const u32 = seed >>> 0;
    return u32 === 0 ? 0x9e3779b9 : u32;
  }

  public setSeed(seed: number): void {
    this.initialSeed = WhiteNoiseGenerator.normalizeSeed(seed);
    this.state = this.initialSeed;
  }

  public reset(seed?: number): void {
    if (seed !== undefined) {
      this.initialSeed = WhiteNoiseGenerator.normalizeSeed(seed);
    }
    this.state = this.initialSeed;
  }

  public processSample(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = (x >>> 0) || 0x9e3779b9;
    return this.state / 2147483648 - 1;
  }
}
