import { ZdfSvfFilter } from './filters';
import {
  OnePoleSmoother,
  sanitizeSampleRate,
} from './smoothing';

export type DelayDivision = '1/8' | '3/16' | '1/4' | '1/3';

const BUTTERWORTH_Q = Math.SQRT1_2;

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

/**
 * Linkwitz-Riley / Butterworth 110 Hz sub-bass mono crossover.
 * Enforces strict mono below ~110 Hz via a 6th-order Butterworth high-pass
 * (36 dB/oct) on the Side channel while keeping the Mid sum flat.
 */
export class LR4SubMonoCrossover {
  public subMono = 0;
  public highL = 0;
  public highR = 0;
  public outL = 0;
  public outR = 0;

  private sampleRate: number;
  private cutoffHz: number;

  // Shared Mid coefficients (cutoffHz, Q = BUTTERWORTH_Q)
  private midK = 1 / BUTTERWORTH_Q;
  private midA1 = 0;
  private midA2 = 0;
  private midA3 = 0;

  // Side 6th-order Butterworth coefficients
  private s1K = 1 / 0.51763809;
  private s1A1 = 0;
  private s1A2 = 0;
  private s1A3 = 0;

  private s2K = 1 / BUTTERWORTH_Q;
  private s2A1 = 0;
  private s2A2 = 0;
  private s2A3 = 0;

  private s3K = 1 / 1.93185165;
  private s3A1 = 0;
  private s3A2 = 0;
  private s3A3 = 0;

  // Filter states for the 7 inline SVF stages
  private lpM1Ic1 = 0;
  private lpM1Ic2 = 0;
  private lpM2Ic1 = 0;
  private lpM2Ic2 = 0;
  private hpM1Ic1 = 0;
  private hpM1Ic2 = 0;
  private hpM2Ic1 = 0;
  private hpM2Ic2 = 0;
  private hpS1Ic1 = 0;
  private hpS1Ic2 = 0;
  private hpS2Ic1 = 0;
  private hpS2Ic2 = 0;
  private hpS3Ic1 = 0;
  private hpS3Ic2 = 0;

  constructor(sampleRate = 48000, cutoffHz = 110) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.cutoffHz = clampLocal(cutoffHz, 30, 300);
    this.updateCoeffs();
  }

  public setSampleRate(sr: number): void {
    this.sampleRate = sanitizeSampleRate(sr);
    this.updateCoeffs();
  }

  public reset(): void {
    this.lpM1Ic1 = 0;
    this.lpM1Ic2 = 0;
    this.lpM2Ic1 = 0;
    this.lpM2Ic2 = 0;
    this.hpM1Ic1 = 0;
    this.hpM1Ic2 = 0;
    this.hpM2Ic1 = 0;
    this.hpM2Ic2 = 0;
    this.hpS1Ic1 = 0;
    this.hpS1Ic2 = 0;
    this.hpS2Ic1 = 0;
    this.hpS2Ic2 = 0;
    this.hpS3Ic1 = 0;
    this.hpS3Ic2 = 0;
    this.subMono = 0;
    this.highL = 0;
    this.highR = 0;
    this.outL = 0;
    this.outR = 0;
  }

  public process(inL: number, inR: number): void {
    const safeL = Number.isFinite(inL) ? inL : 0;
    const safeR = Number.isFinite(inR) ? inR : 0;

    const mid = 0.5 * (safeL + safeR);
    const side = 0.5 * (safeL - safeR);

    const mK = this.midK;
    const mA1 = this.midA1;
    const mA2 = this.midA2;
    const mA3 = this.midA3;

    // lpMid1 (LP = v2)
    let ic1 = this.lpM1Ic1;
    let ic2 = this.lpM1Ic2;
    let v3 = mid - ic2;
    let v1 = mA1 * ic1 + mA2 * v3;
    let v2 = ic2 + mA2 * ic1 + mA3 * v3;
    let n1 = 2 * v1 - ic1;
    let n2 = 2 * v2 - ic2;
    this.lpM1Ic1 = Number.isFinite(n1) ? (n1 > -1e-24 && n1 < 1e-24 ? 0 : n1) : 0;
    this.lpM1Ic2 = Number.isFinite(n2) ? (n2 > -1e-24 && n2 < 1e-24 ? 0 : n2) : 0;

    // lpMid2 (LP = v2)
    ic1 = this.lpM2Ic1;
    ic2 = this.lpM2Ic2;
    v3 = v2 - ic2;
    v1 = mA1 * ic1 + mA2 * v3;
    v2 = ic2 + mA2 * ic1 + mA3 * v3;
    n1 = 2 * v1 - ic1;
    n2 = 2 * v2 - ic2;
    this.lpM2Ic1 = Number.isFinite(n1) ? (n1 > -1e-24 && n1 < 1e-24 ? 0 : n1) : 0;
    this.lpM2Ic2 = Number.isFinite(n2) ? (n2 > -1e-24 && n2 < 1e-24 ? 0 : n2) : 0;
    const subMono = v2;

    // hpMid1 (HP = v0 - k * v1 - v2)
    ic1 = this.hpM1Ic1;
    ic2 = this.hpM1Ic2;
    v3 = mid - ic2;
    v1 = mA1 * ic1 + mA2 * v3;
    v2 = ic2 + mA2 * ic1 + mA3 * v3;
    n1 = 2 * v1 - ic1;
    n2 = 2 * v2 - ic2;
    this.hpM1Ic1 = Number.isFinite(n1) ? (n1 > -1e-24 && n1 < 1e-24 ? 0 : n1) : 0;
    this.hpM1Ic2 = Number.isFinite(n2) ? (n2 > -1e-24 && n2 < 1e-24 ? 0 : n2) : 0;
    let highMid = mid - mK * v1 - v2;

    // hpMid2
    ic1 = this.hpM2Ic1;
    ic2 = this.hpM2Ic2;
    v3 = highMid - ic2;
    v1 = mA1 * ic1 + mA2 * v3;
    v2 = ic2 + mA2 * ic1 + mA3 * v3;
    n1 = 2 * v1 - ic1;
    n2 = 2 * v2 - ic2;
    this.hpM2Ic1 = Number.isFinite(n1) ? (n1 > -1e-24 && n1 < 1e-24 ? 0 : n1) : 0;
    this.hpM2Ic2 = Number.isFinite(n2) ? (n2 > -1e-24 && n2 < 1e-24 ? 0 : n2) : 0;
    highMid = highMid - mK * v1 - v2;

    // hpSide1
    ic1 = this.hpS1Ic1;
    ic2 = this.hpS1Ic2;
    v3 = side - ic2;
    v1 = this.s1A1 * ic1 + this.s1A2 * v3;
    v2 = ic2 + this.s1A2 * ic1 + this.s1A3 * v3;
    n1 = 2 * v1 - ic1;
    n2 = 2 * v2 - ic2;
    this.hpS1Ic1 = Number.isFinite(n1) ? (n1 > -1e-24 && n1 < 1e-24 ? 0 : n1) : 0;
    this.hpS1Ic2 = Number.isFinite(n2) ? (n2 > -1e-24 && n2 < 1e-24 ? 0 : n2) : 0;
    let cleanSide = side - this.s1K * v1 - v2;

    // hpSide2
    ic1 = this.hpS2Ic1;
    ic2 = this.hpS2Ic2;
    v3 = cleanSide - ic2;
    v1 = this.s2A1 * ic1 + this.s2A2 * v3;
    v2 = ic2 + this.s2A2 * ic1 + this.s2A3 * v3;
    n1 = 2 * v1 - ic1;
    n2 = 2 * v2 - ic2;
    this.hpS2Ic1 = Number.isFinite(n1) ? (n1 > -1e-24 && n1 < 1e-24 ? 0 : n1) : 0;
    this.hpS2Ic2 = Number.isFinite(n2) ? (n2 > -1e-24 && n2 < 1e-24 ? 0 : n2) : 0;
    cleanSide = cleanSide - this.s2K * v1 - v2;

    // hpSide3
    ic1 = this.hpS3Ic1;
    ic2 = this.hpS3Ic2;
    v3 = cleanSide - ic2;
    v1 = this.s3A1 * ic1 + this.s3A2 * v3;
    v2 = ic2 + this.s3A2 * ic1 + this.s3A3 * v3;
    n1 = 2 * v1 - ic1;
    n2 = 2 * v2 - ic2;
    this.hpS3Ic1 = Number.isFinite(n1) ? (n1 > -1e-24 && n1 < 1e-24 ? 0 : n1) : 0;
    this.hpS3Ic2 = Number.isFinite(n2) ? (n2 > -1e-24 && n2 < 1e-24 ? 0 : n2) : 0;
    cleanSide = cleanSide - this.s3K * v1 - v2;

    this.subMono = subMono;
    this.highL = highMid + cleanSide;
    this.highR = highMid - cleanSide;
    this.outL = mid + cleanSide;
    this.outR = mid - cleanSide;
  }

  public processStereoOrbitBlock(
    bufL: Float32Array,
    bufR: Float32Array,
    start: number,
    end: number,
    width: number,
    spreadMix: number,
    apL1: FirstOrderAllpass,
    apL2: FirstOrderAllpass,
    apR1: FirstOrderAllpass,
    apR2: FirstOrderAllpass,
  ): void {
    const mK = this.midK;
    const mA1 = this.midA1;
    const mA2 = this.midA2;
    const mA3 = this.midA3;
    const s1K = this.s1K;
    const s1A1 = this.s1A1;
    const s1A2 = this.s1A2;
    const s1A3 = this.s1A3;
    const s2K = this.s2K;
    const s2A1 = this.s2A1;
    const s2A2 = this.s2A2;
    const s2A3 = this.s2A3;
    const s3K = this.s3K;
    const s3A1 = this.s3A1;
    const s3A2 = this.s3A2;
    const s3A3 = this.s3A3;

    let lpM1Ic1 = this.lpM1Ic1;
    let lpM1Ic2 = this.lpM1Ic2;
    let lpM2Ic1 = this.lpM2Ic1;
    let lpM2Ic2 = this.lpM2Ic2;
    let hpM1Ic1 = this.hpM1Ic1;
    let hpM1Ic2 = this.hpM1Ic2;
    let hpM2Ic1 = this.hpM2Ic1;
    let hpM2Ic2 = this.hpM2Ic2;
    let hpS1Ic1 = this.hpS1Ic1;
    let hpS1Ic2 = this.hpS1Ic2;
    let hpS2Ic1 = this.hpS2Ic1;
    let hpS2Ic2 = this.hpS2Ic2;
    let hpS3Ic1 = this.hpS3Ic1;
    let hpS3Ic2 = this.hpS3Ic2;

    const cL1 = apL1.coeff;
    const cL2 = apL2.coeff;
    const cR1 = apR1.coeff;
    const cR2 = apR2.coeff;
    let sL1 = apL1.state;
    let sL2 = apL2.state;
    let sR1 = apR1.state;
    let sR2 = apR2.state;

    for (let i = start; i < end; i++) {
      const safeL = bufL[i]!;
      const safeR = bufR[i]!;

      const mid = 0.5 * (safeL + safeR);
      const side = 0.5 * (safeL - safeR);

      // lpMid1
      let v3 = mid - lpM1Ic2;
      let v1 = mA1 * lpM1Ic1 + mA2 * v3;
      let v2 = lpM1Ic2 + mA2 * lpM1Ic1 + mA3 * v3;
      lpM1Ic1 = 2 * v1 - lpM1Ic1;
      lpM1Ic2 = 2 * v2 - lpM1Ic2;

      // lpMid2
      v3 = v2 - lpM2Ic2;
      v1 = mA1 * lpM2Ic1 + mA2 * v3;
      v2 = lpM2Ic2 + mA2 * lpM2Ic1 + mA3 * v3;
      lpM2Ic1 = 2 * v1 - lpM2Ic1;
      lpM2Ic2 = 2 * v2 - lpM2Ic2;
      const subMono = v2;

      // hpMid1
      v3 = mid - hpM1Ic2;
      v1 = mA1 * hpM1Ic1 + mA2 * v3;
      v2 = hpM1Ic2 + mA2 * hpM1Ic1 + mA3 * v3;
      hpM1Ic1 = 2 * v1 - hpM1Ic1;
      hpM1Ic2 = 2 * v2 - hpM1Ic2;
      let highMid = mid - mK * v1 - v2;

      // hpMid2
      v3 = highMid - hpM2Ic2;
      v1 = mA1 * hpM2Ic1 + mA2 * v3;
      v2 = hpM2Ic2 + mA2 * hpM2Ic1 + mA3 * v3;
      hpM2Ic1 = 2 * v1 - hpM2Ic1;
      hpM2Ic2 = 2 * v2 - hpM2Ic2;
      highMid = highMid - mK * v1 - v2;

      // hpSide1
      v3 = side - hpS1Ic2;
      v1 = s1A1 * hpS1Ic1 + s1A2 * v3;
      v2 = hpS1Ic2 + s1A2 * hpS1Ic1 + s1A3 * v3;
      hpS1Ic1 = 2 * v1 - hpS1Ic1;
      hpS1Ic2 = 2 * v2 - hpS1Ic2;
      let cleanSide = side - s1K * v1 - v2;

      // hpSide2
      v3 = cleanSide - hpS2Ic2;
      v1 = s2A1 * hpS2Ic1 + s2A2 * v3;
      v2 = hpS2Ic2 + s2A2 * hpS2Ic1 + s2A3 * v3;
      hpS2Ic1 = 2 * v1 - hpS2Ic1;
      hpS2Ic2 = 2 * v2 - hpS2Ic2;
      cleanSide = cleanSide - s2K * v1 - v2;

      // hpSide3
      v3 = cleanSide - hpS3Ic2;
      v1 = s3A1 * hpS3Ic1 + s3A2 * v3;
      v2 = hpS3Ic2 + s3A2 * hpS3Ic1 + s3A3 * v3;
      hpS3Ic1 = 2 * v1 - hpS3Ic1;
      hpS3Ic2 = 2 * v2 - hpS3Ic2;
      cleanSide = cleanSide - s3K * v1 - v2;

      const hiL = highMid + cleanSide;
      const hiR = highMid - cleanSide;

      const dL1 = cL1 * hiL + sL1;
      sL1 = hiL - cL1 * dL1;

      const dL2 = cL2 * dL1 + sL2;
      sL2 = dL1 - cL2 * dL2;

      const dR1 = cR1 * hiR + sR1;
      sR1 = hiR - cR1 * dR1;

      const dR2 = cR2 * dR1 + sR2;
      sR2 = dR1 - cR2 * dR2;

      const spL = hiL + spreadMix * (dL2 - hiL);
      const spR = hiR + spreadMix * (dR2 - hiR);

      const outMid = 0.5 * (spL + spR);
      const outSide = 0.5 * (spL - spR);

      bufL[i] = subMono + outMid + width * outSide;
      bufR[i] = subMono + outMid - width * outSide;
    }

    if (
      !Number.isFinite(lpM1Ic2) ||
      !Number.isFinite(hpM2Ic2) ||
      !Number.isFinite(hpS3Ic2) ||
      !Number.isFinite(sL2) ||
      !Number.isFinite(sR2)
    ) {
      lpM1Ic1 = 0; lpM1Ic2 = 0; lpM2Ic1 = 0; lpM2Ic2 = 0;
      hpM1Ic1 = 0; hpM1Ic2 = 0; hpM2Ic1 = 0; hpM2Ic2 = 0;
      hpS1Ic1 = 0; hpS1Ic2 = 0; hpS2Ic1 = 0; hpS2Ic2 = 0;
      hpS3Ic1 = 0; hpS3Ic2 = 0;
      sL1 = 0; sL2 = 0; sR1 = 0; sR2 = 0;
      for (let i = start; i < end; i++) { bufL[i] = 0; bufR[i] = 0; }
    } else {
      if (lpM1Ic1 > -1e-24 && lpM1Ic1 < 1e-24) lpM1Ic1 = 0;
      if (lpM1Ic2 > -1e-24 && lpM1Ic2 < 1e-24) lpM1Ic2 = 0;
      if (lpM2Ic1 > -1e-24 && lpM2Ic1 < 1e-24) lpM2Ic1 = 0;
      if (lpM2Ic2 > -1e-24 && lpM2Ic2 < 1e-24) lpM2Ic2 = 0;
      if (hpM1Ic1 > -1e-24 && hpM1Ic1 < 1e-24) hpM1Ic1 = 0;
      if (hpM1Ic2 > -1e-24 && hpM1Ic2 < 1e-24) hpM1Ic2 = 0;
      if (hpM2Ic1 > -1e-24 && hpM2Ic1 < 1e-24) hpM2Ic1 = 0;
      if (hpM2Ic2 > -1e-24 && hpM2Ic2 < 1e-24) hpM2Ic2 = 0;
      if (hpS1Ic1 > -1e-24 && hpS1Ic1 < 1e-24) hpS1Ic1 = 0;
      if (hpS1Ic2 > -1e-24 && hpS1Ic2 < 1e-24) hpS1Ic2 = 0;
      if (hpS2Ic1 > -1e-24 && hpS2Ic1 < 1e-24) hpS2Ic1 = 0;
      if (hpS2Ic2 > -1e-24 && hpS2Ic2 < 1e-24) hpS2Ic2 = 0;
      if (hpS3Ic1 > -1e-24 && hpS3Ic1 < 1e-24) hpS3Ic1 = 0;
      if (hpS3Ic2 > -1e-24 && hpS3Ic2 < 1e-24) hpS3Ic2 = 0;
      if (sL1 > -1e-24 && sL1 < 1e-24) sL1 = 0;
      if (sL2 > -1e-24 && sL2 < 1e-24) sL2 = 0;
      if (sR1 > -1e-24 && sR1 < 1e-24) sR1 = 0;
      if (sR2 > -1e-24 && sR2 < 1e-24) sR2 = 0;
    }

    this.lpM1Ic1 = lpM1Ic1;
    this.lpM1Ic2 = lpM1Ic2;
    this.lpM2Ic1 = lpM2Ic1;
    this.lpM2Ic2 = lpM2Ic2;
    this.hpM1Ic1 = hpM1Ic1;
    this.hpM1Ic2 = hpM1Ic2;
    this.hpM2Ic1 = hpM2Ic1;
    this.hpM2Ic2 = hpM2Ic2;
    this.hpS1Ic1 = hpS1Ic1;
    this.hpS1Ic2 = hpS1Ic2;
    this.hpS2Ic1 = hpS2Ic1;
    this.hpS2Ic2 = hpS2Ic2;
    this.hpS3Ic1 = hpS3Ic1;
    this.hpS3Ic2 = hpS3Ic2;
    apL1.state = sL1;
    apL2.state = sL2;
    apR1.state = sR1;
    apR2.state = sR2;
  }

  private updateCoeffs(): void {
    const midFc = clampLocal(this.cutoffHz, 22, this.sampleRate * 0.44);
    const gm = Math.tan((Math.PI * midFc) / this.sampleRate);
    this.midK = 1 / BUTTERWORTH_Q;
    this.midA1 = 1 / (1 + gm * (gm + this.midK));
    this.midA2 = gm * this.midA1;
    this.midA3 = gm * this.midA2;

    const sideFc = clampLocal(this.cutoffHz * 1.1, 22, this.sampleRate * 0.44);
    const gs = Math.tan((Math.PI * sideFc) / this.sampleRate);

    this.s1K = 1 / 0.51763809;
    this.s1A1 = 1 / (1 + gs * (gs + this.s1K));
    this.s1A2 = gs * this.s1A1;
    this.s1A3 = gs * this.s1A2;

    this.s2K = 1 / BUTTERWORTH_Q;
    this.s2A1 = 1 / (1 + gs * (gs + this.s2K));
    this.s2A2 = gs * this.s2A1;
    this.s2A3 = gs * this.s2A2;

    this.s3K = 1 / 1.93185165;
    this.s3A1 = 1 / (1 + gs * (gs + this.s3K));
    this.s3A2 = gs * this.s3A1;
    this.s3A3 = gs * this.s3A2;
  }
}

class FirstOrderAllpass {
  public coeff = 0;
  public state = 0;

  constructor(sampleRate: number, freqHz: number) {
    this.setFrequency(sampleRate, freqHz);
  }

  public setFrequency(sampleRate: number, freqHz: number): void {
    const safeFc = clampLocal(freqHz, 50, sampleRate * 0.42);
    const t = Math.tan((Math.PI * safeFc) / sampleRate);
    this.coeff = clampLocal((t - 1) / (t + 1), -0.99, 0.99);
  }

  public reset(): void {
    this.state = 0;
  }

  public processSample(x: number): number {
    const rawY = this.coeff * x + this.state;
    const y = Number.isFinite(rawY) ? (rawY > -1e-24 && rawY < 1e-24 ? 0 : rawY) : 0;
    const rawS = x - this.coeff * y;
    this.state = Number.isFinite(rawS) ? (rawS > -1e-24 && rawS < 1e-24 ? 0 : rawS) : 0;
    return y;
  }
}

/**
 * Stereo width & subtle allpass spreader with an LR4 110 Hz crossover
 * keeping all sub-bass frequencies strictly mono-centered.
 */
export class StereoOrbit {
  public outL = 0;
  public outR = 0;

  private sampleRate: number;
  private targetWidth = 1.0;
  private readonly widthSmoother: OnePoleSmoother;
  private readonly crossover: LR4SubMonoCrossover;

  private readonly apL1: FirstOrderAllpass;
  private readonly apL2: FirstOrderAllpass;
  private readonly apR1: FirstOrderAllpass;
  private readonly apR2: FirstOrderAllpass;

  constructor(sampleRate = 48000, width = 1.0) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.targetWidth = clampLocal(width, 0, 1.8);
    this.widthSmoother = new OnePoleSmoother(this.sampleRate, 15, this.targetWidth);
    this.crossover = new LR4SubMonoCrossover(this.sampleRate, 110);

    this.apL1 = new FirstOrderAllpass(this.sampleRate, 430);
    this.apL2 = new FirstOrderAllpass(this.sampleRate, 1850);
    this.apR1 = new FirstOrderAllpass(this.sampleRate, 670);
    this.apR2 = new FirstOrderAllpass(this.sampleRate, 2700);
  }

  public setSampleRate(sr: number): void {
    this.sampleRate = sanitizeSampleRate(sr);
    this.widthSmoother.setSampleRate(this.sampleRate);
    this.crossover.setSampleRate(this.sampleRate);
    this.apL1.setFrequency(this.sampleRate, 430);
    this.apL2.setFrequency(this.sampleRate, 1850);
    this.apR1.setFrequency(this.sampleRate, 670);
    this.apR2.setFrequency(this.sampleRate, 2700);
  }

  public setWidth(width: number, immediate = false): void {
    const w = clampLocal(width, 0, 1.8);
    if (!immediate && Math.abs(w - this.targetWidth) < 1e-6) return;
    this.targetWidth = w;
    if (immediate) {
      this.widthSmoother.reset(this.targetWidth);
    }
  }

  public reset(): void {
    this.crossover.reset();
    this.apL1.reset();
    this.apL2.reset();
    this.apR1.reset();
    this.apR2.reset();
    this.widthSmoother.reset(this.targetWidth);
    this.outL = 0;
    this.outR = 0;
  }

  public processStereo(inL: number, inR: number): void {
    this.crossover.process(inL, inR);
    const subMono = this.crossover.subMono;
    const hiL = this.crossover.highL;
    const hiR = this.crossover.highR;

    const w =
      this.widthSmoother.current === this.targetWidth
        ? this.targetWidth
        : this.widthSmoother.process(this.targetWidth);
    const spreadMix = clampLocal((w - 0.75) / 1.05, 0, 1) * 0.28;

    const diffusedL = this.apL2.processSample(this.apL1.processSample(hiL));
    const diffusedR = this.apR2.processSample(this.apR1.processSample(hiR));

    const spL = hiL + spreadMix * (diffusedL - hiL);
    const spR = hiR + spreadMix * (diffusedR - hiR);

    const mid = 0.5 * (spL + spR);
    const side = 0.5 * (spL - spR);

    const yL = subMono + mid + w * side;
    const yR = subMono + mid - w * side;
    this.outL = Number.isFinite(yL) ? yL : 0;
    this.outR = Number.isFinite(yR) ? yR : 0;
  }

  public processStereoBlock(
    bufL: Float32Array,
    bufR: Float32Array,
    start: number,
    end: number,
  ): void {
    const subLen = end - start;
    if (subLen <= 0) return;

    let w = this.targetWidth;
    if (this.widthSmoother.current !== w) {
      for (let k = 0; k < subLen; k++) {
        w = this.widthSmoother.process(this.targetWidth);
      }
      if (Math.abs(w - this.targetWidth) < 1e-6) {
        w = this.targetWidth;
        this.widthSmoother.reset(w);
      }
    }
    const spreadMix = clampLocal((w - 0.75) / 1.05, 0, 1) * 0.28;

    this.crossover.processStereoOrbitBlock(
      bufL,
      bufR,
      start,
      end,
      w,
      spreadMix,
      this.apL1,
      this.apL2,
      this.apR1,
      this.apR2,
    );
  }
}

/**
 * Tempo-synchronized stereo / ping-pong delay with preallocated buffers
 * (up to 2.5 s at up to 96 kHz), smooth delay-time interpolation, feedback
 * clamped <= 0.80, and a tape-darkening filter in the feedback loop.
 */
export class TempoSyncDelay {
  public outL = 0;
  public outR = 0;

  private sampleRate: number;
  private bufferSize = 0;
  private bufL!: Float32Array;
  private bufR!: Float32Array;
  private writeIdx = 0;

  private bpm = 128;
  private division: DelayDivision = '3/16';
  private pingPong = true;
  private feedback = 0.4;
  private darkening = 0.45;
  private mix = 0.25;

  private targetDelaySamples = 16875;
  private readonly delaySmoother: OnePoleSmoother;
  private readonly mixSmoother: OnePoleSmoother;

  private dampCoeff = 0.4;
  private dampStateL = 0;
  private dampStateR = 0;

  constructor(sampleRate = 48000) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.delaySmoother = new OnePoleSmoother(this.sampleRate, 45, 16875);
    this.mixSmoother = new OnePoleSmoother(this.sampleRate, 15, this.mix);
    this.allocateBuffers(this.sampleRate);
    this.updateDelayTarget();
    this.updateDamping();
    this.delaySmoother.reset(this.targetDelaySamples);
  }

  public setSampleRate(sr: number): void {
    this.sampleRate = sanitizeSampleRate(sr);
    this.delaySmoother.setSampleRate(this.sampleRate);
    this.mixSmoother.setSampleRate(this.sampleRate);

    const needed = Math.ceil(2.5 * this.sampleRate) + 8;
    if (needed > this.bufferSize) {
      this.allocateBuffers(this.sampleRate);
    } else {
      this.reset();
    }
    this.updateDelayTarget();
    this.updateDamping();
    this.delaySmoother.reset(this.targetDelaySamples);
  }

  public setBpm(bpm: number): void {
    const safeBpm = clampLocal(bpm, 40, 300);
    if (Math.abs(safeBpm - this.bpm) > 1e-6) {
      this.bpm = safeBpm;
      this.updateDelayTarget();
    }
  }

  public setDivision(division: DelayDivision): void {
    if (division !== this.division) {
      this.division = division;
      this.updateDelayTarget();
    }
  }

  public setPingPong(enabled: boolean): void {
    this.pingPong = enabled;
  }

  public setFeedback(fb: number): void {
    const f = clampLocal(fb, 0, 0.8);
    if (Math.abs(f - this.feedback) < 1e-6) return;
    this.feedback = f;
  }

  public setDarkening(darkening: number): void {
    const d = clampLocal(darkening, 0, 1);
    if (Math.abs(d - this.darkening) > 1e-6) {
      this.darkening = d;
      this.updateDamping();
    }
  }

  public setMix(mix: number): void {
    const m = clampLocal(mix, 0, 1);
    if (Math.abs(m - this.mix) < 1e-6) return;
    this.mix = m;
  }

  public reset(): void {
    this.bufL.fill(0);
    this.bufR.fill(0);
    this.writeIdx = 0;
    this.dampStateL = 0;
    this.dampStateR = 0;
    this.outL = 0;
    this.outR = 0;
    this.delaySmoother.reset(this.targetDelaySamples);
    this.mixSmoother.reset(this.mix);
  }

  public processStereo(inL: number, inR: number): void {
    const safeL = Number.isFinite(inL) ? inL : 0;
    const safeR = Number.isFinite(inR) ? inR : 0;

    const delaySamples =
      this.delaySmoother.current === this.targetDelaySamples
        ? this.targetDelaySamples
        : this.delaySmoother.process(this.targetDelaySamples);
    const wetMix =
      this.mixSmoother.current === this.mix
        ? this.mix
        : this.mixSmoother.process(this.mix);

    const len = this.bufferSize;
    const wIdx = this.writeIdx;

    const intD = Math.floor(delaySamples);
    const frac = delaySamples - intD;

    let idx0 = wIdx - intD;
    if (idx0 < 0) idx0 += len;
    let idx1 = idx0 - 1;
    if (idx1 < 0) idx1 += len;

    const tapL = this.bufL[idx0]! + frac * (this.bufL[idx1]! - this.bufL[idx0]!);
    const tapR = this.bufR[idx0]! + frac * (this.bufR[idx1]! - this.bufR[idx0]!);

    // Tape-darkening 1-pole LPF + subtle saturation in feedback path
    const dl = this.dampStateL + this.dampCoeff * (tapL - this.dampStateL);
    this.dampStateL = Number.isFinite(dl) ? (dl > -1e-24 && dl < 1e-24 ? 0 : dl) : 0;
    const dr = this.dampStateR + this.dampCoeff * (tapR - this.dampStateR);
    this.dampStateR = Number.isFinite(dr) ? (dr > -1e-24 && dr < 1e-24 ? 0 : dr) : 0;

    const fb = this.feedback;
    const fbL = fastTanh(this.dampStateL * 0.85) * 1.15 * fb;
    const fbR = fastTanh(this.dampStateR * 0.85) * 1.15 * fb;

    if (this.pingPong) {
      const monoIn = 0.5 * (safeL + safeR);
      const bL = monoIn + fbR;
      const bR = fbL;
      this.bufL[wIdx] = Number.isFinite(bL) ? (bL > -1e-24 && bL < 1e-24 ? 0 : bL) : 0;
      this.bufR[wIdx] = Number.isFinite(bR) ? (bR > -1e-24 && bR < 1e-24 ? 0 : bR) : 0;
    } else {
      const bL = safeL + fbL;
      const bR = safeR + fbR;
      this.bufL[wIdx] = Number.isFinite(bL) ? (bL > -1e-24 && bL < 1e-24 ? 0 : bL) : 0;
      this.bufR[wIdx] = Number.isFinite(bR) ? (bR > -1e-24 && bR < 1e-24 ? 0 : bR) : 0;
    }

    this.writeIdx = wIdx + 1 >= len ? 0 : wIdx + 1;

    const dryGain = 1 - 0.35 * wetMix;
    const yL = safeL * dryGain + tapL * wetMix;
    const yR = safeR * dryGain + tapR * wetMix;
    this.outL = Number.isFinite(yL) ? yL : 0;
    this.outR = Number.isFinite(yR) ? yR : 0;
  }

  public processStereoBlock(
    outL: Float32Array,
    outR: Float32Array,
    start: number,
    end: number,
  ): void {
    const subLen = end - start;
    if (subLen <= 0) return;

    let delaySamples = this.targetDelaySamples;
    if (this.delaySmoother.current !== delaySamples) {
      for (let k = 0; k < subLen; k++) {
        delaySamples = this.delaySmoother.process(this.targetDelaySamples);
      }
      if (Math.abs(delaySamples - this.targetDelaySamples) < 1e-5) {
        delaySamples = this.targetDelaySamples;
        this.delaySmoother.reset(delaySamples);
      }
    }
    let wetMix = this.mix;
    if (this.mixSmoother.current !== wetMix) {
      for (let k = 0; k < subLen; k++) {
        wetMix = this.mixSmoother.process(this.mix);
      }
      if (Math.abs(wetMix - this.mix) < 1e-6) {
        wetMix = this.mix;
        this.mixSmoother.reset(wetMix);
      }
    }

    const len = this.bufferSize;
    const bufL = this.bufL;
    const bufR = this.bufR;
    let wIdx = this.writeIdx;
    let dampStateL = this.dampStateL;
    let dampStateR = this.dampStateR;
    const dampCoeff = this.dampCoeff;
    const fb = this.feedback;
    const pingPong = this.pingPong;
    const dryGain = 1 - 0.35 * wetMix;

    const intD = Math.floor(delaySamples);
    const frac = delaySamples - intD;

    for (let i = start; i < end; i++) {
      const safeL = outL[i]!;
      const safeR = outR[i]!;

      let idx0 = wIdx - intD;
      if (idx0 < 0) idx0 += len;
      let idx1 = idx0 - 1;
      if (idx1 < 0) idx1 += len;

      const bL0 = bufL[idx0]!;
      const tapL = bL0 + frac * (bufL[idx1]! - bL0);
      const bR0 = bufR[idx0]!;
      const tapR = bR0 + frac * (bufR[idx1]! - bR0);

      dampStateL = dampStateL + dampCoeff * (tapL - dampStateL);
      dampStateR = dampStateR + dampCoeff * (tapR - dampStateR);

      const fbL = fastTanh(dampStateL * 0.85) * 1.15 * fb;
      const fbR = fastTanh(dampStateR * 0.85) * 1.15 * fb;

      if (pingPong) {
        const monoIn = 0.5 * (safeL + safeR);
        bufL[wIdx] = monoIn + fbR;
        bufR[wIdx] = fbL;
      } else {
        bufL[wIdx] = safeL + fbL;
        bufR[wIdx] = safeR + fbR;
      }

      wIdx = wIdx + 1 >= len ? 0 : wIdx + 1;

      outL[i] = safeL * dryGain + tapL * wetMix;
      outR[i] = safeR * dryGain + tapR * wetMix;
    }

    if (!Number.isFinite(dampStateL) || !Number.isFinite(dampStateR)) {
      dampStateL = 0;
      dampStateR = 0;
      for (let i = start; i < end; i++) { outL[i] = 0; outR[i] = 0; }
    } else {
      if (dampStateL > -1e-24 && dampStateL < 1e-24) dampStateL = 0;
      if (dampStateR > -1e-24 && dampStateR < 1e-24) dampStateR = 0;
    }

    this.writeIdx = wIdx;
    this.dampStateL = dampStateL;
    this.dampStateR = dampStateR;
  }

  private allocateBuffers(sr: number): void {
    const minSamples = Math.ceil(2.5 * Math.max(96000, sr)) + 8;
    this.bufferSize = minSamples;
    this.bufL = new Float32Array(minSamples);
    this.bufR = new Float32Array(minSamples);
    this.writeIdx = 0;
  }

  private updateDelayTarget(): void {
    // Bar fractions mapped to beats (in 4/4: 1/8 = 0.5 beat, 3/16 = 0.75, 1/4 = 1.0, 1/3 = 4/3)
    let beats = 0.75;
    switch (this.division) {
      case '1/8':
        beats = 0.5;
        break;
      case '3/16':
        beats = 0.75;
        break;
      case '1/4':
        beats = 1.0;
        break;
      case '1/3':
        beats = 4 / 3;
        break;
    }
    const delaySec = (beats * 60) / this.bpm;
    const maxSamples = Math.min(this.bufferSize - 4, 2.5 * this.sampleRate);
    this.targetDelaySamples = clampLocal(delaySec * this.sampleRate, 1, maxSamples);
  }

  private updateDamping(): void {
    const cutoffHz = clampLocal(14000 - this.darkening * 12800, 800, this.sampleRate * 0.43);
    const omega = (2 * Math.PI * cutoffHz) / this.sampleRate;
    this.dampCoeff = clampLocal(omega / (1 + omega), 0.02, 0.99);
  }
}

const FDN_BASE_PRIMES_48K = [1429, 1787, 2131, 2659] as const;

/**
 * 4-channel Hadamard Feedback Delay Network (FDN) reverb with preallocated
 * prime-length delay lines, brightness/damping control, and rhythmic ducking
 * driven by `duckAmount` and `pulseEnergy`.
 */
export class DuckingReverb {
  public outL = 0;
  public outR = 0;

  private sampleRate: number;
  private bufferSize = 0;
  private bufferMask = 0;

  private delay0!: Float32Array;
  private delay1!: Float32Array;
  private delay2!: Float32Array;
  private delay3!: Float32Array;
  private writeIdx = 0;

  private size = 0.6;
  private decay = 0.65;
  private brightness = 0.5;
  private mix = 0.25;
  private duckAmount = 0.4;
  private pulseEnergy = 0;

  private feedbackGain = 0.75;
  private dampCoeff = 0.45;

  private lp0 = 0;
  private lp1 = 0;
  private lp2 = 0;
  private lp3 = 0;

  private readonly inputHpL: ZdfSvfFilter;
  private readonly inputHpR: ZdfSvfFilter;
  private sendBufL = new Float32Array(128);
  private sendBufR = new Float32Array(128);

  private readonly sizeSmoother: OnePoleSmoother;
  private readonly mixSmoother: OnePoleSmoother;

  private duckEnv = 0;
  private duckAttackCoeff = 0.01;
  private duckReleaseCoeff = 0.0002;

  constructor(sampleRate = 48000) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.inputHpL = new ZdfSvfFilter(this.sampleRate, 105, BUTTERWORTH_Q, 2);
    this.inputHpR = new ZdfSvfFilter(this.sampleRate, 105, BUTTERWORTH_Q, 2);
    this.sizeSmoother = new OnePoleSmoother(this.sampleRate, 60, this.size);
    this.mixSmoother = new OnePoleSmoother(this.sampleRate, 15, this.mix);

    this.allocateBuffers(this.sampleRate);
    this.updateParams();
  }

  public setSampleRate(sr: number): void {
    this.sampleRate = sanitizeSampleRate(sr);
    this.inputHpL.setSampleRate(this.sampleRate);
    this.inputHpR.setSampleRate(this.sampleRate);
    this.sizeSmoother.setSampleRate(this.sampleRate);
    this.mixSmoother.setSampleRate(this.sampleRate);

    const maxNeeded = Math.ceil(2659 * 1.45 * (this.sampleRate / 48000)) + 8;
    if (maxNeeded > this.bufferSize) {
      this.allocateBuffers(this.sampleRate);
    } else {
      this.reset();
    }
    this.updateParams();
  }

  public setSize(size: number): void {
    const s = clampLocal(size, 0, 1);
    if (Math.abs(s - this.size) < 1e-6) return;
    this.size = s;
  }

  public setDecay(decay: number): void {
    const d = clampLocal(decay, 0, 1);
    if (Math.abs(d - this.decay) > 1e-6) {
      this.decay = d;
      this.updateFeedbackGain();
    }
  }

  public setBrightness(brightness: number): void {
    const b = clampLocal(brightness, 0, 1);
    if (Math.abs(b - this.brightness) > 1e-6) {
      this.brightness = b;
      this.updateDamping();
    }
  }

  public setMix(mix: number): void {
    const m = clampLocal(mix, 0, 1);
    if (Math.abs(m - this.mix) < 1e-6) return;
    this.mix = m;
  }

  public setDuckAmount(duckAmount: number): void {
    const da = clampLocal(duckAmount, 0, 1);
    if (Math.abs(da - this.duckAmount) < 1e-6) return;
    this.duckAmount = da;
  }

  public setPulseEnergy(pulseEnergy: number): void {
    const pe = clampLocal(pulseEnergy, 0, 1);
    if (Math.abs(pe - this.pulseEnergy) < 1e-6) return;
    this.pulseEnergy = pe;
  }

  public setParams(
    size: number,
    decay: number,
    brightness: number,
    mix: number,
    duckAmount: number
  ): void {
    const s = clampLocal(size, 0, 1);
    const d = clampLocal(decay, 0, 1);
    const b = clampLocal(brightness, 0, 1);
    const m = clampLocal(mix, 0, 1);
    const da = clampLocal(duckAmount, 0, 1);

    if (Math.abs(s - this.size) >= 1e-6) this.size = s;
    if (Math.abs(m - this.mix) >= 1e-6) this.mix = m;
    if (Math.abs(da - this.duckAmount) >= 1e-6) this.duckAmount = da;
    if (Math.abs(d - this.decay) > 1e-6) {
      this.decay = d;
      this.updateFeedbackGain();
    }
    if (Math.abs(b - this.brightness) > 1e-6) {
      this.brightness = b;
      this.updateDamping();
    }
  }

  public reset(): void {
    this.delay0.fill(0);
    this.delay1.fill(0);
    this.delay2.fill(0);
    this.delay3.fill(0);
    this.writeIdx = 0;
    this.lp0 = 0;
    this.lp1 = 0;
    this.lp2 = 0;
    this.lp3 = 0;
    this.duckEnv = 0;
    this.outL = 0;
    this.outR = 0;
    this.inputHpL.reset();
    this.inputHpR.reset();
    this.sizeSmoother.reset(this.size);
    this.mixSmoother.reset(this.mix);
  }

  public processStereo(inL: number, inR: number, pulseEnergyOverride?: number): void {
    const safeL = Number.isFinite(inL) ? inL : 0;
    const safeR = Number.isFinite(inR) ? inR : 0;
    const energy =
      pulseEnergyOverride !== undefined
        ? clampLocal(pulseEnergyOverride, 0, 1)
        : this.pulseEnergy;

    // Update ducking envelope (fast attack ~2 ms, musical release ~145 ms)
    const envCoeff = energy > this.duckEnv ? this.duckAttackCoeff : this.duckReleaseCoeff;
    const nextDuck = this.duckEnv + envCoeff * (energy - this.duckEnv);
    this.duckEnv = Number.isFinite(nextDuck) ? (nextDuck > -1e-24 && nextDuck < 1e-24 ? 0 : nextDuck) : 0;
    const duckGain = 1 - this.duckAmount * this.duckEnv * 0.92;

    const smoothedSize =
      this.sizeSmoother.current === this.size ? this.size : this.sizeSmoother.process(this.size);
    const wetMix =
      this.mixSmoother.current === this.mix ? this.mix : this.mixSmoother.process(this.mix);

    const scale = (0.45 + smoothedSize * 0.9) * (this.sampleRate / 48000);
    const maxDelay = this.bufferSize - 4;
    const wIdx = this.writeIdx;
    const mask = this.bufferMask;

    const d0 = this.readLinear(this.delay0, wIdx, clampLocal(FDN_BASE_PRIMES_48K[0] * scale, 16, maxDelay), mask);
    const d1 = this.readLinear(this.delay1, wIdx, clampLocal(FDN_BASE_PRIMES_48K[1] * scale, 16, maxDelay), mask);
    const d2 = this.readLinear(this.delay2, wIdx, clampLocal(FDN_BASE_PRIMES_48K[2] * scale, 16, maxDelay), mask);
    const d3 = this.readLinear(this.delay3, wIdx, clampLocal(FDN_BASE_PRIMES_48K[3] * scale, 16, maxDelay), mask);

    // 4x4 orthogonal Hadamard mixing (0.5 * H_4)
    const s01 = d0 + d1;
    const diff01 = d0 - d1;
    const s23 = d2 + d3;
    const diff23 = d2 - d3;

    const m0 = 0.5 * (s01 + s23);
    const m1 = 0.5 * (diff01 + diff23);
    const m2 = 0.5 * (s01 - s23);
    const m3 = 0.5 * (diff01 - diff23);

    // Damping 1-pole lowpass per FDN branch
    const dc = this.dampCoeff;
    const nl0 = this.lp0 + dc * (m0 - this.lp0);
    this.lp0 = nl0 > -1e-24 && nl0 < 1e-24 ? 0 : nl0;
    const nl1 = this.lp1 + dc * (m1 - this.lp1);
    this.lp1 = nl1 > -1e-24 && nl1 < 1e-24 ? 0 : nl1;
    const nl2 = this.lp2 + dc * (m2 - this.lp2);
    this.lp2 = nl2 > -1e-24 && nl2 < 1e-24 ? 0 : nl2;
    const nl3 = this.lp3 + dc * (m3 - this.lp3);
    this.lp3 = nl3 > -1e-24 && nl3 < 1e-24 ? 0 : nl3;

    // High-pass send input so sub-bass stays clean
    const sendL = this.inputHpL.processSample(safeL);
    const sendR = this.inputHpR.processSample(safeR);
    const sendMid = 0.70710678 * (sendL + sendR);
    const sendSide = 0.70710678 * (sendL - sendR);

    const g = this.feedbackGain;
    const w0 = 0.5 * sendL + g * this.lp0;
    const w1 = 0.5 * sendR + g * this.lp1;
    const w2 = 0.5 * sendMid + g * this.lp2;
    const w3 = 0.5 * sendSide + g * this.lp3;
    this.delay0[wIdx] = Number.isFinite(w0) ? (w0 > -1e-24 && w0 < 1e-24 ? 0 : w0) : 0;
    this.delay1[wIdx] = Number.isFinite(w1) ? (w1 > -1e-24 && w1 < 1e-24 ? 0 : w1) : 0;
    this.delay2[wIdx] = Number.isFinite(w2) ? (w2 > -1e-24 && w2 < 1e-24 ? 0 : w2) : 0;
    this.delay3[wIdx] = Number.isFinite(w3) ? (w3 > -1e-24 && w3 < 1e-24 ? 0 : w3) : 0;

    this.writeIdx = (wIdx + 1) & mask;

    const wetL = 0.5 * (d0 + d2) * duckGain;
    const wetR = 0.5 * (d1 - d3) * duckGain;
    const dryGain = 1 - 0.25 * wetMix;

    const yL = safeL * dryGain + wetL * wetMix;
    const yR = safeR * dryGain + wetR * wetMix;
    this.outL = Number.isFinite(yL) ? yL : 0;
    this.outR = Number.isFinite(yR) ? yR : 0;
  }

  public processStereoBlock(
    outL: Float32Array,
    outR: Float32Array,
    start: number,
    end: number,
    pulseEnergyOverride?: number,
  ): void {
    const subLen = end - start;
    if (subLen <= 0) return;

    const energy =
      pulseEnergyOverride !== undefined
        ? clampLocal(pulseEnergyOverride, 0, 1)
        : this.pulseEnergy;

    let smoothedSize = this.size;
    if (this.sizeSmoother.current !== smoothedSize) {
      for (let k = 0; k < subLen; k++) {
        smoothedSize = this.sizeSmoother.process(this.size);
      }
      if (Math.abs(smoothedSize - this.size) < 1e-6) {
        smoothedSize = this.size;
        this.sizeSmoother.reset(smoothedSize);
      }
    }
    let wetMix = this.mix;
    if (this.mixSmoother.current !== wetMix) {
      for (let k = 0; k < subLen; k++) {
        wetMix = this.mixSmoother.process(this.mix);
      }
      if (Math.abs(wetMix - this.mix) < 1e-6) {
        wetMix = this.mix;
        this.mixSmoother.reset(wetMix);
      }
    }

    const scale = (0.45 + smoothedSize * 0.9) * (this.sampleRate / 48000);
    const maxDelay = this.bufferSize - 4;
    const del0 = clampLocal(FDN_BASE_PRIMES_48K[0] * scale, 16, maxDelay);
    const del1 = clampLocal(FDN_BASE_PRIMES_48K[1] * scale, 16, maxDelay);
    const del2 = clampLocal(FDN_BASE_PRIMES_48K[2] * scale, 16, maxDelay);
    const del3 = clampLocal(FDN_BASE_PRIMES_48K[3] * scale, 16, maxDelay);

    const int0 = Math.floor(del0);
    const frac0 = del0 - int0;
    const int1 = Math.floor(del1);
    const frac1 = del1 - int1;
    const int2 = Math.floor(del2);
    const frac2 = del2 - int2;
    const int3 = Math.floor(del3);
    const frac3 = del3 - int3;

    const delay0 = this.delay0;
    const delay1 = this.delay1;
    const delay2 = this.delay2;
    const delay3 = this.delay3;
    const mask = this.bufferMask;
    let wIdx = this.writeIdx;
    let lp0 = this.lp0;
    let lp1 = this.lp1;
    let lp2 = this.lp2;
    let lp3 = this.lp3;
    let duckEnv = this.duckEnv;
    const envCoeff = energy > duckEnv ? this.duckAttackCoeff : this.duckReleaseCoeff;
    const duckAmount = this.duckAmount;
    const dc = this.dampCoeff;
    const g = this.feedbackGain;
    const dryGain = 1 - 0.25 * wetMix;
    const hpL = this.inputHpL;
    const hpR = this.inputHpR;
    if (subLen > this.sendBufL.length) {
      this.sendBufL = new Float32Array(subLen);
      this.sendBufR = new Float32Array(subLen);
    }
    const sBufL = this.sendBufL;
    const sBufR = this.sendBufR;
    for (let k = 0; k < subLen; k++) {
      const rL = outL[start + k]!;
      const rR = outR[start + k]!;
      sBufL[k] = rL * 0 === 0 ? rL : 0;
      sBufR[k] = rR * 0 === 0 ? rR : 0;
    }
    hpL.processBlock(sBufL, 0, subLen);
    hpR.processBlock(sBufR, 0, subLen);

    for (let k = 0; k < subLen; k++) {
      const i = start + k;
      const safeL = outL[i]!;
      const safeR = outR[i]!;

      duckEnv = duckEnv + envCoeff * (energy - duckEnv);
      const duckGain = 1 - duckAmount * duckEnv * 0.92;

      let i0 = (wIdx - int0) & mask;
      let i1 = (i0 - 1) & mask;
      const v0 = delay0[i0]!;
      const d0 = v0 + frac0 * (delay0[i1]! - v0);

      i0 = (wIdx - int1) & mask;
      i1 = (i0 - 1) & mask;
      const v1 = delay1[i0]!;
      const d1 = v1 + frac1 * (delay1[i1]! - v1);

      i0 = (wIdx - int2) & mask;
      i1 = (i0 - 1) & mask;
      const v2 = delay2[i0]!;
      const d2 = v2 + frac2 * (delay2[i1]! - v2);

      i0 = (wIdx - int3) & mask;
      i1 = (i0 - 1) & mask;
      const v3 = delay3[i0]!;
      const d3 = v3 + frac3 * (delay3[i1]! - v3);

      const s01 = d0 + d1;
      const diff01 = d0 - d1;
      const s23 = d2 + d3;
      const diff23 = d2 - d3;

      const m0 = 0.5 * (s01 + s23);
      const m1 = 0.5 * (diff01 + diff23);
      const m2 = 0.5 * (s01 - s23);
      const m3 = 0.5 * (diff01 - diff23);

      lp0 = lp0 + dc * (m0 - lp0);
      lp1 = lp1 + dc * (m1 - lp1);
      lp2 = lp2 + dc * (m2 - lp2);
      lp3 = lp3 + dc * (m3 - lp3);

      const sendL = sBufL[k]!;
      const sendR = sBufR[k]!;
      const sendMid = 0.70710678 * (sendL + sendR);
      const sendSide = 0.70710678 * (sendL - sendR);

      delay0[wIdx] = 0.5 * sendL + g * lp0;
      delay1[wIdx] = 0.5 * sendR + g * lp1;
      delay2[wIdx] = 0.5 * sendMid + g * lp2;
      delay3[wIdx] = 0.5 * sendSide + g * lp3;

      wIdx = (wIdx + 1) & mask;

      const wetL = 0.5 * (d0 + d2) * duckGain;
      const wetR = 0.5 * (d1 - d3) * duckGain;
      outL[i] = safeL * dryGain + wetL * wetMix;
      outR[i] = safeR * dryGain + wetR * wetMix;
    }

    if (!Number.isFinite(lp0) || !Number.isFinite(lp1) || !Number.isFinite(lp2) || !Number.isFinite(lp3)) {
      lp0 = 0; lp1 = 0; lp2 = 0; lp3 = 0; duckEnv = 0;
      for (let i = start; i < end; i++) { outL[i] = 0; outR[i] = 0; }
    } else {
      if (lp0 > -1e-24 && lp0 < 1e-24) lp0 = 0;
      if (lp1 > -1e-24 && lp1 < 1e-24) lp1 = 0;
      if (lp2 > -1e-24 && lp2 < 1e-24) lp2 = 0;
      if (lp3 > -1e-24 && lp3 < 1e-24) lp3 = 0;
      if (duckEnv > -1e-24 && duckEnv < 1e-24) duckEnv = 0;
    }

    this.writeIdx = wIdx;
    this.lp0 = lp0;
    this.lp1 = lp1;
    this.lp2 = lp2;
    this.lp3 = lp3;
    this.duckEnv = duckEnv;
  }

  private readLinear(
    buf: Float32Array,
    writeIdx: number,
    delaySamples: number,
    mask: number
  ): number {
    const intD = Math.floor(delaySamples);
    const frac = delaySamples - intD;
    const idx0 = (writeIdx - intD) & mask;
    const idx1 = (idx0 - 1) & mask;
    return buf[idx0]! + frac * (buf[idx1]! - buf[idx0]!);
  }

  private allocateBuffers(sr: number): void {
    const maxLen = Math.ceil(2659 * 1.45 * (Math.max(sr, 96000) / 48000)) + 8;
    let pow2 = 1;
    while (pow2 < maxLen) pow2 <<= 1;
    this.bufferSize = pow2;
    this.bufferMask = pow2 - 1;
    this.delay0 = new Float32Array(pow2);
    this.delay1 = new Float32Array(pow2);
    this.delay2 = new Float32Array(pow2);
    this.delay3 = new Float32Array(pow2);
    this.writeIdx = 0;
  }

  private updateParams(): void {
    this.updateFeedbackGain();
    this.updateDamping();
    this.duckAttackCoeff = clampLocal(1 - Math.exp(-1 / (0.002 * this.sampleRate)), 0.001, 1);
    this.duckReleaseCoeff = clampLocal(1 - Math.exp(-1 / (0.145 * this.sampleRate)), 0.00001, 1);
  }

  private updateFeedbackGain(): void {
    this.feedbackGain = clampLocal(0.32 + this.decay * 0.59, 0, 0.91);
  }

  private updateDamping(): void {
    const cutoffHz = clampLocal(900 + this.brightness * this.brightness * 10600, 400, this.sampleRate * 0.43);
    const omega = (2 * Math.PI * cutoffHz) / this.sampleRate;
    this.dampCoeff = clampLocal(omega / (1 + omega), 0.02, 0.99);
  }
}
