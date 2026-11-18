/**
 * TempoMap: converts between song beats (quarter notes), seconds and samples
 * using step tempo markers, and counts bars across time-signature changes.
 * Immutable; build once per arrangement change. Lookups do not allocate.
 */
import type { MeterMarker, TempoMarker } from './types';

export const MIN_BPM = 20;
export const MAX_BPM = 300;

const clampBpm = (bpm: number): number =>
  Number.isFinite(bpm) ? Math.min(MAX_BPM, Math.max(MIN_BPM, bpm)) : 130;

export function beatsPerBarOf(numerator: number, denominator: number): number {
  const num = Number.isFinite(numerator) && numerator > 0 ? numerator : 4;
  const den = Number.isFinite(denominator) && denominator > 0 ? denominator : 4;
  return Math.min(16, Math.max(1, num * (4 / den)));
}

export interface BarPosition {
  /** 0-based bar index. */
  readonly bar: number;
  /** Beat inside the bar (0-based, fractional). */
  readonly beatInBar: number;
  readonly beatsPerBar: number;
  readonly numerator: number;
  readonly denominator: number;
}

export class TempoMap {
  /** Tempo segment start beats / bpm / start seconds. */
  private readonly tBeat: Float64Array;
  private readonly tBpm: Float64Array;
  private readonly tSec: Float64Array;
  /** Meter segment start beats / beats per bar / bar index at start. */
  private readonly mBeat: Float64Array;
  private readonly mBpb: Float64Array;
  private readonly mBar: Float64Array;
  private readonly mNum: Int32Array;
  private readonly mDen: Int32Array;

  constructor(tempoMarkers: readonly TempoMarker[], meterMarkers: readonly MeterMarker[]) {
    const tempos = normalizeTempoMarkers(tempoMarkers);
    this.tBeat = new Float64Array(tempos.length);
    this.tBpm = new Float64Array(tempos.length);
    this.tSec = new Float64Array(tempos.length);
    let sec = 0;
    for (let i = 0; i < tempos.length; i++) {
      const m = tempos[i]!;
      if (i > 0) {
        const prev = tempos[i - 1]!;
        sec += ((m.beat - prev.beat) * 60) / prev.bpm;
      }
      this.tBeat[i] = m.beat;
      this.tBpm[i] = m.bpm;
      this.tSec[i] = sec;
    }

    const meters = normalizeMeterMarkers(meterMarkers);
    this.mBeat = new Float64Array(meters.length);
    this.mBpb = new Float64Array(meters.length);
    this.mBar = new Float64Array(meters.length);
    this.mNum = new Int32Array(meters.length);
    this.mDen = new Int32Array(meters.length);
    let bar = 0;
    for (let i = 0; i < meters.length; i++) {
      const m = meters[i]!;
      const bpb = beatsPerBarOf(m.numerator, m.denominator);
      if (i > 0) {
        bar += Math.round((m.beat - this.mBeat[i - 1]!) / this.mBpb[i - 1]!);
      }
      this.mBeat[i] = m.beat;
      this.mBpb[i] = bpb;
      this.mBar[i] = bar;
      this.mNum[i] = m.numerator;
      this.mDen[i] = m.denominator;
    }
  }

  // --- tempo -------------------------------------------------------------

  private tempoIndexAtBeat(beat: number): number {
    const arr = this.tBeat;
    let lo = 0;
    let hi = arr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (arr[mid]! <= beat) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private tempoIndexAtSec(sec: number): number {
    const arr = this.tSec;
    let lo = 0;
    let hi = arr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (arr[mid]! <= sec) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  public bpmAt(beat: number): number {
    return this.tBpm[this.tempoIndexAtBeat(beat)]!;
  }

  public beatToSec(beat: number): number {
    const i = this.tempoIndexAtBeat(beat);
    return this.tSec[i]! + ((beat - this.tBeat[i]!) * 60) / this.tBpm[i]!;
  }

  public secToBeat(sec: number): number {
    const i = this.tempoIndexAtSec(sec);
    return this.tBeat[i]! + ((sec - this.tSec[i]!) * this.tBpm[i]!) / 60;
  }

  /** Sample index of a beat (rounded; the single source of truth for event positions). */
  public beatToSample(beat: number, sampleRate: number): number {
    return Math.round(this.beatToSec(beat) * sampleRate);
  }

  public sampleToBeat(sample: number, sampleRate: number): number {
    return this.secToBeat(sample / sampleRate);
  }

  /** First tempo change strictly after `beat`, or Infinity. */
  public nextTempoChangeBeat(beat: number): number {
    const i = this.tempoIndexAtBeat(beat);
    return i + 1 < this.tBeat.length ? this.tBeat[i + 1]! : Infinity;
  }

  public get tempoMarkerCount(): number {
    return this.tBeat.length;
  }

  public tempoMarkerBeat(i: number): number {
    return this.tBeat[i]!;
  }

  // --- meter / bars ------------------------------------------------------

  private meterIndexAtBeat(beat: number): number {
    const arr = this.mBeat;
    let lo = 0;
    let hi = arr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (arr[mid]! <= beat + 1e-9) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private meterIndexAtBar(bar: number): number {
    const arr = this.mBar;
    let lo = 0;
    let hi = arr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (arr[mid]! <= bar) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  public beatsPerBarAt(beat: number): number {
    return this.mBpb[this.meterIndexAtBeat(beat)]!;
  }

  public meterAt(beat: number): { numerator: number; denominator: number; beatsPerBar: number } {
    const i = this.meterIndexAtBeat(beat);
    return { numerator: this.mNum[i]!, denominator: this.mDen[i]!, beatsPerBar: this.mBpb[i]! };
  }

  /** Start beat of the 0-based bar `n` (negative bars extend the first meter). */
  public barStartBeat(n: number): number {
    const i = n < 0 ? 0 : this.meterIndexAtBar(n);
    return this.mBeat[i]! + (n - this.mBar[i]!) * this.mBpb[i]!;
  }

  public barPosition(beat: number): BarPosition {
    const i = this.meterIndexAtBeat(beat);
    const bpb = this.mBpb[i]!;
    const rel = beat - this.mBeat[i]!;
    const barsIn = Math.floor(rel / bpb + 1e-9);
    return {
      bar: this.mBar[i]! + barsIn,
      beatInBar: Math.max(0, rel - barsIn * bpb),
      beatsPerBar: bpb,
      numerator: this.mNum[i]!,
      denominator: this.mDen[i]!,
    };
  }

  /** "Takt:Beat" label, 1-based (e.g. "17:3"). */
  public formatPosition(beat: number): string {
    const p = this.barPosition(beat);
    return `${p.bar + 1}:${Math.floor(p.beatInBar + 1e-6) + 1}`;
  }
}

function normalizeTempoMarkers(markers: readonly TempoMarker[]): TempoMarker[] {
  const valid = markers
    .filter((m) => m && Number.isFinite(m.beat) && m.beat >= 0)
    .map((m) => ({ ...m, bpm: clampBpm(m.bpm) }))
    .sort((a, b) => a.beat - b.beat);
  const out: TempoMarker[] = [];
  for (const m of valid) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.beat - m.beat) < 1e-9) out[out.length - 1] = m;
    else out.push(m);
  }
  if (out.length === 0 || out[0]!.beat > 0) {
    out.unshift({ id: 'tempo-0', beat: 0, bpm: out[0]?.bpm ?? 130 });
  }
  return out;
}

function normalizeMeterMarkers(markers: readonly MeterMarker[]): MeterMarker[] {
  const valid = markers
    .filter((m) => m && Number.isFinite(m.beat) && m.beat >= 0)
    .sort((a, b) => a.beat - b.beat);
  const out: MeterMarker[] = [];
  for (const m of valid) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.beat - m.beat) < 1e-9) {
      out[out.length - 1] = m;
      continue;
    }
    if (last) {
      // Snap onto a bar line of the previous meter.
      const bpb = beatsPerBarOf(last.numerator, last.denominator);
      const bars = Math.max(1, Math.round((m.beat - last.beat) / bpb));
      out.push({ ...m, beat: last.beat + bars * bpb });
    } else {
      out.push(m);
    }
  }
  if (out.length === 0 || out[0]!.beat > 0) {
    out.unshift({
      id: 'meter-0',
      beat: 0,
      numerator: out[0]?.numerator ?? 4,
      denominator: out[0]?.denominator ?? 4,
    });
  }
  return out;
}

export function tempoMapOf(doc: {
  readonly tempoMarkers: readonly TempoMarker[];
  readonly meterMarkers: readonly MeterMarker[];
}): TempoMap {
  return new TempoMap(doc.tempoMarkers, doc.meterMarkers);
}
