export type ChordPresetId =
  // Dreiklänge & Basis
  | 'major'
  | 'minor'
  | 'sus2'
  | 'sus4'
  | 'power5'
  | 'dim'
  | 'aug'
  // Vierklänge & Farben
  | 'maj7'
  | 'dom7'
  | 'minor7'
  | 'm7b5'
  | 'dim7'
  | 'minMaj7'
  | 'major6'
  | 'minor6'
  | 'add9'
  | 'madd9'
  | 'aug7'
  | 'augMaj7'
  // Jazz-Erweiterungen
  | 'maj9'
  | 'dom9'
  | 'minor9'
  | 'dom7sus4'
  | 'minor11'
  | 'dom13'
  | 'maj13'
  | 'minor13'
  | 'aug9'
  | 'augMaj9'
  // Klassisch & Funktional (übermäßige Sextakkorde)
  | 'it6'
  | 'fr6'
  | 'ger6';

export type ChordCategory = 'triad' | 'seventh' | 'extended' | 'classical';

export interface ChordPreset {
  readonly id: ChordPresetId;
  readonly label: string;
  readonly intervals: readonly number[];
  readonly category: ChordCategory;
  /** Chord symbol suffix, e.g. 'm7' -> "Am7". */
  readonly symbol: string;
}

function chord(
  id: ChordPresetId,
  label: string,
  intervals: number[],
  category: ChordCategory,
  symbol: string,
): ChordPreset {
  return { id, label, intervals, category, symbol };
}

export const CHORD_PRESETS: Readonly<Record<ChordPresetId, ChordPreset>> = {
  major: chord('major', 'Dur', [0, 4, 7], 'triad', ''),
  minor: chord('minor', 'Moll', [0, 3, 7], 'triad', 'm'),
  sus2: chord('sus2', 'Sus2', [0, 2, 7], 'triad', 'sus2'),
  sus4: chord('sus4', 'Sus4', [0, 5, 7], 'triad', 'sus4'),
  power5: chord('power5', 'Powerchord (5)', [0, 7, 12], 'triad', '5'),
  dim: chord('dim', 'Vermindert', [0, 3, 6], 'triad', '°'),
  aug: chord('aug', 'Übermäßig (+)', [0, 4, 8], 'triad', '+'),

  maj7: chord('maj7', 'Dur Maj7', [0, 4, 7, 11], 'seventh', 'maj7'),
  dom7: chord('dom7', 'Dominant 7', [0, 4, 7, 10], 'seventh', '7'),
  minor7: chord('minor7', 'Moll 7', [0, 3, 7, 10], 'seventh', 'm7'),
  m7b5: chord('m7b5', 'Halbvermindert (m7b5)', [0, 3, 6, 10], 'seventh', 'ø7'),
  dim7: chord('dim7', 'Vermindert 7', [0, 3, 6, 9], 'seventh', '°7'),
  minMaj7: chord('minMaj7', 'Moll-Maj7', [0, 3, 7, 11], 'seventh', 'm(maj7)'),
  major6: chord('major6', 'Dur 6', [0, 4, 7, 9], 'seventh', '6'),
  minor6: chord('minor6', 'Moll 6', [0, 3, 7, 9], 'seventh', 'm6'),
  add9: chord('add9', 'Dur add9', [0, 4, 7, 14], 'seventh', 'add9'),
  madd9: chord('madd9', 'Moll add9', [0, 3, 7, 14], 'seventh', 'm(add9)'),
  aug7: chord('aug7', 'Übermäßig 7 (7♯5)', [0, 4, 8, 10], 'seventh', '7♯5'),
  augMaj7: chord('augMaj7', 'Übermäßig Maj7 (maj7♯5)', [0, 4, 8, 11], 'seventh', 'maj7♯5'),

  maj9: chord('maj9', 'Dur Maj9', [0, 4, 7, 11, 14], 'extended', 'maj9'),
  dom9: chord('dom9', 'Dominant 9', [0, 4, 7, 10, 14], 'extended', '9'),
  minor9: chord('minor9', 'Moll 9', [0, 3, 7, 10, 14], 'extended', 'm9'),
  dom7sus4: chord('dom7sus4', '9sus4', [0, 5, 7, 10, 14], 'extended', '9sus4'),
  minor11: chord('minor11', 'Moll 11', [0, 3, 7, 10, 14, 17], 'extended', 'm11'),
  dom13: chord('dom13', 'Dominant 13', [0, 4, 7, 10, 14, 21], 'extended', '13'),
  maj13: chord('maj13', 'Dur Maj13', [0, 4, 7, 11, 14, 21], 'extended', 'maj13'),
  minor13: chord('minor13', 'Moll 13', [0, 3, 7, 10, 14, 17, 21], 'extended', 'm13'),
  aug9: chord('aug9', 'Übermäßig 9 (9♯5)', [0, 4, 8, 10, 14], 'extended', '9♯5'),
  augMaj9: chord('augMaj9', 'Übermäßig Maj9 (maj9♯5)', [0, 4, 8, 11, 14], 'extended', 'maj9♯5'),

  // Augmented sixth chords, built on the chord root (usually bVI): the minor
  // seventh (10) is spelled as the augmented sixth (#4 of the key).
  it6: chord('it6', 'Italienischer Sextakkord (It⁺⁶)', [0, 4, 10], 'classical', ' It⁺⁶'),
  fr6: chord('fr6', 'Französischer Sextakkord (Fr⁺⁶)', [0, 4, 6, 10], 'classical', ' Fr⁺⁶'),
  ger6: chord('ger6', 'Deutscher Sextakkord (Dt⁺⁶)', [0, 4, 7, 10], 'classical', ' Dt⁺⁶'),
};

export const CHORD_CATEGORY_LABELS: Readonly<Record<ChordCategory, string>> = {
  triad: 'Dreiklänge',
  seventh: 'Vierklänge & Farben',
  extended: 'Jazz 9 · 11 · 13',
  classical: 'Klassisch & Funktional',
};

export function isChordPresetId(id: string): id is ChordPresetId {
  return Object.prototype.hasOwnProperty.call(CHORD_PRESETS, id);
}

export function getChordPreset(chordPreset: string): ChordPreset {
  if (isChordPresetId(chordPreset)) return CHORD_PRESETS[chordPreset];
  return CHORD_PRESETS.minor;
}

/** Finds a preset with exactly these intervals (order-insensitive), if any. */
export function findChordPresetByIntervals(intervals: readonly number[]): ChordPreset | null {
  const key = [...intervals].sort((a, b) => a - b).join(',');
  for (const preset of Object.values(CHORD_PRESETS)) {
    // Enharmonic twins (ger6 = dom7) are only named when chosen explicitly.
    if (preset.category === 'classical') continue;
    if ([...preset.intervals].sort((a, b) => a - b).join(',') === key) return preset;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Progressions
// ---------------------------------------------------------------------------

export type ProgressionId =
  // Legacy "Techno-Parallel" (semitone offsets, global chord type, 1 bar per step)
  | 'static'
  | 'hypnotic_i_VI'
  | 'classic_i_VI_VII_i'
  | 'phrygian_i_II'
  // Scale-degree based cadences
  | 'cad_major_full'
  | 'cad_pop'
  | 'cad_minor_pop'
  | 'cad_jazz_major'
  | 'cad_jazz_minor'
  | 'cad_andalusian'
  | 'cad_dorian_vamp'
  | 'cad_lydian_float'
  | 'cad_mixolydian'
  | 'cad_pachelbel'
  | 'cad_deep_minor'
  // Klassische Kadenzen (Funktions-Vorlagen)
  | 'cad_neapolitan'
  | 'cad_sixte_ajoutee'
  | 'cad_german_sixth'
  | 'cad_italian_sixth'
  | 'cad_french_sixth'
  | 'cad_double_dominant'
  | 'cad_picardy'
  | 'cad_minor_subdominant';

export interface ProgressionStepDef {
  /** Scale degree 0..6 (I..VII). */
  readonly degree: number;
  readonly accidental?: -1 | 0 | 1;
  /** 'auto' = diatonic chord in the colour of the global chord selection. */
  readonly chordType?: ChordPresetId | 'auto';
  readonly bars?: number;
  /**
   * Classical function template (see classicalChords.ts). When set, degree,
   * accidental, chord type and bass are derived from the template and the scale.
   */
  readonly template?: string;
  /** Bass of the chord (default 'root'). */
  readonly bass?: 'root' | 'third' | 'fifth' | 'seventh' | 'none';
}

export interface ProgressionPreset {
  readonly id: ProgressionId;
  readonly label: string;
  readonly group: 'techno' | 'cadence' | 'classical';
  /** Legacy: semitone offsets per bar relative to the base root note. */
  readonly semitoneOffsets?: readonly number[];
  /** Scale-degree based steps. */
  readonly steps?: readonly ProgressionStepDef[];
}

const s = (
  degree: number,
  bars = 1,
  chordType: ChordPresetId | 'auto' = 'auto',
  accidental: -1 | 0 | 1 = 0,
): ProgressionStepDef => ({ degree, bars, chordType, accidental });

/** Step from a classical function template ("N6", "ger6", ...). */
const t = (template: string, bars = 1): ProgressionStepDef => ({ degree: 0, bars, template });

export const PROGRESSION_PRESETS: Readonly<Record<ProgressionId, ProgressionPreset>> = {
  static: {
    id: 'static',
    label: 'Statisch (i)',
    group: 'techno',
    semitoneOffsets: [0],
  },
  hypnotic_i_VI: {
    id: 'hypnotic_i_VI',
    label: 'Hypnotisch (i – VI)',
    group: 'techno',
    semitoneOffsets: [0, 0, -4, -4],
  },
  classic_i_VI_VII_i: {
    id: 'classic_i_VI_VII_i',
    label: 'Klassisch (i – VI – VII – i)',
    group: 'techno',
    semitoneOffsets: [0, -4, -2, 0],
  },
  phrygian_i_II: {
    id: 'phrygian_i_II',
    label: 'Phrygisch (i – bII)',
    group: 'techno',
    semitoneOffsets: [0, 0, 1, 0],
  },

  cad_major_full: {
    id: 'cad_major_full',
    label: 'Vollkadenz (I – IV – V – I)',
    group: 'cadence',
    steps: [s(0), s(3), s(4), s(0)],
  },
  cad_pop: {
    id: 'cad_pop',
    label: 'Pop / Melodic (I – V – vi – IV)',
    group: 'cadence',
    steps: [s(0), s(4), s(5), s(3)],
  },
  cad_minor_pop: {
    id: 'cad_minor_pop',
    label: 'Moll-Epos (i – VI – III – VII)',
    group: 'cadence',
    steps: [s(0), s(5), s(2), s(6)],
  },
  cad_jazz_major: {
    id: 'cad_jazz_major',
    label: 'Jazz Dur (ii7 – V9 – Imaj9)',
    group: 'cadence',
    steps: [s(1, 1, 'minor7'), s(4, 1, 'dom9'), s(0, 2, 'maj9')],
  },
  cad_jazz_minor: {
    id: 'cad_jazz_minor',
    label: 'Jazz Moll (iiø – V7 – i9)',
    group: 'cadence',
    steps: [s(1, 1, 'm7b5'), s(4, 1, 'dom7'), s(0, 2, 'minor9')],
  },
  cad_andalusian: {
    id: 'cad_andalusian',
    label: 'Andalusisch (i – VII – VI – V)',
    group: 'cadence',
    steps: [s(0), s(6), s(5), s(4, 1, 'dom7')],
  },
  cad_dorian_vamp: {
    id: 'cad_dorian_vamp',
    label: 'Dorischer Club-Vamp (i7 – IV7)',
    group: 'cadence',
    steps: [s(0, 2, 'minor7'), s(3, 2, 'dom7')],
  },
  cad_lydian_float: {
    id: 'cad_lydian_float',
    label: 'Lydisches Schweben (Imaj7 – II)',
    group: 'cadence',
    steps: [s(0, 2, 'maj7'), s(1, 2, 'major')],
  },
  cad_mixolydian: {
    id: 'cad_mixolydian',
    label: 'Mixolydischer Zug (I – bVII – IV – I)',
    group: 'cadence',
    steps: [s(0), s(6, 1, 'auto', -1), s(3), s(0)],
  },
  cad_pachelbel: {
    id: 'cad_pachelbel',
    label: 'Pachelbel / Trance (8 Takte)',
    group: 'cadence',
    steps: [s(0), s(4), s(5), s(2), s(3), s(0), s(3), s(4)],
  },
  cad_deep_minor: {
    id: 'cad_deep_minor',
    label: 'Deep Moll (i – iv – VI – v)',
    group: 'cadence',
    steps: [s(0, 2), s(3), s(5), s(4)],
  },

  cad_neapolitan: {
    id: 'cad_neapolitan',
    label: 'Neapolitanische Kadenz (i – N⁶ – V⁷ – i)',
    group: 'classical',
    steps: [t('tonic'), t('neapolitan'), t('dominant7'), t('tonic')],
  },
  cad_sixte_ajoutee: {
    id: 'cad_sixte_ajoutee',
    label: 'Sixte ajoutée (I – S⁶ – D⁷ – T)',
    group: 'classical',
    steps: [t('tonic'), t('sixte-ajoutee'), t('dominant7'), t('tonic')],
  },
  cad_german_sixth: {
    id: 'cad_german_sixth',
    label: 'Deutsche Sexte (i – Dt⁺⁶ – V – i)',
    group: 'classical',
    steps: [t('tonic'), t('ger6'), t('dominant'), t('tonic')],
  },
  cad_italian_sixth: {
    id: 'cad_italian_sixth',
    label: 'Italienische Sexte (i – It⁺⁶ – V – i)',
    group: 'classical',
    steps: [t('tonic'), t('it6'), t('dominant'), t('tonic')],
  },
  cad_french_sixth: {
    id: 'cad_french_sixth',
    label: 'Französische Sexte (i – Fr⁺⁶ – V – i)',
    group: 'classical',
    steps: [t('tonic'), t('fr6'), t('dominant'), t('tonic')],
  },
  cad_double_dominant: {
    id: 'cad_double_dominant',
    label: 'Doppeldominante (I – DD⁷ – V⁷ – I)',
    group: 'classical',
    steps: [t('tonic'), t('double-dominant'), t('dominant7'), t('tonic')],
  },
  cad_picardy: {
    id: 'cad_picardy',
    label: 'Picardie-Schluss (i – iv – V⁷ – I)',
    group: 'classical',
    steps: [t('tonic-minor'), t('subdominant-minor'), t('dominant7'), t('picardy')],
  },
  cad_minor_subdominant: {
    id: 'cad_minor_subdominant',
    label: 'Romantische Moll-Subdominante (I – iv – I)',
    group: 'classical',
    steps: [t('tonic', 2), t('subdominant-minor'), t('tonic')],
  },
};

export function getProgressionPreset(progressionId: string): ProgressionPreset {
  if (Object.prototype.hasOwnProperty.call(PROGRESSION_PRESETS, progressionId)) {
    return PROGRESSION_PRESETS[progressionId as ProgressionId];
  }
  return PROGRESSION_PRESETS.static;
}
