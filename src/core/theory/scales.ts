export const NOTE_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;

export type NoteName = (typeof NOTE_NAMES)[number];

export type ScaleId =
  | 'natural_minor'
  | 'dorian'
  | 'phrygian'
  | 'harmonic_minor'
  | 'melodic_minor'
  | 'minor_pentatonic'
  | 'locrian'
  | 'major'
  | 'lydian'
  | 'mixolydian'
  | 'major_pentatonic';

export interface ScaleDefinition {
  readonly id: ScaleId;
  readonly label: string;
  readonly intervals: readonly number[];
  /** 'minor' / 'major' character, used for grouping in the UI. */
  readonly family: 'minor' | 'major';
  /**
   * For non-heptatonic scales (pentatonics): the 7-note parent scale used to
   * build diatonic chords on scale degrees.
   */
  readonly parentScale?: ScaleId;
}

export const SCALE_DEFINITIONS: Readonly<Record<ScaleId, ScaleDefinition>> = {
  natural_minor: {
    id: 'natural_minor',
    label: 'Natürliches Moll (Äolisch)',
    intervals: [0, 2, 3, 5, 7, 8, 10],
    family: 'minor',
  },
  dorian: {
    id: 'dorian',
    label: 'Dorisch',
    intervals: [0, 2, 3, 5, 7, 9, 10],
    family: 'minor',
  },
  phrygian: {
    id: 'phrygian',
    label: 'Phrygisch',
    intervals: [0, 1, 3, 5, 7, 8, 10],
    family: 'minor',
  },
  harmonic_minor: {
    id: 'harmonic_minor',
    label: 'Harmonisches Moll',
    intervals: [0, 2, 3, 5, 7, 8, 11],
    family: 'minor',
  },
  melodic_minor: {
    id: 'melodic_minor',
    label: 'Melodisch Moll (Jazz)',
    intervals: [0, 2, 3, 5, 7, 9, 11],
    family: 'minor',
  },
  minor_pentatonic: {
    id: 'minor_pentatonic',
    label: 'Moll-Pentatonik',
    intervals: [0, 3, 5, 7, 10],
    family: 'minor',
    parentScale: 'natural_minor',
  },
  locrian: {
    id: 'locrian',
    label: 'Lokrisch',
    intervals: [0, 1, 3, 5, 6, 8, 10],
    family: 'minor',
  },
  major: {
    id: 'major',
    label: 'Dur (Ionisch)',
    intervals: [0, 2, 4, 5, 7, 9, 11],
    family: 'major',
  },
  lydian: {
    id: 'lydian',
    label: 'Lydisch',
    intervals: [0, 2, 4, 6, 7, 9, 11],
    family: 'major',
  },
  mixolydian: {
    id: 'mixolydian',
    label: 'Mixolydisch',
    intervals: [0, 2, 4, 5, 7, 9, 10],
    family: 'major',
  },
  major_pentatonic: {
    id: 'major_pentatonic',
    label: 'Dur-Pentatonik',
    intervals: [0, 2, 4, 7, 9],
    family: 'major',
    parentScale: 'major',
  },
};

/**
 * Returns the 7-note interval set used for building chords on scale degrees
 * (pentatonics fall back to their parent scale).
 */
export function getHeptatonicIntervals(scaleId: string): readonly number[] {
  const def = getScaleDefinition(scaleId);
  if (def.intervals.length === 7) return def.intervals;
  if (def.parentScale) return SCALE_DEFINITIONS[def.parentScale].intervals;
  return SCALE_DEFINITIONS.natural_minor.intervals;
}

export function normalizePitchClass(rootNote: number): number {
  if (!Number.isFinite(rootNote)) return 0;
  return ((Math.round(rootNote) % 12) + 12) % 12;
}

export function getScaleDefinition(scaleId: string): ScaleDefinition {
  if (Object.prototype.hasOwnProperty.call(SCALE_DEFINITIONS, scaleId)) {
    return SCALE_DEFINITIONS[scaleId as ScaleId];
  }
  return SCALE_DEFINITIONS.natural_minor;
}

/**
 * Converts a MIDI note number (fractional allowed) to frequency in Hz (A4 = 440 Hz).
 */
export function midiToFreq(midi: number): number {
  if (!Number.isFinite(midi)) return 440;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Returns all MIDI note numbers belonging to the given scale within [minMidi, maxMidi].
 */
export function getScaleNotesInRange(
  rootNote: number,
  scaleId: string,
  minMidi: number,
  maxMidi: number,
): number[] {
  const root = normalizePitchClass(rootNote);
  const scale = getScaleDefinition(scaleId);
  const intervalSet = new Set(scale.intervals);

  const start = Number.isFinite(minMidi) ? Math.ceil(minMidi) : 0;
  const end = Number.isFinite(maxMidi) ? Math.floor(maxMidi) : 127;
  if (end < start) return [];

  const notes: number[] = [];
  for (let midi = start; midi <= end; midi++) {
    const pc = (((midi - root) % 12) + 12) % 12;
    if (intervalSet.has(pc)) {
      notes.push(midi);
    }
  }
  return notes;
}

/**
 * Quantizes a floating-point MIDI value to the nearest note in the specified scale.
 */
export function quantizeToScale(
  midiFloat: number,
  rootNote: number,
  scaleId: string,
): number {
  const root = normalizePitchClass(rootNote);
  if (!Number.isFinite(midiFloat)) {
    return 36 + root;
  }

  const base = Math.floor(midiFloat);
  const candidates = getScaleNotesInRange(root, scaleId, base - 12, base + 12);
  if (candidates.length === 0) {
    return Math.round(midiFloat);
  }

  let bestNote = candidates[0] ?? Math.round(midiFloat);
  let bestDist = Math.abs(midiFloat - bestNote);

  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (candidate === undefined) continue;
    const dist = Math.abs(midiFloat - candidate);
    if (dist < bestDist) {
      bestDist = dist;
      bestNote = candidate;
    }
  }

  return bestNote;
}
