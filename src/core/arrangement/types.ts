/**
 * Data model of the second workspace "Timeline" (arrangement).
 * All positions are in BEATS (quarter notes) of the song tempo; the TempoMap
 * converts them to seconds / samples. Pure data, JSON-serialisable.
 */
import type { ProcessorCardConfig } from '../state/types';

export interface TempoMarker {
  readonly id: string;
  readonly beat: number;
  readonly bpm: number;
}

/** Time signature change; always placed on a bar line of the previous meter. */
export interface MeterMarker {
  readonly id: string;
  readonly beat: number;
  readonly numerator: number;
  readonly denominator: number;
}

/** Named position on the ruler ("Intro", "Drop" …). */
export interface SongMarker {
  readonly id: string;
  readonly beat: number;
  readonly name: string;
  readonly color: string;
}

export type FadeShape = 'linear' | 'equal-power' | 'exp' | 's-curve';

export interface FadeConfig {
  readonly beats: number;
  readonly shape: FadeShape;
}

/** Per-clip deviation from a layer of the referenced section. */
export interface LayerOverride {
  readonly enabled?: boolean;
  readonly level?: number;
  readonly pan?: number;
}

interface ClipBase {
  readonly id: string;
  readonly startBeat: number;
  readonly lengthBeats: number;
  /** 0..2 */
  readonly gain: number;
  readonly fadeIn: FadeConfig;
  readonly fadeOut: FadeConfig;
  readonly muted?: boolean;
  /** Set when a transition template created this clip (removable as a group). */
  readonly generatedBy?: string;
}

export interface SectionClip extends ClipBase {
  readonly kind: 'section';
  /** Live reference to a section of the Beatkasten. */
  readonly sectionId: string;
  /** Beat of the section loop where this clip starts playing. */
  readonly sourceOffsetBeats: number;
  /** key = layerId */
  readonly layerOverrides: Readonly<Record<string, LayerOverride>>;
  /** -12..+12 */
  readonly transposeSemitones?: number;
  /** Let reverb / echo ring out after the clip end (beats). */
  readonly tailBeats?: number;
  /** "Einfrieren": pre-rendered audio of this clip (plays instead of the live engine). */
  readonly frozenAssetId?: string;
  /** Freeze cache key; a stale key (section / clip changed) falls back to live playback. */
  readonly frozenKey?: string;
}

export interface AudioClip extends ClipBase {
  readonly kind: 'audio';
  readonly assetId: string;
  readonly sourceOffsetSec: number;
  readonly reversed?: boolean;
}

export type ArrangementClip = SectionClip | AudioClip;

export type TrackKind = 'section' | 'audio';

export interface ArrangementTrack {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly kind: TrackKind;
  readonly muted: boolean;
  readonly solo: boolean;
  /** 0..1.5 */
  readonly level: number;
  /** -1..1 */
  readonly pan: number;
  readonly fx: readonly ProcessorCardConfig[];
  readonly clips: readonly ArrangementClip[];
  /** Armed for recording (audio tracks). */
  readonly armed?: boolean;
  /** UI only. */
  readonly heightPx?: number;
}

export type KeyframeCurve = 'linear' | 'smooth' | 'hold' | 'exp';

export interface Keyframe {
  readonly beat: number;
  readonly value: number;
  readonly curve: KeyframeCurve;
}

export type AutomationTarget =
  | { readonly scope: 'master'; readonly param: 'gain' | 'glue' }
  | { readonly scope: 'master-fx'; readonly cardId: string; readonly paramId: string }
  | { readonly scope: 'track'; readonly trackId: string; readonly param: 'level' | 'pan' }
  | {
      readonly scope: 'track-fx';
      readonly trackId: string;
      readonly cardId: string;
      readonly paramId: string;
    }
  /** Beats relative to the clip start (moves with the clip). */
  | {
      readonly scope: 'clip-layer';
      readonly clipId: string;
      readonly layerId: string;
      readonly param: 'level' | 'pan' | 'enabled';
    }
  /** Any modulatable control of a layer inside one clip (e.g. bass filter over 16 bars). */
  | {
      readonly scope: 'clip-layer-param';
      readonly clipId: string;
      readonly layerId: string;
      readonly domain: 'voice' | 'processor';
      /** 'voice' for the voice, else the processor card id. */
      readonly cardId: string;
      readonly paramId: string;
    };

export interface AutomationLane {
  readonly id: string;
  readonly target: AutomationTarget;
  readonly enabled: boolean;
  /** Sorted by beat. */
  readonly points: readonly Keyframe[];
  readonly generatedBy?: string;
}

export type SnapGrid =
  | 'off'
  | 'bar'
  | '1/2'
  | '1/4'
  | '1/8'
  | '1/16'
  | '1/32'
  | '1/4T'
  | '1/8T'
  | '1/16T';

export interface ArrangementLoop {
  readonly enabled: boolean;
  readonly startBeat: number;
  readonly endBeat: number;
}

export interface ArrangementDoc {
  readonly version: 1;
  /** First marker always at beat 0. */
  readonly tempoMarkers: readonly TempoMarker[];
  /** First marker always at beat 0. */
  readonly meterMarkers: readonly MeterMarker[];
  readonly songMarkers: readonly SongMarker[];
  readonly tracks: readonly ArrangementTrack[];
  readonly masterFx: readonly ProcessorCardConfig[];
  readonly masterGain: number;
  readonly masterGlue: number;
  readonly automation: readonly AutomationLane[];
  readonly loop?: ArrangementLoop;
  readonly snap: { readonly enabled: boolean; readonly grid: SnapGrid };
}

export const DEFAULT_FADE: FadeConfig = { beats: 0, shape: 'equal-power' };

export const TRACK_COLORS = [
  '#a855f7',
  '#22d3ee',
  '#f59e0b',
  '#10b981',
  '#f43f5e',
  '#6366f1',
  '#84cc16',
  '#ec4899',
] as const;

export function clipEndBeat(clip: Pick<ClipBase, 'startBeat' | 'lengthBeats'>): number {
  return clip.startBeat + clip.lengthBeats;
}
