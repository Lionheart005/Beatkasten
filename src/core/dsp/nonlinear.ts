import { sanitizeSampleRate } from './smoothing';

const TWO_PI = Math.PI * 2;
const TWO_OVER_PI = 2 / Math.PI;
const HALF_PI = Math.PI * 0.5;

function clampLocal(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function fastTanh(x: number): number {
  if (x <= -3) return -1;
  if (x >= 3) return 1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

function fastAtan(x: number): number {
  const ax = x < 0 ? -x : x;
  const u = ax > 1 ? 1 / ax : ax;
  const u2 = u * u;
  const a =
    u *
    (0.99997726 +
      u2 *
        (-0.33262347 +
          u2 * (0.19354346 + u2 * (-0.11643287 + u2 * (0.05265332 - 0.0117212 * u2)))));
  const res = ax > 1 ? HALF_PI - a : a;
  return x < 0 ? -res : res;
}

/**
 * Warm asymmetrical tube saturation morphing into rich crunch with
 * automatic loudness/gain compensation.
 */
export class SoftSaturator {
  private sampleRate: number;
  private drive = -1;
  private preGain = 1;
  private compGain = 1;
  private bias = 0;
  private tanhBias = 0;
  private crunchMix = 0;

  private dcR = 0.9976;
  private dcGain = 0.9988;
  private dcX1 = 0;
  private dcY1 = 0;

  constructor(sampleRate = 48000, drive = 0) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.updateDcCoeff();
    this.setDrive(drive);
  }

  public setSampleRate(sr: number): void {
    this.sampleRate = sanitizeSampleRate(sr);
    this.updateDcCoeff();
  }

  public setDrive(drive: number): void {
    const d = clampLocal(drive, 0, 1);
    if (Math.abs(d - this.drive) < 1e-6) return;
    this.drive = d;
    this.updateCoeffs();
  }

  public reset(): void {
    this.dcX1 = 0;
    this.dcY1 = 0;
  }

  public processSample(x: number): number {
    const safeX = Number.isFinite(x) ? x : 0;
    const d = this.drive;
    if (d <= 1e-5) {
      const y = this.dcGain * (safeX - this.dcX1) + this.dcR * this.dcY1;
      const cleanY = Number.isFinite(y) ? (y > -1e-24 && y < 1e-24 ? 0 : y) : 0;
      this.dcX1 = safeX;
      this.dcY1 = cleanY;
      return cleanY;
    }

    const driven = safeX * this.preGain;
    // Asymmetrical tube stage (even harmonics)
    const tube = fastTanh(driven + this.bias) - this.tanhBias;
    // Harder crunch stage (odd-heavy soft clip)
    let shaped = tube;
    if (this.crunchMix > 0) {
      const crunch = TWO_OVER_PI * fastAtan(driven * 1.45);
      shaped = tube + this.crunchMix * (crunch - tube);
    }

    // Smooth bypass crossfade for ultra-low drive (0..0.06)
    const wet = d < 0.06 ? d / 0.06 : 1;
    const out = safeX + wet * (shaped * this.compGain - safeX);
    const y = this.dcGain * (out - this.dcX1) + this.dcR * this.dcY1;
    const cleanY = Number.isFinite(y) ? (y > -1e-24 && y < 1e-24 ? 0 : y) : 0;
    this.dcX1 = out;
    this.dcY1 = cleanY;
    return cleanY;
  }

  public processBlock(buf: Float32Array, start: number, end: number): void {
    const d = this.drive;
    const dcR = this.dcR;
    const dcGain = this.dcGain;
    let dcX1 = this.dcX1;
    let dcY1 = this.dcY1;

    if (d <= 1e-5) {
      for (let i = start; i < end; i++) {
        const raw = buf[i]!;
        const safeX = raw * 0 === 0 ? raw : 0;
        const y = dcGain * (safeX - dcX1) + dcR * dcY1;
        dcX1 = safeX;
        dcY1 = y;
        buf[i] = y;
      }
      if (!Number.isFinite(dcY1)) {
        dcX1 = 0;
        dcY1 = 0;
        for (let i = start; i < end; i++) buf[i] = 0;
      } else if (dcY1 > -1e-24 && dcY1 < 1e-24) {
        dcY1 = 0;
      }
      this.dcX1 = dcX1;
      this.dcY1 = dcY1;
      return;
    }

    const preGain = this.preGain;
    const bias = this.bias;
    const tanhBias = this.tanhBias;
    const crunchMix = this.crunchMix;
    const compGain = this.compGain;
    const wet = d < 0.06 ? d / 0.06 : 1;

    if (crunchMix <= 0) {
      for (let i = start; i < end; i++) {
        const safeX = buf[i]!;
        const shaped = fastTanh(safeX * preGain + bias) - tanhBias;
        const out = safeX + wet * (shaped * compGain - safeX);
        const y = dcGain * (out - dcX1) + dcR * dcY1;
        dcX1 = out;
        dcY1 = y;
        buf[i] = y;
      }
    } else {
      for (let i = start; i < end; i++) {
        const safeX = buf[i]!;
        const driven = safeX * preGain;
        const tube = fastTanh(driven + bias) - tanhBias;
        const crunch = TWO_OVER_PI * fastAtan(driven * 1.45);
        const shaped = tube + crunchMix * (crunch - tube);
        const out = safeX + wet * (shaped * compGain - safeX);
        const y = dcGain * (out - dcX1) + dcR * dcY1;
        dcX1 = out;
        dcY1 = y;
        buf[i] = y;
      }
    }

    if (!Number.isFinite(dcY1)) {
      dcX1 = 0;
      dcY1 = 0;
      for (let i = start; i < end; i++) buf[i] = 0;
    } else if (dcY1 > -1e-24 && dcY1 < 1e-24) {
      dcY1 = 0;
    }

    this.dcX1 = dcX1;
    this.dcY1 = dcY1;
  }

  private updateDcCoeff(): void {
    const maxFc = this.sampleRate * 0.1;
    const fc = Math.min(16, maxFc);
    this.dcR = clampLocal(Math.exp((-TWO_PI * fc) / this.sampleRate), 0.5, 0.99995);
    this.dcGain = 0.5 * (1 + this.dcR);
  }

  private updateCoeffs(): void {
    const d = this.drive;
    this.preGain = 1 + d * 6.5 + d * d * 2.5;
    this.bias = 0.14 * (1 - 0.55 * d);
    this.tanhBias = Math.tanh(this.bias);
    this.crunchMix = clampLocal((d - 0.35) / 0.65, 0, 1);

    // Calibrate gain compensation at nominal 0.42 RMS program level
    const refLevel = 0.42;
    const refClean = Math.tanh(refLevel);
    const refDriven = refLevel * this.preGain;
    const refTube = Math.tanh(refDriven + this.bias) - this.tanhBias;
    const refCrunch = TWO_OVER_PI * Math.atan(refDriven * 1.45);
    const refOut = Math.max(1e-4, refTube + this.crunchMix * (refCrunch - refTube));
    this.compGain = clampLocal(refClean / refOut, 0.12, 1.0);
  }
}

/**
 * Smooth trigonometric wavefolder (`sin`) with downstream 1-pole HF damping
 * and automatic loudness compensation.
 */
export class Wavefolder {
  private sampleRate: number;
  private amount = -1;
  private foldGain = 1;
  private compGain = 1;
  private wetMix = 0;
  private dampCoeff = 0.5;
  private lpState = 0;

  constructor(sampleRate = 48000, amount = 0) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.setAmount(amount);
  }

  public setSampleRate(sr: number): void {
    this.sampleRate = sanitizeSampleRate(sr);
    this.updateDamping();
  }

  public setAmount(amount: number): void {
    const a = clampLocal(amount, 0, 1);
    if (Math.abs(a - this.amount) < 1e-6) return;
    this.amount = a;
    this.foldGain = 1 + a * 4.5;
    this.wetMix = a < 0.15 ? a / 0.15 : 1;
    this.compGain = 1 / (1 + 0.52 * a);
    this.updateDamping();
  }

  public reset(): void {
    this.lpState = 0;
  }

  public processSample(x: number): number {
    const safeX = Number.isFinite(x) ? x : 0;
    if (this.amount <= 1e-5) {
      const nl = this.lpState + this.dampCoeff * (safeX - this.lpState);
      this.lpState = Number.isFinite(nl) ? (nl > -1e-24 && nl < 1e-24 ? 0 : nl) : 0;
      return safeX;
    }

    const folded = Math.sin(safeX * this.foldGain * HALF_PI) * this.compGain;
    const nl = this.lpState + this.dampCoeff * (folded - this.lpState);
    const damped = Number.isFinite(nl) ? (nl > -1e-24 && nl < 1e-24 ? 0 : nl) : 0;
    this.lpState = damped;

    return safeX + this.wetMix * (damped - safeX);
  }

  public processBlock(buf: Float32Array, start: number, end: number): void {
    const dampCoeff = this.dampCoeff;
    let lpState = this.lpState;

    if (this.amount <= 1e-5) {
      for (let i = start; i < end; i++) {
        const safeX = buf[i]!;
        lpState = lpState + dampCoeff * (safeX - lpState);
      }
      if (!Number.isFinite(lpState)) {
        lpState = 0;
      } else if (lpState > -1e-24 && lpState < 1e-24) {
        lpState = 0;
      }
      this.lpState = lpState;
      return;
    }

    const foldScale = this.foldGain * HALF_PI;
    const compGain = this.compGain;
    const wetMix = this.wetMix;

    for (let i = start; i < end; i++) {
      const safeX = buf[i]!;
      const folded = Math.sin(safeX * foldScale) * compGain;
      lpState = lpState + dampCoeff * (folded - lpState);
      buf[i] = safeX + wetMix * (lpState - safeX);
    }
    if (!Number.isFinite(lpState)) {
      lpState = 0;
      for (let i = start; i < end; i++) buf[i] = 0;
    } else if (lpState > -1e-24 && lpState < 1e-24) {
      lpState = 0;
    }
    this.lpState = lpState;
  }

  private updateDamping(): void {
    const cutoffHz = clampLocal(11000 - this.amount * 4500, 1200, this.sampleRate * 0.43);
    const omega = (TWO_PI * cutoffHz) / this.sampleRate;
    this.dampCoeff = clampLocal(omega / (1 + omega), 0.05, 0.99);
  }
}

/**
 * Gently blended sample-and-hold / bit-grit processor ("Sand / Dust") with a
 * 2-stage anti-harshness lowpass to suppress shrill imaging.
 */
export class SandReducer {
  private sampleRate: number;
  private amount = -1;
  private rateRatio = 1;
  private quantSteps = 128;
  private wetMix = 0;
  private lpfCoeff = 0.7;

  private holdPhase = 0;
  private heldSample = 0;
  private lp1 = 0;
  private lp2 = 0;

  constructor(sampleRate = 48000, amount = 0) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.setAmount(amount);
  }

  public setSampleRate(sr: number): void {
    this.sampleRate = sanitizeSampleRate(sr);
    this.updateCoeffs();
  }

  public setAmount(amount: number): void {
    const a = clampLocal(amount, 0, 1);
    if (Math.abs(a - this.amount) < 1e-6) return;
    this.amount = a;
    this.updateCoeffs();
  }

  public reset(): void {
    this.holdPhase = 0;
    this.heldSample = 0;
    this.lp1 = 0;
    this.lp2 = 0;
  }

  public processSample(x: number): number {
    const safeX = Number.isFinite(x) ? x : 0;
    if (this.amount <= 1e-5) {
      this.heldSample = safeX;
      const n1 = this.lp1 + this.lpfCoeff * (safeX - this.lp1);
      this.lp1 = Number.isFinite(n1) ? (n1 > -1e-24 && n1 < 1e-24 ? 0 : n1) : 0;
      const n2 = this.lp2 + this.lpfCoeff * (this.lp1 - this.lp2);
      this.lp2 = Number.isFinite(n2) ? (n2 > -1e-24 && n2 < 1e-24 ? 0 : n2) : 0;
      return safeX;
    }

    this.holdPhase += this.rateRatio;
    if (this.holdPhase >= 1) {
      this.holdPhase -= Math.floor(this.holdPhase);
      this.heldSample = safeX;
    }

    const quantized = Math.round(this.heldSample * this.quantSteps) / this.quantSteps;

    // 2-pole anti-harshness lowpass on the crushed signal
    const n1 = this.lp1 + this.lpfCoeff * (quantized - this.lp1);
    this.lp1 = Number.isFinite(n1) ? (n1 > -1e-24 && n1 < 1e-24 ? 0 : n1) : 0;
    const n2 = this.lp2 + this.lpfCoeff * (this.lp1 - this.lp2);
    this.lp2 = Number.isFinite(n2) ? (n2 > -1e-24 && n2 < 1e-24 ? 0 : n2) : 0;

    return safeX + this.wetMix * (this.lp2 - safeX);
  }

  public processBlock(buf: Float32Array, start: number, end: number): void {
    const lpfCoeff = this.lpfCoeff;
    let lp1 = this.lp1;
    let lp2 = this.lp2;

    if (this.amount <= 1e-5) {
      let held = this.heldSample;
      for (let i = start; i < end; i++) {
        const safeX = buf[i]!;
        held = safeX;
        lp1 = lp1 + lpfCoeff * (safeX - lp1);
        lp2 = lp2 + lpfCoeff * (lp1 - lp2);
      }
      if (!Number.isFinite(lp1) || !Number.isFinite(lp2)) {
        lp1 = 0;
        lp2 = 0;
        held = 0;
      } else {
        if (lp1 > -1e-24 && lp1 < 1e-24) lp1 = 0;
        if (lp2 > -1e-24 && lp2 < 1e-24) lp2 = 0;
      }
      this.heldSample = held;
      this.lp1 = lp1;
      this.lp2 = lp2;
      return;
    }

    const rateRatio = this.rateRatio;
    const quantSteps = this.quantSteps;
    const invQuantSteps = 1 / quantSteps;
    const wetMix = this.wetMix;
    let holdPhase = this.holdPhase;
    let heldSample = this.heldSample;

    for (let i = start; i < end; i++) {
      const safeX = buf[i]!;
      holdPhase += rateRatio;
      if (holdPhase >= 1) {
        holdPhase -= Math.floor(holdPhase);
        heldSample = safeX;
      }

      const quantized = Math.round(heldSample * quantSteps) * invQuantSteps;
      lp1 = lp1 + lpfCoeff * (quantized - lp1);
      lp2 = lp2 + lpfCoeff * (lp1 - lp2);
      buf[i] = safeX + wetMix * (lp2 - safeX);
    }

    if (!Number.isFinite(lp1) || !Number.isFinite(lp2)) {
      lp1 = 0;
      lp2 = 0;
      heldSample = 0;
      for (let i = start; i < end; i++) buf[i] = 0;
    } else {
      if (lp1 > -1e-24 && lp1 < 1e-24) lp1 = 0;
      if (lp2 > -1e-24 && lp2 < 1e-24) lp2 = 0;
    }

    this.holdPhase = holdPhase;
    this.heldSample = heldSample;
    this.lp1 = lp1;
    this.lp2 = lp2;
  }

  private updateCoeffs(): void {
    const a = this.amount;
    const srScale = this.sampleRate / 48000;
    const holdSamples = Math.max(1, (1 + a * a * 16) * srScale);
    this.rateRatio = clampLocal(1 / holdSamples, 0.01, 1);
    this.quantSteps = 8 + (1 - a) * (1 - a) * 120;
    this.wetMix = a < 0.25 ? a * 2.2 : clampLocal(0.55 + (a - 0.25) * 0.6, 0, 1);

    const cutoffHz = clampLocal(12000 - a * 7600, 1000, this.sampleRate * 0.42);
    const omega = (TWO_PI * cutoffHz) / this.sampleRate;
    this.lpfCoeff = clampLocal(omega / (1 + omega), 0.05, 0.99);
  }
}
