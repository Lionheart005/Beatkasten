/**
 * Offline rendering of the timeline (export worker / tests). Uses the same
 * ArrangementEngine as live playback, so the export sounds exactly like the
 * timeline. Optional stems render each track solo.
 */
import type { ModuleRegistry } from '../registry/ModuleRegistry';
import type { BeatSnapshot } from '../state/types';
import { ArrangementEngine, type AudioAssetLookup } from './ArrangementEngine';
import { songEndBeat } from './edit';
import type { ArrangementDoc } from './types';

const OFFLINE_CHUNK = 1024;

export interface RenderArrangementOptions {
  readonly sampleRate?: number;
  /** Render only this beat range (default: 0 … song end). */
  readonly startBeat?: number;
  readonly endBeat?: number;
  /** Extra seconds at the end so reverb / echo can ring out (default 2 s). */
  readonly tailSeconds?: number;
  readonly registry?: ModuleRegistry;
  readonly assets?: AudioAssetLookup;
  /** Render only this track (stem). */
  readonly soloTrackId?: string;
  /** Max. parallel section players (offline default 16). */
  readonly maxPlayers?: number;
  /** See ArrangementEngineOptions.outputStage (bounce / freeze). */
  readonly outputStage?: 'master' | 'pre-master' | 'raw-clips';
}

export interface RenderedArrangement {
  readonly left: Float32Array;
  readonly right: Float32Array;
  readonly sampleRate: number;
  readonly numSamples: number;
  readonly durationSeconds: number;
}

export function sectionMapOf(
  sections: ReadonlyArray<{ readonly id: string; readonly snapshot: BeatSnapshot }>,
): Map<string, BeatSnapshot> {
  return new Map(sections.map((s) => [s.id, s.snapshot]));
}

export function renderArrangement(
  doc: ArrangementDoc,
  sections: ReadonlyMap<string, BeatSnapshot>,
  options: RenderArrangementOptions = {},
): RenderedArrangement {
  const sampleRate = options.sampleRate ?? 48000;
  const renderDoc: ArrangementDoc = options.soloTrackId
    ? {
        ...doc,
        tracks: doc.tracks.map((t) => ({ ...t, solo: t.id === options.soloTrackId, muted: t.id !== options.soloTrackId })),
      }
    : doc;
  const engine = new ArrangementEngine(sampleRate, {
    maxPlayers: options.maxPlayers ?? 16,
    maxBlockSize: OFFLINE_CHUNK,
    registry: options.registry,
    useLoop: false,
    outputStage: options.outputStage,
  });
  if (options.assets) engine.setAssetLookup(options.assets);
  engine.setArrangement(renderDoc, sections);
  const tm = engine.getCompiled().tempoMap;
  const startBeat = Math.max(0, options.startBeat ?? 0);
  const endBeat = Math.max(startBeat + 1 / 32, options.endBeat ?? Math.max(songEndBeat(doc), 1));
  const tail = Math.max(0, options.tailSeconds ?? 2);
  const startSample = tm.beatToSample(startBeat, sampleRate);
  const total = Math.max(1, tm.beatToSample(endBeat, sampleRate) - startSample + Math.round(tail * sampleRate));
  engine.seekToBeat(startBeat);

  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const cL = new Float32Array(OFFLINE_CHUNK);
  const cR = new Float32Array(OFFLINE_CHUNK);
  let written = 0;
  while (written < total) {
    const n = Math.min(OFFLINE_CHUNK, total - written);
    engine.processBlock(cL, cR, n);
    left.set(cL.subarray(0, n), written);
    right.set(cR.subarray(0, n), written);
    written += n;
  }
  return { left, right, sampleRate, numSamples: total, durationSeconds: total / sampleRate };
}
