export type ControlDomain = 'time' | 'timbre' | 'space' | 'harmony' | 'modulation';

export type ParamCurve = 'linear' | 'exp' | 'bipolar';

export interface ParameterOption {
  readonly value: number;
  readonly label: string;
}

export interface ParameterSchema {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly domain: ControlDomain;
  readonly min: number;
  readonly max: number;
  readonly defaultValue: number;
  readonly step?: number;
  readonly curve?: ParamCurve;
  readonly modulatable: boolean;
  readonly unitLabel?: string;
  readonly options?: readonly ParameterOption[];
}

export interface ModuleDescriptor {
  readonly id: string;
  readonly version: number;
  readonly displayName: string;
  readonly description: string;
  readonly parameters: readonly ParameterSchema[];
}

export const LAYER_MIX_PARAMETERS: readonly ParameterSchema[] = [
  {
    id: 'level',
    label: 'Layer-Lautstärke (Pegel)',
    description: 'Steuert die Ausgangslautstärke des gesamten Layers.',
    domain: 'timbre',
    min: 0,
    max: 1.5,
    defaultValue: 0.8,
    curve: 'linear',
    modulatable: true,
  },
  {
    id: 'pan',
    label: 'Layer-Panorama (Pan)',
    description: 'Verteilt den Layer im Stereo-Bild (-1 = Links, 0 = Mitte, +1 = Rechts).',
    domain: 'timbre',
    min: -1,
    max: 1,
    defaultValue: 0,
    curve: 'bipolar',
    modulatable: true,
  },
];

export interface TimeEvalContext {
  readonly beatPosition: number;
  readonly barPosition: number;
  readonly layerPhase: number;
  readonly cycleIndex: number;
  readonly cycleBeats: number;
  readonly beatsPerBar: number;
  readonly sampleRate: number;
  /**
   * Per-operator-slot scratch memory owned by the engine; persists between
   * control sub-blocks (operators themselves are stateless and shared).
   */
  readonly slotState?: Float64Array;
  /** True when an earlier operator in the chain already generates pulses. */
  readonly hasPulseSource?: boolean;
}

export interface TimeFrame {
  readonly warpedPhase: number;
  readonly pulseEnergy: number;
  readonly triggerIntensity: number;
  readonly accent: number;
  readonly stepIndex: number;
  readonly pulseSlope?: number;
}

export interface MutableTimeFrame {
  warpedPhase: number;
  pulseEnergy: number;
  triggerIntensity: number;
  accent: number;
  stepIndex: number;
  pulseSlope: number;
}

export interface TimeOperatorModule extends ModuleDescriptor {
  evaluateTime(
    ctx: TimeEvalContext,
    params: Record<string, number>,
    prevFrame: TimeFrame,
  ): TimeFrame;
  /**
   * Optional zero-allocation variant writing the next frame into `outFrame`.
   * Audio hot paths prefer this when available to avoid per-subblock allocations.
   */
  evaluateTimeInto?(
    ctx: TimeEvalContext,
    params: Record<string, number>,
    prevFrame: TimeFrame,
    outFrame: MutableTimeFrame,
  ): void;
}

export type ChordTransitionType = 'cut' | 'glide' | 'crossfade';

export interface HarmonyFrame {
  readonly rootNote: number;
  /** Bass-register root of the current chord (MIDI ~30..41). */
  readonly rootMidi: number;
  readonly scaleId: string;
  readonly chordPreset: string;
  /** Chord-scale for melody voices (key scale with chord tones substituted). */
  readonly scaleNotesMidi: readonly number[];
  /** Voiced chord notes (ascending); voice-led when enabled. */
  readonly chordNotesMidi: readonly number[];
  readonly bassMidi?: number;
  /** Voicing of the following chord (for glide / crossfade transitions). */
  readonly nextChordNotesMidi?: readonly number[];
  readonly transitionType?: ChordTransitionType;
  /** 0..1 inside the transition window at the end of the current chord step. */
  readonly transitionProgress?: number;
  /** Index of the active chord step inside the progression. */
  readonly stepIndex?: number;
}

/** Pre-allocated, engine-owned harmony frame updated per render chunk (zero alloc). */
export interface MutableHarmonyFrame {
  rootNote: number;
  rootMidi: number;
  scaleId: string;
  chordPreset: string;
  scaleNotesMidi: readonly number[];
  chordNotesMidi: readonly number[];
  bassMidi: number;
  nextChordNotesMidi: readonly number[];
  transitionType: ChordTransitionType;
  transitionProgress: number;
  stepIndex: number;
}

export interface VoiceRenderContext {
  readonly sampleRate: number;
  readonly numSamples: number;
  readonly beatPosition: number;
  readonly beatsPerBar: number;
  readonly timeFrame: TimeFrame;
  readonly harmony: HarmonyFrame;
  readonly prevPulseTrigger: number;
}

export interface VoiceInstance {
  reset(): void;
  process(
    outL: Float32Array,
    outR: Float32Array,
    params: Record<string, number>,
    ctx: VoiceRenderContext,
  ): void;
}

export interface VoiceModule extends ModuleDescriptor {
  readonly category: 'rhythm' | 'bass' | 'harmony' | 'texture';
  createInstance(sampleRate: number): VoiceInstance;
}

export interface ProcessorContext {
  readonly sampleRate: number;
  readonly numSamples: number;
  readonly bpm: number;
  readonly harmony: HarmonyFrame;
  readonly layerPulseEnergy: number;
  readonly layerTrigger: number;
}

export interface ProcessorInstance {
  reset(): void;
  process(
    bufL: Float32Array,
    bufR: Float32Array,
    params: Record<string, number>,
    ctx: ProcessorContext,
  ): void;
}

export interface ProcessorModule extends ModuleDescriptor {
  readonly stage: 'shaper' | 'effect';
  createInstance(sampleRate: number): ProcessorInstance;
}

/**
 * Clamps a numeric parameter value to its schema bounds, falling back to
 * `schema.defaultValue` when the input is NaN or non-finite.
 */
export function clampParam(schema: ParameterSchema, value: number): number {
  const candidate = Number.isFinite(value) ? value : schema.defaultValue;
  const safeCandidate = Number.isFinite(candidate) ? candidate : schema.min;
  if (safeCandidate < schema.min) return schema.min;
  if (safeCandidate > schema.max) return schema.max;
  return safeCandidate;
}

/**
 * Builds a default parameter map for a module descriptor using clamped default values.
 */
export function buildDefaultParams(module: ModuleDescriptor): Record<string, number> {
  const result: Record<string, number> = {};
  for (const param of module.parameters) {
    result[param.id] = clampParam(param, param.defaultValue);
  }
  return result;
}
