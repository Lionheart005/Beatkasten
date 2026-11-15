import type { HarmonyFrame } from '../registry/types';
import { getScaleNotesInRange, normalizePitchClass } from './scales';

export type ChordPresetId =
  | 'minor'
  | 'minor7'
  | 'sus2'
  | 'sus4'
  | 'power5'
  | 'minor9'
  | 'dim';

export interface ChordPreset {
  readonly id: ChordPresetId;
  readonly label: string;
  readonly intervals: readonly number[];
}

export const CHORD_PRESETS: Readonly<Record<ChordPresetId, ChordPreset>> = {
  minor: {
    id: 'minor',
    label: 'Moll',
    intervals: [0, 3, 7],
  },
  minor7: {
    id: 'minor7',
    label: 'Moll 7',
    intervals: [0, 3, 7, 10],
  },
  sus2: {
    id: 'sus2',
    label: 'Sus2',
    intervals: [0, 2, 7],
  },
  sus4: {
    id: 'sus4',
    label: 'Sus4',
    intervals: [0, 5, 7],
  },
  power5: {
    id: 'power5',
    label: 'Powerchord (5)',
    intervals: [0, 7, 12],
  },
  minor9: {
    id: 'minor9',
    label: 'Moll 9',
    intervals: [0, 3, 7, 10, 14],
  },
  dim: {
    id: 'dim',
    label: 'Vermindert',
    intervals: [0, 3, 6],
  },
};

export type ProgressionId =
  | 'static'
  | 'hypnotic_i_VI'
  | 'classic_i_VI_VII_i'
  | 'phrygian_i_II';

export interface ProgressionPreset {
  readonly id: ProgressionId;
  readonly label: string;
  /** Semitone offsets per bar relative to the base root note. */
  readonly semitoneOffsets: readonly number[];
}

export const PROGRESSION_PRESETS: Readonly<Record<ProgressionId, ProgressionPreset>> = {
  static: {
    id: 'static',
    label: 'Statisch (i)',
    semitoneOffsets: [0],
  },
  hypnotic_i_VI: {
    id: 'hypnotic_i_VI',
    label: 'Hypnotisch (i – VI)',
    semitoneOffsets: [0, 0, -4, -4],
  },
  classic_i_VI_VII_i: {
    id: 'classic_i_VI_VII_i',
    label: 'Klassisch (i – VI – VII – i)',
    semitoneOffsets: [0, -4, -2, 0],
  },
  phrygian_i_II: {
    id: 'phrygian_i_II',
    label: 'Phrygisch (i – bII)',
    semitoneOffsets: [0, 0, 1, 0],
  },
};

function getChordPreset(chordPreset: string): ChordPreset {
  if (Object.prototype.hasOwnProperty.call(CHORD_PRESETS, chordPreset)) {
    return CHORD_PRESETS[chordPreset as ChordPresetId];
  }
  return CHORD_PRESETS.minor;
}

function getProgressionPreset(progressionId: string): ProgressionPreset {
  if (Object.prototype.hasOwnProperty.call(PROGRESSION_PRESETS, progressionId)) {
    return PROGRESSION_PRESETS[progressionId as ProgressionId];
  }
  return PROGRESSION_PRESETS.static;
}

/**
 * Computes the active HarmonyFrame for a given bar index, scale, chord preset, and progression.
 */
export function computeHarmonyFrame(
  rootNote: number,
  scaleId: string,
  chordPreset: string,
  progressionId: string,
  barIndex: number,
): HarmonyFrame {
  const baseRoot = normalizePitchClass(rootNote);
  const progression = getProgressionPreset(progressionId);
  const chord = getChordPreset(chordPreset);

  const steps = progression.semitoneOffsets;
  const safeBar = Number.isFinite(barIndex) ? Math.floor(barIndex) : 0;
  const stepIndex = ((safeBar % steps.length) + steps.length) % steps.length;
  const semitoneOffset = steps[stepIndex] ?? 0;

  const rootMidi = 36 + baseRoot + semitoneOffset;
  const effectiveRootNote = normalizePitchClass(baseRoot + semitoneOffset);

  const scaleNotesMidi = getScaleNotesInRange(effectiveRootNote, scaleId, 24, 96);
  const chordBaseMidi = rootMidi + 12;
  const chordNotesMidi = chord.intervals.map((interval) => chordBaseMidi + interval);

  return {
    rootNote: effectiveRootNote,
    rootMidi,
    scaleId,
    chordPreset: chord.id,
    scaleNotesMidi,
    chordNotesMidi,
  };
}
