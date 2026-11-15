const DENORMAL_THRESHOLD = 1e-24;
const TWO_PI = Math.PI * 2;

/**
 * Clamps a numeric value to the inclusive range [min, max].
 * Non-finite inputs fall back to `min`.
 */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Replaces NaN or +/-Infinity with 0.
 */
export function sanitizeSample(x: number): number {
  return Number.isFinite(x) ? x : 0;
}

/**
 * Flushes non-finite values and sub-normal magnitudes (< 1e-24) to zero.
 */
export function flushDenormal(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.abs(x) < DENORMAL_THRESHOLD ? 0 : x;
}

/**
 * Clamps a sample rate into a safe operating range [8000, 384000] Hz.
 */
export function sanitizeSampleRate(sampleRate: number): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return 48000;
  return clamp(sampleRate, 8000, 384000);
}

/**
 * Exponential 1-pole parameter smoother for click-free control changes.
 */
export class OnePoleSmoother {
  private sampleRate: number;
  private timeMs: number;
  private coeff = 1;
  private state: number;

  constructor(sampleRate = 48000, timeMs = 15, initialValue = 0) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.timeMs = clamp(timeMs, 0, 10000);
    this.state = sanitizeSample(initialValue);
    this.updateCoeff();
  }

  public setSampleRate(sr: number): void {
    this.sampleRate = sanitizeSampleRate(sr);
    this.updateCoeff();
  }

  public setTimeMs(ms: number): void {
    this.timeMs = clamp(ms, 0, 10000);
    this.updateCoeff();
  }

  public reset(initialValue = 0): void {
    this.state = sanitizeSample(initialValue);
  }

  public get current(): number {
    return this.state;
  }

  public process(target: number): number {
    const safeTarget = sanitizeSample(target);
    if (this.coeff >= 1) {
      this.state = safeTarget;
      return this.state;
    }
    const diff = safeTarget - this.state;
    if (Math.abs(diff) < 1e-15) {
      this.state = safeTarget;
      return this.state;
    }
    this.state = flushDenormal(this.state + this.coeff * diff);
    return this.state;
  }

  private updateCoeff(): void {
    if (this.timeMs <= 0.001) {
      this.coeff = 1;
      return;
    }
    const tauSamples = (this.timeMs * 0.001) * this.sampleRate;
    this.coeff = clamp(1 - Math.exp(-1 / Math.max(1e-6, tauSamples)), 0, 1);
  }
}

/**
 * Mono 1-pole DC blocking high-pass filter (~18 Hz default) with unity passband gain.
 */
export class DCBlocker {
  private sampleRate: number;
  private cutoffHz: number;
  private r = 0.9976;
  private gain = 0.9988;
  private x1 = 0;
  private y1 = 0;

  constructor(sampleRate = 48000, cutoffHz = 18) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.cutoffHz = clamp(cutoffHz, 1, 200);
    this.updateCoeff();
  }

  public setSampleRate(sr: number): void {
    this.sampleRate = sanitizeSampleRate(sr);
    this.updateCoeff();
  }

  public setCutoffHz(hz: number): void {
    this.cutoffHz = clamp(hz, 1, 200);
    this.updateCoeff();
  }

  public reset(): void {
    this.x1 = 0;
    this.y1 = 0;
  }

  public processSample(x: number): number {
    const safeX = sanitizeSample(x);
    const y = flushDenormal(this.gain * (safeX - this.x1) + this.r * this.y1);
    this.x1 = safeX;
    this.y1 = y;
    return y;
  }

  private updateCoeff(): void {
    const maxFc = this.sampleRate * 0.1;
    const fc = Math.min(this.cutoffHz, maxFc);
    this.r = clamp(Math.exp((-TWO_PI * fc) / this.sampleRate), 0.5, 0.99995);
    this.gain = 0.5 * (1 + this.r);
  }
}

/**
 * Zero-allocation stereo wrapper around two DCBlocker channels.
 */
export class StereoDCBlocker {
  public outL = 0;
  public outR = 0;

  private readonly left: DCBlocker;
  private readonly right: DCBlocker;

  constructor(sampleRate = 48000, cutoffHz = 18) {
    this.left = new DCBlocker(sampleRate, cutoffHz);
    this.right = new DCBlocker(sampleRate, cutoffHz);
  }

  public setSampleRate(sr: number): void {
    this.left.setSampleRate(sr);
    this.right.setSampleRate(sr);
  }

  public setCutoffHz(hz: number): void {
    this.left.setCutoffHz(hz);
    this.right.setCutoffHz(hz);
  }

  public reset(): void {
    this.left.reset();
    this.right.reset();
    this.outL = 0;
    this.outR = 0;
  }

  public process(inL: number, inR: number): void {
    this.outL = this.left.processSample(inL);
    this.outR = this.right.processSample(inR);
  }

  public processBlock(
    bufL: Float32Array | Float64Array,
    bufR: Float32Array | Float64Array,
    numSamples: number
  ): void {
    const count = Math.min(numSamples | 0, bufL.length, bufR.length);
    for (let i = 0; i < count; i++) {
      bufL[i] = this.left.processSample(bufL[i]);
      bufR[i] = this.right.processSample(bufR[i]);
    }
  }
}
