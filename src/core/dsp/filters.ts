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

/**
 * Zero-Delay-Feedback / TPT State-Variable Filter (Cytomic / Andrew Simper).
 * Supports continuous mode morphing: 0 = Lowpass, 1 = Bandpass, 2 = Highpass.
 */
export class ZdfSvfFilter {
  public lastLp = 0;
  public lastBp = 0;
  public lastHp = 0;

  private sampleRate: number;
  private freqHz = 1000;
  private q = 0.70710678;
  private mode = 0;

  private k = 1 / 0.70710678;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;

  private ic1eq = 0;
  private ic2eq = 0;

  constructor(sampleRate = 48000, freqHz = 1000, q = 0.70710678, mode = 0) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.freqHz = clampLocal(freqHz, 22, this.sampleRate * 0.44);
    this.q = clampLocal(q, 0.5, 5.5);
    this.mode = clampLocal(mode, 0, 2);
    this.updateCoeffs();
  }

  public setSampleRate(sr: number): void {
    this.sampleRate = sanitizeSampleRate(sr);
    this.freqHz = clampLocal(this.freqHz, 22, this.sampleRate * 0.44);
    this.updateCoeffs();
  }

  public setFrequency(hz: number): void {
    const clamped = clampLocal(hz, 22, this.sampleRate * 0.44);
    if (Math.abs(clamped - this.freqHz) > 0.08) {
      this.freqHz = clamped;
      this.updateCoeffs();
    }
  }

  public setResonance(q: number): void {
    const clamped = clampLocal(q, 0.5, 5.5);
    if (Math.abs(clamped - this.q) > 2e-4) {
      this.q = clamped;
      this.updateCoeffs();
    }
  }

  public setMode(mode: number): void {
    this.mode = clampLocal(mode, 0, 2);
  }

  public setParams(hz: number, q: number, mode: number): void {
    const clampedHz = clampLocal(hz, 22, this.sampleRate * 0.44);
    const clampedQ = clampLocal(q, 0.5, 5.5);
    this.mode = clampLocal(mode, 0, 2);
    if (Math.abs(clampedHz - this.freqHz) > 0.08 || Math.abs(clampedQ - this.q) > 2e-4) {
      this.freqHz = clampedHz;
      this.q = clampedQ;
      this.updateCoeffs();
    }
  }

  public reset(): void {
    this.ic1eq = 0;
    this.ic2eq = 0;
    this.lastLp = 0;
    this.lastBp = 0;
    this.lastHp = 0;
  }

  public processSample(x: number): number {
    const v0 = sanitizeLocal(x);
    const v3 = v0 - this.ic2eq;
    const v1 = this.a1 * this.ic1eq + this.a2 * v3;
    const v2 = this.ic2eq + this.a2 * this.ic1eq + this.a3 * v3;

    this.ic1eq = flushLocal(2 * v1 - this.ic1eq);
    this.ic2eq = flushLocal(2 * v2 - this.ic2eq);

    const lp = v2;
    const bp = v1;
    const hp = v0 - this.k * v1 - v2;

    this.lastLp = lp;
    this.lastBp = bp;
    this.lastHp = hp;

    const m = this.mode;
    if (m <= 1) {
      return lp + m * (bp - lp);
    }
    return bp + (m - 1) * (hp - bp);
  }

  public processBlock(buf: Float32Array, start: number, end: number): void {
    const a1 = this.a1;
    const a2 = this.a2;
    const a3 = this.a3;
    const k = this.k;
    const m = this.mode;
    let ic1 = this.ic1eq;
    let ic2 = this.ic2eq;
    let lp = this.lastLp;
    let bp = this.lastBp;
    let hp = this.lastHp;

    if (m <= 1) {
      for (let i = start; i < end; i++) {
        const v0 = buf[i]!;
        const v3 = v0 - ic2;
        const v1 = a1 * ic1 + a2 * v3;
        const v2 = ic2 + a2 * ic1 + a3 * v3;
        ic1 = 2 * v1 - ic1;
        ic2 = 2 * v2 - ic2;
        lp = v2;
        bp = v1;
        buf[i] = lp + m * (bp - lp);
      }
      hp = 0 - k * bp - lp;
    } else {
      const m1 = m - 1;
      for (let i = start; i < end; i++) {
        const v0 = buf[i]!;
        const v3 = v0 - ic2;
        const v1 = a1 * ic1 + a2 * v3;
        const v2 = ic2 + a2 * ic1 + a3 * v3;
        ic1 = 2 * v1 - ic1;
        ic2 = 2 * v2 - ic2;
        lp = v2;
        bp = v1;
        hp = v0 - k * v1 - v2;
        buf[i] = bp + m1 * (hp - bp);
      }
    }

    if (!Number.isFinite(ic1) || !Number.isFinite(ic2)) {
      ic1 = 0;
      ic2 = 0;
      lp = 0;
      bp = 0;
      hp = 0;
      for (let i = start; i < end; i++) buf[i] = 0;
    } else {
      if (ic1 > -1e-24 && ic1 < 1e-24) ic1 = 0;
      if (ic2 > -1e-24 && ic2 < 1e-24) ic2 = 0;
    }

    this.ic1eq = ic1;
    this.ic2eq = ic2;
    this.lastLp = lp;
    this.lastBp = bp;
    this.lastHp = hp;
  }

  private updateCoeffs(): void {
    const g = Math.tan((Math.PI * this.freqHz) / this.sampleRate);
    this.k = 1 / this.q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
}

/**
 * 1-pole Tilt Equalizer centered around ~650 Hz with exact 0 dB pivot gain.
 * `tilt` in [-1, 1]: -1 = bass-heavy (+6 dB low / -6 dB high), +1 = lean/present (-6 dB low / +6 dB high).
 */
export class TiltEQ {
  private sampleRate: number;
  private pivotHz: number;
  private targetTilt = 0;
  private activeTilt = 0;
  private readonly tiltSmoother: OnePoleSmoother;

  private g0 = 0;
  private a = 0;
  private k = 1;
  private invK = 1;
  private state = 0;

  constructor(sampleRate = 48000, pivotHz = 650) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.pivotHz = clampLocal(pivotHz, 100, this.sampleRate * 0.4);
    this.tiltSmoother = new OnePoleSmoother(this.sampleRate, 8, 0);
    this.updatePivot();
    this.updateTiltCoeffs(0);
  }

  public setSampleRate(sr: number): void {
    this.sampleRate = sanitizeSampleRate(sr);
    this.pivotHz = clampLocal(this.pivotHz, 100, this.sampleRate * 0.4);
    this.tiltSmoother.setSampleRate(this.sampleRate);
    this.updatePivot();
    this.updateTiltCoeffs(this.activeTilt);
  }

  public setTilt(tilt: number, immediate = false): void {
    const t = clampLocal(tilt, -1, 1);
    if (!immediate && Math.abs(t - this.targetTilt) < 1e-6) return;
    this.targetTilt = t;
    if (immediate) {
      this.tiltSmoother.reset(this.targetTilt);
      this.activeTilt = this.targetTilt;
      this.updateTiltCoeffs(this.activeTilt);
    }
  }

  public reset(): void {
    this.state = 0;
    this.tiltSmoother.reset(this.targetTilt);
    this.activeTilt = this.targetTilt;
    this.updateTiltCoeffs(this.activeTilt);
  }

  public processSample(x: number): number {
    const safeX = sanitizeLocal(x);
    if (this.tiltSmoother.current !== this.targetTilt) {
      const smoothed = this.tiltSmoother.process(this.targetTilt);
      if (
        Math.abs(smoothed - this.activeTilt) > 2e-4 ||
        (smoothed === this.targetTilt && Math.abs(smoothed - this.activeTilt) > 1e-9)
      ) {
        this.activeTilt = smoothed;
        this.updateTiltCoeffs(smoothed);
      }
    }

    const v = (safeX - this.state) * this.a;
    const lp = v + this.state;
    this.state = flushLocal(lp + v);

    if (Math.abs(this.activeTilt) < 1e-6) {
      return safeX;
    }
    return this.invK * safeX + (this.k - this.invK) * lp;
  }

  public processBlock(buf: Float32Array, start: number, end: number): void {
    const subLen = end - start;
    if (subLen <= 0) return;
    if (this.tiltSmoother.current !== this.targetTilt) {
      let smoothed = this.activeTilt;
      for (let k = 0; k < subLen; k++) {
        smoothed = this.tiltSmoother.process(this.targetTilt);
      }
      if (Math.abs(smoothed - this.targetTilt) < 1e-6) {
        smoothed = this.targetTilt;
        this.tiltSmoother.reset(this.targetTilt);
      }
      if (
        Math.abs(smoothed - this.activeTilt) > 2e-4 ||
        (smoothed === this.targetTilt && Math.abs(smoothed - this.activeTilt) > 1e-9)
      ) {
        this.activeTilt = smoothed;
        this.updateTiltCoeffs(smoothed);
      }
    }

    const a = this.a;
    let state = this.state;
    if (Math.abs(this.activeTilt) < 1e-6) {
      for (let i = start; i < end; i++) {
        const safeX = buf[i]!;
        const v = (safeX - state) * a;
        const lp = v + state;
        state = lp + v;
      }
    } else {
      const invK = this.invK;
      const kDiff = this.k - invK;
      for (let i = start; i < end; i++) {
        const safeX = buf[i]!;
        const v = (safeX - state) * a;
        const lp = v + state;
        state = lp + v;
        buf[i] = invK * safeX + kDiff * lp;
      }
    }
    if (!Number.isFinite(state)) {
      state = 0;
      for (let i = start; i < end; i++) buf[i] = 0;
    } else if (state > -1e-24 && state < 1e-24) {
      state = 0;
    }
    this.state = state;
  }

  private updatePivot(): void {
    this.g0 = Math.tan((Math.PI * this.pivotHz) / this.sampleRate);
  }

  private updateTiltCoeffs(tilt: number): void {
    // tilt = -1 => +6 dB low, -6 dB high; tilt = +1 => -6 dB low, +6 dB high
    const k = Math.pow(10, (-tilt * 6) / 20);
    this.k = k;
    this.invK = 1 / k;
    const gEff = this.g0 / k;
    this.a = gEff / (1 + gEff);
  }
}

type BiquadBandType = 'lowshelf' | 'peaking' | 'highshelf';

class BiquadFilter {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;
  private bypassed = true;

  public reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }

  public setBypass(): void {
    this.b0 = 1;
    this.b1 = 0;
    this.b2 = 0;
    this.a1 = 0;
    this.a2 = 0;
    this.bypassed = true;
  }

  public configure(
    type: BiquadBandType,
    freqHz: number,
    sampleRate: number,
    gainDb: number,
    qOrSlope: number
  ): void {
    const clampedGain = clampLocal(gainDb, -12, 12);
    if (Math.abs(clampedGain) < 1e-4) {
      this.setBypass();
      return;
    }

    const safeFc = clampLocal(freqHz, 10, sampleRate * 0.44);
    const A = Math.pow(10, clampedGain / 40);
    const w0 = (2 * Math.PI * safeFc) / sampleRate;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);

    let b0 = 1;
    let b1 = 0;
    let b2 = 0;
    let a0 = 1;
    let a1 = 0;
    let a2 = 0;

    if (type === 'peaking') {
      const q = Math.max(0.1, qOrSlope);
      const alpha = sinW0 / (2 * q);
      b0 = 1 + alpha * A;
      b1 = -2 * cosW0;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cosW0;
      a2 = 1 - alpha / A;
    } else {
      const slope = clampLocal(qOrSlope, 0.2, 2.0);
      const rad = Math.max(0, (A + 1 / A) * (1 / slope - 1) + 2);
      const alpha = 0.5 * sinW0 * Math.sqrt(rad);
      const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
      const aPlus1 = A + 1;
      const aMinus1 = A - 1;

      if (type === 'lowshelf') {
        b0 = A * (aPlus1 - aMinus1 * cosW0 + twoSqrtAAlpha);
        b1 = 2 * A * (aMinus1 - aPlus1 * cosW0);
        b2 = A * (aPlus1 - aMinus1 * cosW0 - twoSqrtAAlpha);
        a0 = aPlus1 + aMinus1 * cosW0 + twoSqrtAAlpha;
        a1 = -2 * (aMinus1 + aPlus1 * cosW0);
        a2 = aPlus1 + aMinus1 * cosW0 - twoSqrtAAlpha;
      } else {
        b0 = A * (aPlus1 + aMinus1 * cosW0 + twoSqrtAAlpha);
        b1 = -2 * A * (aMinus1 + aPlus1 * cosW0);
        b2 = A * (aPlus1 + aMinus1 * cosW0 - twoSqrtAAlpha);
        a0 = aPlus1 - aMinus1 * cosW0 + twoSqrtAAlpha;
        a1 = 2 * (aMinus1 - aPlus1 * cosW0);
        a2 = aPlus1 - aMinus1 * cosW0 - twoSqrtAAlpha;
      }
    }

    if (!Number.isFinite(a0) || Math.abs(a0) < 1e-12) {
      this.setBypass();
      return;
    }

    const invA0 = 1 / a0;
    const nb0 = b0 * invA0;
    const nb1 = b1 * invA0;
    const nb2 = b2 * invA0;
    const na1 = a1 * invA0;
    const na2 = a2 * invA0;

    if (
      !Number.isFinite(nb0) ||
      !Number.isFinite(nb1) ||
      !Number.isFinite(nb2) ||
      !Number.isFinite(na1) ||
      !Number.isFinite(na2)
    ) {
      this.setBypass();
      return;
    }

    this.b0 = nb0;
    this.b1 = nb1;
    this.b2 = nb2;
    this.a1 = na1;
    this.a2 = na2;
    this.bypassed = false;
  }

  public processSample(x: number): number {
    if (this.bypassed) return x;
    const y = this.b0 * x + this.z1;
    this.z1 = flushLocal(this.b1 * x - this.a1 * y + this.z2);
    this.z2 = flushLocal(this.b2 * x - this.a2 * y);
    return y;
  }

  public processBlock(buf: Float32Array, start: number, end: number): void {
    if (this.bypassed) return;
    const b0 = this.b0;
    const b1 = this.b1;
    const b2 = this.b2;
    const a1 = this.a1;
    const a2 = this.a2;
    let z1 = this.z1;
    let z2 = this.z2;

    for (let i = start; i < end; i++) {
      const x = buf[i]!;
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      buf[i] = y;
    }

    if (!Number.isFinite(z1) || !Number.isFinite(z2)) {
      z1 = 0;
      z2 = 0;
      for (let i = start; i < end; i++) buf[i] = 0;
    } else {
      if (z1 > -1e-24 && z1 < 1e-24) z1 = 0;
      if (z2 > -1e-24 && z2 < 1e-24) z2 = 0;
    }

    this.z1 = z1;
    this.z2 = z2;
  }
}

/**
 * Musical 3-Band Equalizer:
 * - Low Shelf (~110 Hz)
 * - Mid Bell (~850 Hz, Q = 0.85)
 * - High Shelf (~5500 Hz)
 * Gains safely clamped to [-12, +12] dB with smoothed coefficient updates.
 */
export class Musical3BandEQ {
  private sampleRate: number;

  private targetLowDb = 0;
  private targetMidDb = 0;
  private targetHighDb = 0;

  private activeLowDb = 0;
  private activeMidDb = 0;
  private activeHighDb = 0;

  private readonly lowSmoother: OnePoleSmoother;
  private readonly midSmoother: OnePoleSmoother;
  private readonly highSmoother: OnePoleSmoother;

  private readonly lowBand = new BiquadFilter();
  private readonly midBand = new BiquadFilter();
  private readonly highBand = new BiquadFilter();

  constructor(sampleRate = 48000) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.lowSmoother = new OnePoleSmoother(this.sampleRate, 10, 0);
    this.midSmoother = new OnePoleSmoother(this.sampleRate, 10, 0);
    this.highSmoother = new OnePoleSmoother(this.sampleRate, 10, 0);
    this.reconfigureAll();
  }

  public setSampleRate(sr: number): void {
    this.sampleRate = sanitizeSampleRate(sr);
    this.lowSmoother.setSampleRate(this.sampleRate);
    this.midSmoother.setSampleRate(this.sampleRate);
    this.highSmoother.setSampleRate(this.sampleRate);
    this.reconfigureAll();
  }

  public setGains(lowDb: number, midDb: number, highDb: number, immediate = false): void {
    const l = clampLocal(lowDb, -12, 12);
    const m = clampLocal(midDb, -12, 12);
    const h = clampLocal(highDb, -12, 12);
    if (
      !immediate &&
      Math.abs(l - this.targetLowDb) < 1e-6 &&
      Math.abs(m - this.targetMidDb) < 1e-6 &&
      Math.abs(h - this.targetHighDb) < 1e-6
    ) {
      return;
    }

    this.targetLowDb = l;
    this.targetMidDb = m;
    this.targetHighDb = h;

    if (immediate) {
      this.lowSmoother.reset(this.targetLowDb);
      this.midSmoother.reset(this.targetMidDb);
      this.highSmoother.reset(this.targetHighDb);
      this.activeLowDb = this.targetLowDb;
      this.activeMidDb = this.targetMidDb;
      this.activeHighDb = this.targetHighDb;
      this.reconfigureAll();
    }
  }

  public reset(): void {
    this.lowBand.reset();
    this.midBand.reset();
    this.highBand.reset();
    this.lowSmoother.reset(this.targetLowDb);
    this.midSmoother.reset(this.targetMidDb);
    this.highSmoother.reset(this.targetHighDb);
    this.activeLowDb = this.targetLowDb;
    this.activeMidDb = this.targetMidDb;
    this.activeHighDb = this.targetHighDb;
    this.reconfigureAll();
  }

  public processSample(x: number): number {
    const safeX = sanitizeLocal(x);

    if (this.lowSmoother.current !== this.targetLowDb) {
      const lowDb = this.lowSmoother.process(this.targetLowDb);
      if (
        Math.abs(lowDb - this.activeLowDb) > 2e-4 ||
        (lowDb === this.targetLowDb && Math.abs(lowDb - this.activeLowDb) > 1e-9)
      ) {
        this.activeLowDb = lowDb;
        this.lowBand.configure('lowshelf', 110, this.sampleRate, lowDb, 0.9);
      }
    }

    if (this.midSmoother.current !== this.targetMidDb) {
      const midDb = this.midSmoother.process(this.targetMidDb);
      if (
        Math.abs(midDb - this.activeMidDb) > 2e-4 ||
        (midDb === this.targetMidDb && Math.abs(midDb - this.activeMidDb) > 1e-9)
      ) {
        this.activeMidDb = midDb;
        this.midBand.configure('peaking', 850, this.sampleRate, midDb, 0.85);
      }
    }

    if (this.highSmoother.current !== this.targetHighDb) {
      const highDb = this.highSmoother.process(this.targetHighDb);
      if (
        Math.abs(highDb - this.activeHighDb) > 2e-4 ||
        (highDb === this.targetHighDb && Math.abs(highDb - this.activeHighDb) > 1e-9)
      ) {
        this.activeHighDb = highDb;
        this.highBand.configure('highshelf', 5500, this.sampleRate, highDb, 0.9);
      }
    }

    let y = this.lowBand.processSample(safeX);
    y = this.midBand.processSample(y);
    y = this.highBand.processSample(y);
    return sanitizeLocal(y);
  }

  public processBlock(buf: Float32Array, start: number, end: number): void {
    const subLen = end - start;
    if (subLen <= 0) return;

    if (this.lowSmoother.current !== this.targetLowDb) {
      let lowDb = this.activeLowDb;
      for (let k = 0; k < subLen; k++) {
        lowDb = this.lowSmoother.process(this.targetLowDb);
      }
      if (Math.abs(lowDb - this.targetLowDb) < 1e-5) {
        lowDb = this.targetLowDb;
        this.lowSmoother.reset(this.targetLowDb);
      }
      if (
        Math.abs(lowDb - this.activeLowDb) > 2e-4 ||
        (lowDb === this.targetLowDb && Math.abs(lowDb - this.activeLowDb) > 1e-9)
      ) {
        this.activeLowDb = lowDb;
        this.lowBand.configure('lowshelf', 110, this.sampleRate, lowDb, 0.9);
      }
    }

    if (this.midSmoother.current !== this.targetMidDb) {
      let midDb = this.activeMidDb;
      for (let k = 0; k < subLen; k++) {
        midDb = this.midSmoother.process(this.targetMidDb);
      }
      if (Math.abs(midDb - this.targetMidDb) < 1e-5) {
        midDb = this.targetMidDb;
        this.midSmoother.reset(this.targetMidDb);
      }
      if (
        Math.abs(midDb - this.activeMidDb) > 2e-4 ||
        (midDb === this.targetMidDb && Math.abs(midDb - this.activeMidDb) > 1e-9)
      ) {
        this.activeMidDb = midDb;
        this.midBand.configure('peaking', 850, this.sampleRate, midDb, 0.85);
      }
    }

    if (this.highSmoother.current !== this.targetHighDb) {
      let highDb = this.activeHighDb;
      for (let k = 0; k < subLen; k++) {
        highDb = this.highSmoother.process(this.targetHighDb);
      }
      if (Math.abs(highDb - this.targetHighDb) < 1e-5) {
        highDb = this.targetHighDb;
        this.highSmoother.reset(this.targetHighDb);
      }
      if (
        Math.abs(highDb - this.activeHighDb) > 2e-4 ||
        (highDb === this.targetHighDb && Math.abs(highDb - this.activeHighDb) > 1e-9)
      ) {
        this.activeHighDb = highDb;
        this.highBand.configure('highshelf', 5500, this.sampleRate, highDb, 0.9);
      }
    }

    this.lowBand.processBlock(buf, start, end);
    this.midBand.processBlock(buf, start, end);
    this.highBand.processBlock(buf, start, end);
  }

  private reconfigureAll(): void {
    this.lowBand.configure('lowshelf', 110, this.sampleRate, this.activeLowDb, 0.9);
    this.midBand.configure('peaking', 850, this.sampleRate, this.activeMidDb, 0.85);
    this.highBand.configure('highshelf', 5500, this.sampleRate, this.activeHighDb, 0.9);
  }
}
