import type { DrawnCurveData } from '../math/curves';
import type { WaveformType } from '../math/waves';
import type { CycleUnit } from '../theory/cycles';

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
  | 'macro-arc';

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
  };
  readonly targetDomain: ModulationTargetDomain;
  readonly targetCardId: string;
  readonly targetParamId: string;
  readonly combineMode: ModulationCombineMode;
  readonly depth: number;
}

export interface LayerConfig {
  readonly id: string;
  readonly name: string;
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
  readonly processorChain: readonly ProcessorCardConfig[];
  readonly modulations: readonly ModulationRouteConfig[];
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
}
