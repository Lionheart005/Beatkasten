import type { DrawnCurveData } from '../math/curves';
import type { WaveformType } from '../math/waves';
import type { CycleUnit } from '../theory/cycles';
import type { ChordStepConfig, ProgressionMode } from '../theory/progression';

import type { ArrangementDoc } from '../arrangement/types';
import type { AudioAssetMeta } from '../audio/types';

export type { ChordStepConfig, ProgressionMode };

export interface OperatorConfig {
  readonly id: string;
  readonly moduleId: string;
  readonly version: number;
  readonly bypassed: boolean;
  readonly params: Record<string, number>;
}

export interface ProcessorCardConfig {
  readonly id: string;
  readonly moduleId: string;
  readonly version: number;
  readonly bypassed: boolean;
  readonly params: Record<string, number>;
}

export type ModulationSourceType =
  | 'wave-lfo'
  | 'layer-pulse'
  | 'drawn-curve'
  | 'macro-arc'
  /** Timeline keyframes (written by the ArrangementEngine into a slot). */
  | 'external';

export type ModulationTargetDomain =
  | 'voice'
  | 'processor'
  | 'time'
  | 'modulation';

export type ModulationCombineMode = 'add' | 'multiply';

export interface ModulationRouteConfig {
  readonly id: string;
  readonly label?: string;
  readonly enabled: boolean;
  readonly sourceType: ModulationSourceType;
  readonly sourceConfig: {
    readonly sourceLayerId?: string;
    readonly waveform?: WaveformType;
    readonly cycleValue?: number;
    readonly cycleUnit?: CycleUnit;
    readonly phaseOffset?: number;
    readonly curveId?: string;
    /** 'external': slot index of the timeline value. */
    readonly externalSlot?: number;
  };
  readonly targetDomain: ModulationTargetDomain;
  readonly targetCardId: string;
  readonly targetParamId: string;
  readonly combineMode: ModulationCombineMode;
  readonly depth: number;
}

export interface SecondaryVoiceConfig {
  readonly enabled: boolean;
  readonly moduleId: string;
  readonly version: number;
  readonly mix: number;
  readonly params: Record<string, number>;
}

/**
 * Where a layer takes its notes from: the chord progression (default) or a
 * single fixed note, decoupled from the chords.
 */
export interface LayerPitchConfig {
  readonly mode: 'harmony' | 'fixed';
  /** Pitch class 0..11 (C..B) for mode 'fixed'. */
  readonly note: number;
  /** Octave offset (-2..+2) relative to the normal register. */
  readonly octave: number;
}

export interface LayerConfig {
  readonly id: string;
  readonly name: string;
  /** Optional group name for organising the layer stack (UI only). */
  readonly group?: string;
  readonly color: string;
  readonly enabled: boolean;
  readonly muted: boolean;
  readonly solo: boolean;
  readonly level: number;
  readonly pan: number;
  readonly cycleLength: {
    readonly value: number;
    readonly unit: CycleUnit;
  };
  readonly timeOperators: readonly OperatorConfig[];
  readonly voice: {
    readonly moduleId: string;
    readonly version: number;
    readonly params: Record<string, number>;
  };
  readonly secondaryVoice?: SecondaryVoiceConfig;
  /** Optional pitch source (default: follows the harmony). */
  readonly pitch?: LayerPitchConfig;
  readonly processorChain: readonly ProcessorCardConfig[];
  readonly modulations: readonly ModulationRouteConfig[];
  /** Sample instrument: which sound of the audio pool and how it is played. */
  readonly sample?: LayerSampleConfig;
}

export interface LayerSampleConfig {
  readonly assetId: string;
  readonly rootMidi: number;
  readonly startSec: number;
  readonly endSec: number;
  readonly loop?: { readonly startSec: number; readonly endSec: number; readonly crossfadeSec: number };
  /** Slice start points (seconds). */
  readonly slices?: readonly number[];
}

export interface BeatSnapshot {
  readonly id: string;
  readonly tempoBpm: number;
  readonly timeSignature: {
    readonly numerator: number;
    readonly denominator: number;
  };
  readonly masterGain: number;
  readonly masterGlue: number;
  readonly harmony: {
    readonly rootNote: number;
    readonly scaleId: string;
    readonly chordPreset: string;
    readonly progressionId: string;
    /** 'preset' (default) uses `progressionId`, 'custom' the builder steps. */
    readonly progressionMode?: ProgressionMode;
    readonly customSteps?: readonly ChordStepConfig[];
    /** Default true. */
    readonly voiceLeadingEnabled?: boolean;
  };
  readonly curves: readonly DrawnCurveData[];
  readonly layers: readonly LayerConfig[];
}

export interface SectionItem {
  readonly id: string;
  readonly name: string;
  readonly notes: string;
  readonly color: string;
  readonly exportBars: number;
  readonly snapshot: BeatSnapshot;
}

export interface HistoryNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly createdAt: number;
  readonly label: string;
  readonly bookmarked: boolean;
  readonly bookmarkName?: string;
  readonly snapshot: BeatSnapshot;
}

export interface ProjectDocument {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly updatedAt: number;
  readonly activeSnapshot: BeatSnapshot;
  readonly activeHistoryNodeId: string;
  readonly historyNodes: readonly HistoryNode[];
  readonly sections: readonly SectionItem[];
  /** Timeline workspace (absent in projects from before the timeline). */
  readonly arrangement?: ArrangementDoc;
  /** Audio pool metadata (PCM lives in the asset store, never in JSON). */
  readonly assets?: readonly AudioAssetMeta[];
}
