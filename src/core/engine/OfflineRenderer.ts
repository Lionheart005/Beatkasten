import { defaultRegistry } from '../defaultRegistry';
import { clamp, sanitizeSampleRate } from '../dsp/smoothing';
import { ModuleRegistry } from '../registry/ModuleRegistry';
import { type BeatSnapshot } from '../state/types';
import type { SampleSource } from '../registry/types';
import { computeFullRepeatBars } from './cycleMath';
import { TechnoEngine } from './TechnoEngine';

const OFFLINE_CHUNK_SIZE = 1024;

export interface OfflineRenderOptions {
  readonly sampleRate?: number;
  readonly bars: number;
  readonly preRollBars?: number;
  readonly isolateLayerId?: string;
  readonly registry?: ModuleRegistry;
  /** Audio pool for sample-instrument layers. */
  readonly sampleBank?: (assetId: string) => SampleSource | undefined;
}

export interface RenderedAudioBuffer {
  readonly left: Float32Array;
  readonly right: Float32Array;
  readonly sampleRate: number;
  readonly numSamples: number;
  readonly durationSeconds: number;
}

export interface StemRenderResult {
  readonly mix: {
    readonly left: Float32Array;
    readonly right: Float32Array;
  };
  readonly stems: ReadonlyArray<{
    readonly layerId: string;
    readonly layerName: string;
    readonly left: Float32Array;
    readonly right: Float32Array;
  }>;
  readonly sampleRate: number;
  readonly numSamples: number;
}

function computeBarSamples(snapshot: BeatSnapshot, sampleRate: number): number {
  const bpm = clamp(snapshot.tempoBpm, 20, 300);
  const num =
    Number.isFinite(snapshot.timeSignature.numerator) &&
    snapshot.timeSignature.numerator > 0
      ? snapshot.timeSignature.numerator
      : 4;
  const den =
    Number.isFinite(snapshot.timeSignature.denominator) &&
    snapshot.timeSignature.denominator > 0
      ? snapshot.timeSignature.denominator
      : 4;
  const beatsPerBar = clamp(num * (4 / den), 1, 16);
  const samplesPerBeat = (60 / bpm) * sampleRate;
  return samplesPerBeat * beatsPerBar;
}

/**
 * Deterministically renders a sample-accurate seamless loop from a BeatSnapshot.
 * Optional `preRollBars` are rendered first and discarded so delay and reverb
 * tails are fully settled before sample 0 of the loop.
 */
export function renderOfflineLoop(
  snapshot: BeatSnapshot,
  options: OfflineRenderOptions,
): RenderedAudioBuffer {
  const sampleRate = sanitizeSampleRate(options.sampleRate ?? 48000);
  const bars = Math.max(1, Number.isFinite(options.bars) ? options.bars : 1);
  const preRollBars = Math.max(
    0,
    Number.isFinite(options.preRollBars) ? options.preRollBars! : 0,
  );
  const registry = options.registry ?? defaultRegistry;

  const samplesPerBar = computeBarSamples(snapshot, sampleRate);
  const preRollSamples = Math.round(preRollBars * samplesPerBar);
  const loopSamples = Math.max(1, Math.round(bars * samplesPerBar));

  const engine = new TechnoEngine(sampleRate, registry, OFFLINE_CHUNK_SIZE);
  engine.setSampleBank(options.sampleBank ?? null);
  engine.reset();
  engine.applySnapshot(snapshot);
  engine.setIsolatedLayerId(options.isolateLayerId ?? null);

  const chunkL = new Float32Array(OFFLINE_CHUNK_SIZE);
  const chunkR = new Float32Array(OFFLINE_CHUNK_SIZE);

  // Start the pre-roll early enough that the exported loop begins on a
  // multiple of the loop length (musically "bar 1" when the loop length is a
  // multiple of the full repetition) instead of in the middle of the pattern.
  if (preRollSamples > 0) {
    const beatsPerBar = samplesPerBar / ((60 / clamp(snapshot.tempoBpm, 20, 300)) * sampleRate);
    const loopBeats = bars * beatsPerBar;
    const preRollBeats = preRollBars * beatsPerBar;
    const loopsBack = Math.ceil(preRollBeats / loopBeats - 1e-9);
    engine.seekToBeat(loopsBack * loopBeats - preRollBeats);
  }

  // Render and discard pre-roll bars so spatial tails (delay/reverb) settle.
  let remainingPreRoll = preRollSamples;
  while (remainingPreRoll > 0) {
    const chunk = Math.min(OFFLINE_CHUNK_SIZE, remainingPreRoll);
    engine.processBlock(chunkL, chunkR, chunk);
    remainingPreRoll -= chunk;
  }

  // Render exact loop length
  const left = new Float32Array(loopSamples);
  const right = new Float32Array(loopSamples);
  let written = 0;

  while (written < loopSamples) {
    const chunk = Math.min(OFFLINE_CHUNK_SIZE, loopSamples - written);
    engine.processBlock(chunkL, chunkR, chunk);
    for (let i = 0; i < chunk; i++) {
      left[written + i] = chunkL[i]!;
      right[written + i] = chunkR[i]!;
    }
    written += chunk;
  }

  return {
    left,
    right,
    sampleRate,
    numSamples: loopSamples,
    durationSeconds: loopSamples / sampleRate,
  };
}

export interface SongChainPart {
  readonly snapshot: BeatSnapshot;
  readonly bars: number;
  readonly name?: string;
}

export interface SongChainRenderOptions {
  readonly sampleRate?: number;
  readonly preRollBars?: number;
  /** Extra Takte am Ende, in denen Hall & Echo ausklingen (Klang des letzten Abschnitts läuft leise aus). */
  readonly tailBars?: number;
  readonly registry?: ModuleRegistry;
  readonly sampleBank?: (assetId: string) => SampleSource | undefined;
}

/**
 * Renders all song sections back to back with ONE continuous engine: at every
 * section boundary the next snapshot is applied (built-in ~15 ms crossfade),
 * so reverb/echo tails and the bar grid run straight through like a live set.
 */
export function renderSongChain(
  parts: readonly SongChainPart[],
  options: SongChainRenderOptions = {},
): RenderedAudioBuffer & { readonly partStartSamples: readonly number[] } {
  const valid = parts.filter((p) => p && p.snapshot && Number.isFinite(p.bars) && p.bars > 0);
  if (valid.length === 0) throw new Error('Song-Kette ist leer (keine Abschnitte mit Takten).');
  const sampleRate = sanitizeSampleRate(options.sampleRate ?? 48000);
  const registry = options.registry ?? defaultRegistry;
  const preRollBars = Math.max(0, options.preRollBars ?? 0);
  const tailBars = Math.max(0, options.tailBars ?? 0);

  const partSamples = valid.map((p) => Math.max(1, Math.round(p.bars * computeBarSamples(p.snapshot, sampleRate))));
  const firstBar = computeBarSamples(valid[0]!.snapshot, sampleRate);
  const lastBar = computeBarSamples(valid[valid.length - 1]!.snapshot, sampleRate);
  const tailSamples = Math.round(tailBars * lastBar);
  const total = partSamples.reduce((a, b) => a + b, 0) + tailSamples;

  const engine = new TechnoEngine(sampleRate, registry, OFFLINE_CHUNK_SIZE);
  engine.setSampleBank(options.sampleBank ?? null);
  engine.reset();
  engine.applySnapshot(valid[0]!.snapshot);
  const chunkL = new Float32Array(OFFLINE_CHUNK_SIZE);
  const chunkR = new Float32Array(OFFLINE_CHUNK_SIZE);

  if (preRollBars > 0) {
    // Der Song soll (musikalisch) bei Takt 1 beginnen: Vorlauf so starten, dass er
    // auf einem gemeinsamen Vielfachen aller Zyklen des 1. Abschnitts (und 64 Takten) endet.
    const beatsPerBar = firstBar / ((60 / clamp(valid[0]!.snapshot.tempoBpm, 20, 300)) * sampleRate);
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const rep = Math.max(1, Math.round(computeFullRepeatBars(valid[0]!.snapshot)));
    const alignBars = (rep * 64) / gcd(rep, 64);
    const startBars = Math.ceil(preRollBars / alignBars) * alignBars;
    engine.seekToBeat((startBars - preRollBars) * beatsPerBar);
    let remaining = Math.round(preRollBars * firstBar);
    while (remaining > 0) {
      const n = Math.min(OFFLINE_CHUNK_SIZE, remaining);
      engine.processBlock(chunkL, chunkR, n);
      remaining -= n;
    }
  }

  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const partStartSamples: number[] = [];
  let written = 0;
  for (let p = 0; p < valid.length; p++) {
    if (p > 0) engine.applySnapshot(valid[p]!.snapshot);
    partStartSamples.push(written);
    const end = written + partSamples[p]!;
    while (written < end) {
      const n = Math.min(OFFLINE_CHUNK_SIZE, end - written);
      engine.processBlock(chunkL, chunkR, n);
      left.set(chunkL.subarray(0, n), written);
      right.set(chunkR.subarray(0, n), written);
      written += n;
    }
  }
  // Ausklang: letzter Abschnitt läuft weiter, wird aber sanft ausgeblendet.
  const tailStart = written;
  while (written < total) {
    const n = Math.min(OFFLINE_CHUNK_SIZE, total - written);
    engine.processBlock(chunkL, chunkR, n);
    for (let i = 0; i < n; i++) {
      const t = (written + i - tailStart) / Math.max(1, tailSamples);
      const g = Math.cos(Math.min(1, t) * Math.PI * 0.5);
      left[written + i] = chunkL[i]! * g * g;
      right[written + i] = chunkR[i]! * g * g;
    }
    written += n;
  }

  return {
    left,
    right,
    sampleRate,
    numSamples: total,
    durationSeconds: total / sampleRate,
    partStartSamples,
  };
}

/**
 * Renders both the full stereo mix and individual isolated stems for every
 * layer in the snapshot while keeping inter-layer pulse sidechains active.
 */
export function renderStems(
  snapshot: BeatSnapshot,
  options: Omit<OfflineRenderOptions, 'isolateLayerId'>,
): StemRenderResult {
  const mixResult = renderOfflineLoop(snapshot, options);
  const stems: Array<{
    readonly layerId: string;
    readonly layerName: string;
    readonly left: Float32Array;
    readonly right: Float32Array;
  }> = [];

  for (let i = 0; i < snapshot.layers.length; i++) {
    const layer = snapshot.layers[i]!;
    const stemResult = renderOfflineLoop(snapshot, {
      ...options,
      isolateLayerId: layer.id,
    });
    stems.push({
      layerId: layer.id,
      layerName: layer.name,
      left: stemResult.left,
      right: stemResult.right,
    });
  }

  return {
    mix: {
      left: mixResult.left,
      right: mixResult.right,
    },
    stems,
    sampleRate: mixResult.sampleRate,
    numSamples: mixResult.numSamples,
  };
}
