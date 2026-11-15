import { defaultRegistry } from '../defaultRegistry';
import { clamp, sanitizeSampleRate } from '../dsp/smoothing';
import { ModuleRegistry } from '../registry/ModuleRegistry';
import { type BeatSnapshot } from '../state/types';
import { TechnoEngine } from './TechnoEngine';

const OFFLINE_CHUNK_SIZE = 1024;

export interface OfflineRenderOptions {
  readonly sampleRate?: number;
  readonly bars: number;
  readonly preRollBars?: number;
  readonly isolateLayerId?: string;
  readonly registry?: ModuleRegistry;
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
  engine.reset();
  engine.applySnapshot(snapshot);
  engine.setIsolatedLayerId(options.isolateLayerId ?? null);

  const chunkL = new Float32Array(OFFLINE_CHUNK_SIZE);
  const chunkR = new Float32Array(OFFLINE_CHUNK_SIZE);

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
