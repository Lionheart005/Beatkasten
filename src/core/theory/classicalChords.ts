/**
 * Classical function templates ("Funktions-Vorlagen"): Neapolitan sixth,
 * sixte ajoutée, augmented sixth chords, secondary dominants, Picardy third …
 *
 * A template describes a chord relative to the KEY (target pitch class + chord
 * type + bass) and is resolved against the current scale into the builder's
 * degree / accidental notation, so it always sounds right in major and minor.
 * Pure TS, no DOM.
 */
import type { ChordPresetId } from './harmony';
import { getHeptatonicIntervals } from './scales';

export type ClassicalTemplateId =
  | 'tonic'
  | 'tonic-minor'
  | 'dominant'
  | 'dominant7'
  | 'neapolitan'
  | 'sixte-ajoutee'
  | 'it6'
  | 'fr6'
  | 'ger6'
  | 'double-dominant'
  | 'sec-dom-ii'
  | 'sec-dom-iii'
  | 'sec-dom-iv'
  | 'sec-dom-v'
  | 'sec-dom-vi'
  | 'picardy'
  | 'subdominant-minor'
  | 'leading-dim7'
  | 'mediant-flat3'
  | 'mediant-flat6'
  | 'mediant-major3'
  | 'mediant-major6';

type TemplateBass = 'root' | 'third' | 'fifth' | 'seventh';

export interface ClassicalTemplate {
  readonly id: ClassicalTemplateId;
  /** Button label, e.g. "Neapolitaner". */
  readonly label: string;
  /** Function symbol shown in the builder, e.g. "N⁶", "Dt⁺⁶". */
  readonly symbol: string;
  /** One sentence for the tooltip. */
  readonly hint: string;
  /** Preferred scale degree 0..6 (the letter name of the chord root). */
  readonly degree: number;
  /** Chord root in semitones above the key root (0..11). */
  readonly targetPc: number;
  /** Explicit chord type, or a function of the scale (minor / major colour). */
  readonly chordType: ChordPresetId | 'auto' | ((scaleId: string) => ChordPresetId);
  readonly bass?: TemplateBass;
  /** Only shown in the chip palette (the plain tonic helpers are hidden). */
  readonly inPalette: boolean;
}

/** Is the diatonic triad on `degree` minor in this scale? */
function isMinorDegree(scaleId: string, degree: number): boolean {
  const scale = getHeptatonicIntervals(scaleId);
  const third = (((scale[(degree + 2) % 7]! - scale[degree % 7]!) % 12) + 12) % 12;
  return third === 3;
}

const secDom = (
  id: ClassicalTemplateId,
  target: number,
  label: string,
): ClassicalTemplate => ({
  id,
  label: `V⁷ / ${label}`,
  symbol: `(D⁷)${label}`,
  hint: `Zwischendominante: Dominantseptakkord, der sich in die Stufe ${label} auflöst.`,
  // Root = a fifth above the target degree.
  degree: (target + 4) % 7,
  targetPc: -1, // resolved from the scale (see resolveClassicalTemplate)
  chordType: 'dom7',
  inPalette: true,
});

export const CLASSICAL_TEMPLATES: Readonly<Record<ClassicalTemplateId, ClassicalTemplate>> = {
  tonic: {
    id: 'tonic',
    label: 'Tonika',
    symbol: 'T',
    hint: 'Leitereigener Grundakkord der Tonart.',
    degree: 0,
    targetPc: 0,
    chordType: 'auto',
    inPalette: false,
  },
  'tonic-minor': {
    id: 'tonic-minor',
    label: 'Moll-Tonika',
    symbol: 't',
    hint: 'Moll-Grundakkord (auch in Dur).',
    degree: 0,
    targetPc: 0,
    chordType: 'minor',
    inPalette: false,
  },
  dominant: {
    id: 'dominant',
    label: 'Dominante',
    symbol: 'D',
    hint: 'Dur-Dominante (V), auch in Moll mit Leitton.',
    degree: 4,
    targetPc: 7,
    chordType: 'major',
    inPalette: false,
  },
  dominant7: {
    id: 'dominant7',
    label: 'Dominantseptakkord',
    symbol: 'D⁷',
    hint: 'Dominante mit kleiner Septime (V⁷), drängt stark zur Tonika.',
    degree: 4,
    targetPc: 7,
    chordType: 'dom7',
    inPalette: true,
  },
  neapolitan: {
    id: 'neapolitan',
    label: 'Neapolitaner',
    symbol: 'N⁶',
    hint: 'Dur-Akkord auf der tiefen zweiten Stufe (♭II) mit der Terz im Bass – dunkle Subdominante vor der Dominante.',
    degree: 1,
    targetPc: 1,
    chordType: 'major',
    bass: 'third',
    inPalette: true,
  },
  'sixte-ajoutee': {
    id: 'sixte-ajoutee',
    label: 'Sixte ajoutée',
    symbol: 'S⁶',
    hint: 'Subdominante mit hinzugefügter Sexte – weicher, schwebender Weg zur Dominante.',
    degree: 3,
    targetPc: 5,
    chordType: (scaleId) => (isMinorDegree(scaleId, 3) ? 'minor6' : 'major6'),
    inPalette: true,
  },
  it6: {
    id: 'it6',
    label: 'Italienischer ⁺⁶',
    symbol: 'It⁺⁶',
    hint: 'Übermäßiger Sextakkord (♭6 – 1 – ♯4): die Außenstimmen öffnen sich zur Oktave der Dominante.',
    degree: 5,
    targetPc: 8,
    chordType: 'it6',
    bass: 'root',
    inPalette: true,
  },
  fr6: {
    id: 'fr6',
    label: 'Französischer ⁺⁶',
    symbol: 'Fr⁺⁶',
    hint: 'Übermäßiger Terzquartakkord (♭6 – 1 – 2 – ♯4): herb-schwebende Variante mit Ganzton-Farbe.',
    degree: 5,
    targetPc: 8,
    chordType: 'fr6',
    bass: 'root',
    inPalette: true,
  },
  ger6: {
    id: 'ger6',
    label: 'Deutscher ⁺⁶',
    symbol: 'Dt⁺⁶',
    hint: 'Übermäßiger Quintsextakkord (♭6 – 1 – ♭3 – ♯4): klingt wie ein Septakkord, löst sich aber auswärts zur Dominante.',
    degree: 5,
    targetPc: 8,
    chordType: 'ger6',
    bass: 'root',
    inPalette: true,
  },
  'double-dominant': {
    id: 'double-dominant',
    label: 'Doppeldominante',
    symbol: 'DD⁷',
    hint: 'Die Dominante der Dominante (V⁷/V) – ein Schritt mehr Spannung vor dem V.',
    degree: 1,
    targetPc: 2,
    chordType: 'dom7',
    inPalette: true,
  },
  'sec-dom-ii': secDom('sec-dom-ii', 1, 'ii'),
  'sec-dom-iii': secDom('sec-dom-iii', 2, 'iii'),
  'sec-dom-iv': secDom('sec-dom-iv', 3, 'IV'),
  'sec-dom-v': secDom('sec-dom-v', 4, 'V'),
  'sec-dom-vi': secDom('sec-dom-vi', 5, 'vi'),
  picardy: {
    id: 'picardy',
    label: 'Picardische Terz',
    symbol: 'Tᴾ',
    hint: 'Dur-Tonika als Schlussakkord eines Moll-Stücks – überraschend hell.',
    degree: 0,
    targetPc: 0,
    chordType: 'major',
    inPalette: true,
  },
  'subdominant-minor': {
    id: 'subdominant-minor',
    label: 'Moll-Subdominante',
    symbol: 's',
    hint: 'Subdominante in Moll (iv), in Dur geborgt – romantisch-wehmütig.',
    degree: 3,
    targetPc: 5,
    chordType: 'minor',
    inPalette: true,
  },
  'leading-dim7': {
    id: 'leading-dim7',
    label: 'Verminderter Septakkord',
    symbol: 'vii°⁷',
    hint: 'Verkürzter Dominant-Nonenakkord auf dem Leitton – maximale Spannung, löst zur Tonika.',
    degree: 6,
    targetPc: 11,
    chordType: 'dim7',
    inPalette: true,
  },
  'mediant-flat3': {
    id: 'mediant-flat3',
    label: 'Mediante ♭III',
    symbol: '♭III',
    hint: 'Chromatische Mediante: Dur-Akkord eine kleine Terz über der Tonika – filmische Farbe.',
    degree: 2,
    targetPc: 3,
    chordType: 'major',
    inPalette: true,
  },
  'mediant-flat6': {
    id: 'mediant-flat6',
    label: 'Mediante ♭VI',
    symbol: '♭VI',
    hint: 'Chromatische Mediante: Dur-Akkord eine große Terz unter der Tonika.',
    degree: 5,
    targetPc: 8,
    chordType: 'major',
    inPalette: true,
  },
  'mediant-major3': {
    id: 'mediant-major3',
    label: 'Mediante III (Dur)',
    symbol: 'III',
    hint: 'Chromatische Mediante: Dur-Akkord eine große Terz über der Tonika – strahlend.',
    degree: 2,
    targetPc: 4,
    chordType: 'major',
    inPalette: true,
  },
  'mediant-major6': {
    id: 'mediant-major6',
    label: 'Mediante VI (Dur)',
    symbol: 'VI',
    hint: 'Chromatische Mediante: Dur-Akkord eine kleine Terz unter der Tonika.',
    degree: 5,
    targetPc: 9,
    chordType: 'major',
    inPalette: true,
  },
};

export function isClassicalTemplateId(id: string): id is ClassicalTemplateId {
  return Object.prototype.hasOwnProperty.call(CLASSICAL_TEMPLATES, id);
}

export function getClassicalTemplate(id: string | undefined): ClassicalTemplate | null {
  return id && isClassicalTemplateId(id) ? CLASSICAL_TEMPLATES[id] : null;
}

const pcOf = (m: number): number => ((m % 12) + 12) % 12;

/**
 * Maps a pitch class (semitones above the key root) to a scale degree plus
 * accidental. `preferredDegree` keeps the correct letter name (♭II, not #I);
 * if it is more than one semitone away, the nearest degree is used.
 */
export function pcToDegreeAccidental(
  scaleId: string,
  pc: number,
  preferredDegree?: number,
): { degree: number; accidental: -1 | 0 | 1 } {
  const scale = getHeptatonicIntervals(scaleId);
  const target = pcOf(pc);
  if (preferredDegree !== undefined) {
    const d = ((Math.round(preferredDegree) % 7) + 7) % 7;
    let diff = pcOf(target - scale[d]!);
    if (diff > 6) diff -= 12;
    if (diff >= -1 && diff <= 1) return { degree: d, accidental: diff as -1 | 0 | 1 };
  }
  const exact = scale.findIndex((v) => pcOf(v) === target);
  if (exact >= 0) return { degree: exact, accidental: 0 };
  const flatOf = scale.findIndex((v) => pcOf(v) === pcOf(target + 1));
  if (flatOf >= 0) return { degree: flatOf, accidental: -1 };
  const sharpOf = scale.findIndex((v) => pcOf(v) === pcOf(target - 1));
  if (sharpOf >= 0) return { degree: sharpOf, accidental: 1 };
  return { degree: 0, accidental: 0 };
}

export interface ResolvedTemplateStep {
  readonly degree: number;
  readonly accidental: -1 | 0 | 1;
  readonly chordType: string;
  readonly bass: TemplateBass;
  readonly templateId: ClassicalTemplateId;
}

/** Resolves a template against a scale into builder-step fields. */
export function resolveClassicalTemplate(
  id: ClassicalTemplateId,
  scaleId: string,
): ResolvedTemplateStep {
  const tpl = CLASSICAL_TEMPLATES[id];
  let targetPc = tpl.targetPc;
  if (targetPc < 0) {
    // Secondary dominant: root a perfect fifth above the target degree.
    const scale = getHeptatonicIntervals(scaleId);
    const targetDegree = (tpl.degree + 3) % 7; // inverse of (target + 4) % 7
    targetPc = pcOf(scale[targetDegree]! + 7);
  }
  const { degree, accidental } = pcToDegreeAccidental(scaleId, targetPc, tpl.degree);
  const chordType = typeof tpl.chordType === 'function' ? tpl.chordType(scaleId) : tpl.chordType;
  return { degree, accidental, chordType, bass: tpl.bass ?? 'root', templateId: id };
}
