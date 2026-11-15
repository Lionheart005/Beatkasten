import { clamp, sanitizeSampleRate } from '../dsp/smoothing';
import { wrapPhase01 } from '../math/waves';

/**
 * Sample-accurate musical master clock tracking continuous Float64 sample
 * count, BPM, time signature, beat/bar positions, and polymetric layer phases.
 */
export class MasterClock {
  private _sampleRate: number;
  private _totalSamples = 0;
  private _tempoBpm: number;
  private _beatsPerBar: number;

  constructor(sampleRate = 48000, tempoBpm = 130, beatsPerBar = 4) {
    this._sampleRate = sanitizeSampleRate(sampleRate);
    this._tempoBpm = clamp(tempoBpm, 20, 300);
    this._beatsPerBar = clamp(beatsPerBar, 1, 16);
  }

  public get sampleRate(): number {
    return this._sampleRate;
  }

  public get totalSamples(): number {
    return this._totalSamples;
  }

  public get tempoBpm(): number {
    return this._tempoBpm;
  }

  public get beatsPerBar(): number {
    return this._beatsPerBar;
  }

  public get samplesPerBeat(): number {
    return (60 / this._tempoBpm) * this._sampleRate;
  }

  public get beatPosition(): number {
    return (this._totalSamples * this._tempoBpm) / (60 * this._sampleRate);
  }

  public get barPosition(): number {
    return this.beatPosition / this._beatsPerBar;
  }

  public setSampleRate(sr: number): void {
    this._sampleRate = sanitizeSampleRate(sr);
  }

  public setTempoBpm(bpm: number): void {
    if (!Number.isFinite(bpm)) return;
    this._tempoBpm = clamp(bpm, 20, 300);
  }

  public setBeatsPerBar(beatsPerBar: number): void {
    if (!Number.isFinite(beatsPerBar)) return;
    this._beatsPerBar = clamp(beatsPerBar, 1, 16);
  }

  public setTimeSignature(numerator: number, denominator = 4): void {
    const num = Number.isFinite(numerator) && numerator > 0 ? numerator : 4;
    const den = Number.isFinite(denominator) && denominator > 0 ? denominator : 4;
    this._beatsPerBar = clamp(num * (4 / den), 1, 16);
  }

  public layerPhase(cycleBeats: number): number {
    const safeCycle = Number.isFinite(cycleBeats) && cycleBeats > 0 ? cycleBeats : 4;
    return wrapPhase01(this.beatPosition / safeCycle);
  }

  public cycleIndex(cycleBeats: number): number {
    const safeCycle = Number.isFinite(cycleBeats) && cycleBeats > 0 ? cycleBeats : 4;
    return Math.floor(this.beatPosition / safeCycle);
  }

  public advance(numSamples: number): void {
    if (!Number.isFinite(numSamples) || numSamples <= 0) return;
    this._totalSamples += Math.floor(numSamples);
  }

  public reset(): void {
    this._totalSamples = 0;
  }
}
