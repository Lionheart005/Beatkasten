import {
  OnePoleSmoother,
  sanitizeSampleRate,
} from './smoothing';

function clampLocal(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function sanitizeLocal(x: number): number {
  return Number.isFinite(x) ? x : 0;
}

function flushLocal(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x > -1e-24 && x < 1e-24 ? 0 : x;
}

function fastTanh(x: number): number {
  if (x <= -3) return -1;
  if (x >= 3) return 1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Stereo tuned comb/body resonator with preallocated power-of-two ring buffers
 * (up to 0.1 s), linear delay interpolation, and energy normalization.
 *
 * - `targetHz`: harmonic tuning root (>= 45 Hz)
 * - `amount`: resonance feedback & wet blend in [0, 1]
 * - `character`: body timbre in [0, 1] (0 = woody/dull, 1 = metallic/ringing)
 */
export class TunedBodyResonator {
  public outL = 0;
  public outR = 0;

  private sampleRate: number;
  private bufferSize = 0;
  private bufferMask = 0;
  private bufL!: Float64Array;
  private bufR!: Float64Array;
  private writeIdx = 0;

  private targetHz = 110;
  private amount = 0;
  private character = 0.35;

  private targetDelaySamplesL = 436;
  private targetDelaySamplesR = 439;
  private readonly delaySmootherL: OnePoleSmoother;
  private readonly delaySmootherR: OnePoleSmoother;

  private feedback = 0.3;
  private normGain = 0.7;
  private wetMix = 0;
  private dampCoeff = 0.5;
  private allpassCoeff = 0;

  private lpStateL = 0;
  private lpStateR = 0;
  private apStateL = 0;
  private apStateR = 0;

  constructor(sampleRate = 48000) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.delaySmootherL = new OnePoleSmoother(this.sampleRate, 20, 436);
    this.delaySmootherR = new OnePoleSmoother(this.sampleRate, 20, 439);
    this.allocateBuffers(this.sampleRate);
    this.updateParams();
    this.delaySmootherL.reset(this.targetDelaySamplesL);
    this.delaySmootherR.reset(this.targetDelaySamplesR);
  }

  public setSampleRate(sr: number): void {
    this.sampleRate = sanitizeSampleRate(sr);
    this.delaySmootherL.setSampleRate(this.sampleRate);
    this.delaySmootherR.setSampleRate(this.sampleRate);

    const needed = Math.ceil(0.1 * this.sampleRate) + 8;
    if (needed > this.bufferSize) {
      this.allocateBuffers(this.sampleRate);
    } else {
      this.reset();
    }
    this.updateParams();
    this.delaySmootherL.reset(this.targetDelaySamplesL);
    this.delaySmootherR.reset(this.targetDelaySamplesR);
  }

  public setTargetHz(hz: number): void {
    const safeHz = clampLocal(hz, 45, Math.min(2000, this.sampleRate * 0.25));
    if (Math.abs(safeHz - this.targetHz) > 1e-4) {
      this.targetHz = safeHz;
      this.updateDelayTargets();
    }
  }

  public setAmount(amount: number): void {
    const a = clampLocal(amount, 0, 1);
    if (Math.abs(a - this.amount) > 1e-6) {
      this.amount = a;
      this.updateParams();
    }
  }

  public setCharacter(character: number): void {
    const c = clampLocal(character, 0, 1);
    if (Math.abs(c - this.character) > 1e-6) {
      this.character = c;
      this.updateParams();
    }
  }

  public setParams(targetHz: number, amount: number, character: number): void {
    const safeHz = clampLocal(targetHz, 45, Math.min(2000, this.sampleRate * 0.25));
    const a = clampLocal(amount, 0, 1);
    const c = clampLocal(character, 0, 1);
    const hzChanged = Math.abs(safeHz - this.targetHz) > 1e-4;
    const paramChanged =
      Math.abs(a - this.amount) > 1e-6 || Math.abs(c - this.character) > 1e-6;

    if (!hzChanged && !paramChanged) return;

    this.targetHz = safeHz;
    this.amount = a;
    this.character = c;
    if (paramChanged) {
      this.updateParams();
    } else {
      this.updateDelayTargets();
    }
  }

  public reset(): void {
    this.bufL.fill(0);
    this.bufR.fill(0);
    this.writeIdx = 0;
    this.lpStateL = 0;
    this.lpStateR = 0;
    this.apStateL = 0;
    this.apStateR = 0;
    this.outL = 0;
    this.outR = 0;
    this.delaySmootherL.reset(this.targetDelaySamplesL);
    this.delaySmootherR.reset(this.targetDelaySamplesR);
  }

  public processStereo(inL: number, inR: number): void {
    const safeL = sanitizeLocal(inL);
    const safeR = sanitizeLocal(inR);

    const delayL =
      this.delaySmootherL.current === this.targetDelaySamplesL
        ? this.targetDelaySamplesL
        : this.delaySmootherL.process(this.targetDelaySamplesL);
    const delayR =
      this.delaySmootherR.current === this.targetDelaySamplesR
        ? this.targetDelaySamplesR
        : this.delaySmootherR.process(this.targetDelaySamplesR);

    const mask = this.bufferMask;
    const wIdx = this.writeIdx;

    // Linearly interpolated delay reads
    const intL = Math.floor(delayL);
    const fracL = delayL - intL;
    const idxL0 = (wIdx - intL) & mask;
    const idxL1 = (idxL0 - 1) & mask;
    const tapL = this.bufL[idxL0]! + fracL * (this.bufL[idxL1]! - this.bufL[idxL0]!);

    const intR = Math.floor(delayR);
    const fracR = delayR - intR;
    const idxR0 = (wIdx - intR) & mask;
    const idxR1 = (idxR0 - 1) & mask;
    const tapR = this.bufR[idxR0]! + fracR * (this.bufR[idxR1]! - this.bufR[idxR0]!);

    // Loop damping lowpass (woody = dark, metallic = bright)
    const dampL = flushLocal(this.lpStateL + this.dampCoeff * (tapL - this.lpStateL));
    const dampR = flushLocal(this.lpStateR + this.dampCoeff * (tapR - this.lpStateR));
    this.lpStateL = dampL;
    this.lpStateR = dampR;

    // Subtle 1st-order allpass dispersion in loop for metallic character
    const apG = this.allpassCoeff;
    const apOutL = flushLocal(-apG * dampL + this.apStateL);
    this.apStateL = flushLocal(dampL + apG * apOutL);
    const apOutR = flushLocal(-apG * dampR + this.apStateR);
    this.apStateR = flushLocal(dampR + apG * apOutR);

    // Feedback clamped strictly < 0.86 with gentle tanh safety ceiling
    const fb = this.feedback;
    const nextL = fastTanh((safeL + apOutL * fb) * 0.5) * 2.0;
    const nextR = fastTanh((safeR + apOutR * fb) * 0.5) * 2.0;

    this.bufL[wIdx] = flushLocal(nextL);
    this.bufR[wIdx] = flushLocal(nextR);
    this.writeIdx = (wIdx + 1) & mask;

    if (this.amount <= 1e-5) {
      this.outL = safeL;
      this.outR = safeR;
      return;
    }

    const wetL = tapL * this.normGain;
    const wetR = tapR * this.normGain;
    const mix = this.wetMix;
    const dryGain = 1 - 0.35 * mix;

    this.outL = sanitizeLocal(safeL * dryGain + wetL * mix);
    this.outR = sanitizeLocal(safeR * dryGain + wetR * mix);
  }

  public processStereoBlock(
    outL: Float32Array,
    outR: Float32Array,
    start: number,
    end: number,
  ): void {
    const subLen = end - start;
    if (subLen <= 0) return;

    let delayL = this.targetDelaySamplesL;
    if (this.delaySmootherL.current !== delayL) {
      for (let k = 0; k < subLen; k++) {
        delayL = this.delaySmootherL.process(this.targetDelaySamplesL);
      }
      if (Math.abs(delayL - this.targetDelaySamplesL) < 1e-5) {
        delayL = this.targetDelaySamplesL;
        this.delaySmootherL.reset(delayL);
      }
    }
    let delayR = this.targetDelaySamplesR;
    if (this.delaySmootherR.current !== delayR) {
      for (let k = 0; k < subLen; k++) {
        delayR = this.delaySmootherR.process(this.targetDelaySamplesR);
      }
      if (Math.abs(delayR - this.targetDelaySamplesR) < 1e-5) {
        delayR = this.targetDelaySamplesR;
        this.delaySmootherR.reset(delayR);
      }
    }

    const bufL = this.bufL;
    const bufR = this.bufR;
    const mask = this.bufferMask;
    let wIdx = this.writeIdx;
    let lpStateL = this.lpStateL;
    let lpStateR = this.lpStateR;
    let apStateL = this.apStateL;
    let apStateR = this.apStateR;

    const dampCoeff = this.dampCoeff;
    const apG = this.allpassCoeff;
    const fb = this.feedback;
    const normGain = this.normGain;
    const mix = this.wetMix;
    const dryGain = 1 - 0.35 * mix;
    const active = this.amount > 1e-5;

    const intL = Math.floor(delayL);
    const fracL = delayL - intL;
    const intR = Math.floor(delayR);
    const fracR = delayR - intR;

    for (let i = start; i < end; i++) {
      const safeL = outL[i]!;
      const safeR = outR[i]!;

      const idxL0 = (wIdx - intL) & mask;
      const idxL1 = (idxL0 - 1) & mask;
      const bL0 = bufL[idxL0]!;
      const tapL = bL0 + fracL * (bufL[idxL1]! - bL0);

      const idxR0 = (wIdx - intR) & mask;
      const idxR1 = (idxR0 - 1) & mask;
      const bR0 = bufR[idxR0]!;
      const tapR = bR0 + fracR * (bufR[idxR1]! - bR0);

      lpStateL = lpStateL + dampCoeff * (tapL - lpStateL);
      lpStateR = lpStateR + dampCoeff * (tapR - lpStateR);

      const apOutL = -apG * lpStateL + apStateL;
      apStateL = lpStateL + apG * apOutL;

      const apOutR = -apG * lpStateR + apStateR;
      apStateR = lpStateR + apG * apOutR;

      const nextL = fastTanh((safeL + apOutL * fb) * 0.5) * 2.0;
      const nextR = fastTanh((safeR + apOutR * fb) * 0.5) * 2.0;

      bufL[wIdx] = nextL;
      bufR[wIdx] = nextR;
      wIdx = (wIdx + 1) & mask;

      if (active) {
        outL[i] = safeL * dryGain + tapL * normGain * mix;
        outR[i] = safeR * dryGain + tapR * normGain * mix;
      }
    }

    if (
      !Number.isFinite(lpStateL) ||
      !Number.isFinite(lpStateR) ||
      !Number.isFinite(apStateL) ||
      !Number.isFinite(apStateR)
    ) {
      lpStateL = 0;
      lpStateR = 0;
      apStateL = 0;
      apStateR = 0;
      for (let i = start; i < end; i++) {
        outL[i] = 0;
        outR[i] = 0;
      }
    } else {
      if (lpStateL > -1e-24 && lpStateL < 1e-24) lpStateL = 0;
      if (lpStateR > -1e-24 && lpStateR < 1e-24) lpStateR = 0;
      if (apStateL > -1e-24 && apStateL < 1e-24) apStateL = 0;
      if (apStateR > -1e-24 && apStateR < 1e-24) apStateR = 0;
    }

    this.writeIdx = wIdx;
    this.lpStateL = lpStateL;
    this.lpStateR = lpStateR;
    this.apStateL = apStateL;
    this.apStateR = apStateR;
  }

  public processSample(x: number): number {
    this.processStereo(x, x);
    return this.outL;
  }

  private allocateBuffers(sr: number): void {
    const minSamples = Math.ceil(0.1 * Math.max(sr, 96000)) + 8;
    this.bufferSize = nextPowerOfTwo(minSamples);
    this.bufferMask = this.bufferSize - 1;
    this.bufL = new Float64Array(this.bufferSize);
    this.bufR = new Float64Array(this.bufferSize);
    this.writeIdx = 0;
  }

  private updateDelayTargets(): void {
    const maxDelay = Math.min(this.bufferSize - 4, 0.1 * this.sampleRate);
    const baseDelay = clampLocal(this.sampleRate / this.targetHz - 0.5, 2, maxDelay);
    const stereoDetune = 1 + 0.004 + 0.006 * this.character;
    this.targetDelaySamplesL = baseDelay;
    this.targetDelaySamplesR = clampLocal(baseDelay * stereoDetune, 2, maxDelay);
  }

  private updateParams(): void {
    this.updateDelayTargets();

    // Feedback strictly < 0.86 (max 0.85)
    this.feedback = clampLocal(0.22 + this.amount * 0.58 + this.character * 0.05, 0, 0.85);
    // Energy normalization combining tonal peak & broadband RMS compensation
    const fb = this.feedback;
    this.normGain = clampLocal(
      (1 - fb) * 0.65 + Math.sqrt(Math.max(0, 1 - fb * fb)) * 0.35,
      0.18,
      1.0
    );
    this.wetMix = clampLocal(this.amount, 0, 1);

    const cutoffHz = clampLocal(950 + this.character * this.character * 12000, 300, this.sampleRate * 0.43);
    const omega = (2 * Math.PI * cutoffHz) / this.sampleRate;
    this.dampCoeff = clampLocal(omega / (1 + omega), 0.02, 0.99);

    this.allpassCoeff = this.character * 0.25;
  }
}
