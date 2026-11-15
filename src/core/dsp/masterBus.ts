import { LR4SubMonoCrossover } from './spatial';
import {
  clamp,
  flushDenormal,
  OnePoleSmoother,
  sanitizeSample,
  sanitizeSampleRate,
  StereoDCBlocker,
} from './smoothing';

const MASTER_CEILING = 0.944; // ~ -0.5 dBFS

/**
 * Master stereo bus processor:
 * 1. LR4 110 Hz sub-bass mono enforcement
 * 2. Gentle analog-glue soft clipper (`tanh` with unity RMS calibration)
 * 3. Stereo 18 Hz DC blocker
 * 4. Lookahead peak limiter with hard ceiling <= 0.944 (-0.5 dBFS)
 */
export class MasterBus {
  private sampleRate: number;
  private readonly subMonoCrossover: LR4SubMonoCrossover;
  private readonly dcBlocker: StereoDCBlocker;
  private readonly gainSmoother: OnePoleSmoother;
  private readonly glueSmoother: OnePoleSmoother;

  private lookaheadSamples = 72;
  private bufferSize = 0;
  private lookaheadBufL!: Float32Array;
  private lookaheadBufR!: Float32Array;
  private writeIdx = 0;

  private gainEnv = 1.0;
  private attackCoeff = 0.1;
  private releaseCoeff = 0.0003;

  constructor(sampleRate = 48000) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.subMonoCrossover = new LR4SubMonoCrossover(this.sampleRate, 110);
    this.dcBlocker = new StereoDCBlocker(this.sampleRate, 18);
    this.gainSmoother = new OnePoleSmoother(this.sampleRate, 10, 1.0);
    this.glueSmoother = new OnePoleSmoother(this.sampleRate, 15, 0.2);

    this.allocateLookahead(this.sampleRate);
    this.updateLimiterCoeffs();
  }

  public setSampleRate(sr: number): void {
    this.sampleRate = sanitizeSampleRate(sr);
    this.subMonoCrossover.setSampleRate(this.sampleRate);
    this.dcBlocker.setSampleRate(this.sampleRate);
    this.gainSmoother.setSampleRate(this.sampleRate);
    this.glueSmoother.setSampleRate(this.sampleRate);

    const needed = Math.ceil(0.004 * this.sampleRate) + 8;
    if (needed > this.bufferSize) {
      this.allocateLookahead(this.sampleRate);
    } else {
      this.lookaheadBufL.fill(0);
      this.lookaheadBufR.fill(0);
      this.writeIdx = 0;
    }
    this.updateLimiterCoeffs();
  }

  public reset(): void {
    this.subMonoCrossover.reset();
    this.dcBlocker.reset();
    this.gainSmoother.reset(1.0);
    this.glueSmoother.reset(0.2);
    this.lookaheadBufL.fill(0);
    this.lookaheadBufR.fill(0);
    this.writeIdx = 0;
    this.gainEnv = 1.0;
  }

  public processBlock(
    bufL: Float32Array | Float64Array,
    bufR: Float32Array | Float64Array,
    numSamples: number,
    masterGain = 1.0,
    glueDrive = 0.2
  ): void {
    const count = Math.min(numSamples | 0, bufL.length, bufR.length);
    if (count <= 0) return;

    const targetGain = clamp(masterGain, 0, 2.0);
    const targetGlue = clamp(glueDrive, 0, 1.0);

    const len = this.bufferSize;
    const delay = this.lookaheadSamples;

    for (let i = 0; i < count; i++) {
      const inL = sanitizeSample(bufL[i]);
      const inR = sanitizeSample(bufR[i]);

      // 1. Sub-Mono check < 110 Hz
      this.subMonoCrossover.process(inL, inR);
      const gain = this.gainSmoother.process(targetGain);
      const glue = this.glueSmoother.process(targetGlue);

      const gL = this.subMonoCrossover.outL * gain;
      const gR = this.subMonoCrossover.outR * gain;

      // 2. Subtle analog-glue soft clipper
      const drive = 1 + glue * 1.5;
      const norm = 1 / (1 + glue * 0.75);
      const satL = Math.tanh(gL * drive) * norm;
      const satR = Math.tanh(gR * drive) * norm;
      const glueBlend = glue < 0.05 ? glue / 0.05 : 1;
      const gluedL = gL + glueBlend * (satL - gL);
      const gluedR = gR + glueBlend * (satR - gR);

      // 3. Stereo DC Blocker
      this.dcBlocker.process(gluedL, gluedR);
      const cleanL = sanitizeSample(this.dcBlocker.outL);
      const cleanR = sanitizeSample(this.dcBlocker.outR);

      // 4. Lookahead Peak Limiter (ceiling <= 0.944)
      const wIdx = this.writeIdx;
      let rIdx = wIdx - delay;
      if (rIdx < 0) rIdx += len;

      const delL = this.lookaheadBufL[rIdx];
      const delR = this.lookaheadBufR[rIdx];

      this.lookaheadBufL[wIdx] = flushDenormal(cleanL);
      this.lookaheadBufR[wIdx] = flushDenormal(cleanR);
      this.writeIdx = wIdx + 1 >= len ? 0 : wIdx + 1;

      const lookaheadPeak = Math.max(Math.abs(cleanL), Math.abs(cleanR));
      const targetEnv = lookaheadPeak > MASTER_CEILING ? MASTER_CEILING / lookaheadPeak : 1.0;

      const coeff = targetEnv < this.gainEnv ? this.attackCoeff : this.releaseCoeff;
      this.gainEnv = clamp(this.gainEnv + coeff * (targetEnv - this.gainEnv), 0, 1.0);

      const delayedPeak = Math.max(Math.abs(delL), Math.abs(delR));
      const safeGain =
        delayedPeak > MASTER_CEILING
          ? Math.min(this.gainEnv, MASTER_CEILING / delayedPeak)
          : this.gainEnv;

      bufL[i] = clamp(delL * safeGain, -MASTER_CEILING, MASTER_CEILING);
      bufR[i] = clamp(delR * safeGain, -MASTER_CEILING, MASTER_CEILING);
    }
  }

  private allocateLookahead(sr: number): void {
    const maxLen = Math.ceil(0.004 * Math.max(96000, sr)) + 8;
    this.bufferSize = maxLen;
    this.lookaheadBufL = new Float32Array(maxLen);
    this.lookaheadBufR = new Float32Array(maxLen);
    this.writeIdx = 0;
  }

  private updateLimiterCoeffs(): void {
    this.lookaheadSamples = clamp(
      Math.round(0.0015 * this.sampleRate),
      1,
      this.bufferSize - 2
    );
    this.attackCoeff = clamp(1 - Math.exp(-6.0 / this.lookaheadSamples), 0.01, 1);
    this.releaseCoeff = clamp(1 - Math.exp(-1 / (0.075 * this.sampleRate)), 0.00001, 1);
  }
}
