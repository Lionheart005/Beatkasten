/**
 * Combined "function + harmony" chord menu for the cadence builder tiles.
 *
 * Every option shows its function symbol (Riemann style: T, Sp, D⁷, N⁶ …) and
 * the chord it produces in the current key (e.g. "Sp · Dm"). Options are
 * grouped by function and, inside a group, sorted by the number of added
 * (non-triad) tones and then by the number of out-of-scale tones, so plain
 * diatonic triads come first. Pure TS, no DOM.
 */
import {
  CHORD_PRESETS,
  findChordPresetByIntervals,
  isChordPresetId,
  type ChordPresetId,
} from './harmony';
import {
  CLASSICAL_TEMPLATES,
  resolveClassicalTemplate,
  type ClassicalTemplateId,
} from './classicalChords';
import { getHeptatonicIntervals, normalizePitchClass, NOTE_NAMES } from './scales';
import {
  chordNameFor,
  DIATONIC_TRIAD,
  getDiatonicChordIntervals,
  resolveStepBassOffset,
  resolveStepIntervals,
  romanNumeral,
  type BassMode,
  type ChordStepConfig,
  type HarmonySettings,
} from './progression';

export type ChordMenuGroup =
  | 'tonic'
  | 'subdominant'
  | 'dominant'
  | 'secondary'
  | 'aug6'
  | 'chromatic'
  | 'colours';

export const CHORD_MENU_GROUP_LABELS: Readonly<Record<ChordMenuGroup, string>> = {
  tonic: 'Tonika',
  subdominant: 'Subdominante',
  dominant: 'Dominante',
  secondary: 'Zwischendominanten & Doppeldominante',
  aug6: 'Übermäßige Sextakkorde',
  chromatic: 'Medianten & geborgte Akkorde',
  colours: 'Alle Klangfarben auf dieser Stufe',
};

const GROUP_ORDER: readonly ChordMenuGroup[] = [
  'tonic',
  'subdominant',
  'dominant',
  'secondary',
  'aug6',
  'chromatic',
  'colours',
];

export interface ChordMenuFields {
  readonly degree: number;
  readonly accidental: -1 | 0 | 1;
  readonly chordType: string;
  readonly templateId?: ClassicalTemplateId;
  readonly bass?: BassMode;
}

export interface ChordMenuOption {
  /** Unique option value. */
  readonly key: string;
  readonly group: ChordMenuGroup;
  /** Function symbol, e.g. "Sp", "D⁷", "N⁶". */
  readonly fn: string;
  /** Chord name in the current key, e.g. "Dm", "G7", "Des/F". */
  readonly name: string;
  readonly roman: string;
  /** Option text: "Sp · Dm". */
  readonly label: string;
  readonly hint: string;
  /** Tones beyond the basic triad (7, 6, 9 …, sus counts as one). */
  readonly extras: number;
  /** Tones outside the key's scale. */
  readonly foreign: number;
  readonly fields: ChordMenuFields;
}

const pcOf = (m: number): number => ((m % 12) + 12) % 12;

type Quality = 'major' | 'minor' | 'dim' | 'aug' | 'open';

function qualityOf(intervals: readonly number[]): Quality {
  const pcs = new Set(intervals.map(pcOf));
  const M3 = pcs.has(4);
  const m3 = pcs.has(3);
  if (m3 && !M3) return pcs.has(6) && !pcs.has(7) ? 'dim' : 'minor';
  if (M3 && !m3) return pcs.has(8) && !pcs.has(7) ? 'aug' : 'major';
  return 'open';
}

function diatonicQuality(scaleId: string, degree: number): Quality {
  return qualityOf(getDiatonicChordIntervals(scaleId, degree, 3));
}

function isMinorKey(scaleId: string): boolean {
  return pcOf(getHeptatonicIntervals(scaleId)[2]!) === 3;
}

/** Function symbol of a (triad-quality) chord on a root, without extensions. */
function baseFunction(
  scaleId: string,
  degree: number,
  accidental: -1 | 0 | 1,
  quality: Quality,
): { symbol: string; group: ChordMenuGroup } | null {
  const minorKey = isMinorKey(scaleId);
  const q = quality === 'open' ? diatonicQuality(scaleId, degree) : quality;
  const up = q === 'major' || q === 'aug';
  const d = ((degree % 7) + 7) % 7;
  if (accidental === 0) {
    switch (d) {
      case 0:
        return { symbol: up ? 'T' : 't', group: 'tonic' };
      case 3:
        return { symbol: up ? 'S' : 's', group: 'subdominant' };
      case 4:
        return { symbol: up ? 'D' : 'd', group: 'dominant' };
      case 1:
        if (q === 'minor') return { symbol: minorKey ? 'sP' : 'Sp', group: 'subdominant' };
        if (q === 'dim') return { symbol: 's⁶', group: 'subdominant' };
        // Phrygian: the natural second degree already is the Neapolitan root.
        if (pcOf(getHeptatonicIntervals(scaleId)[1]!) === 1) return { symbol: 'N', group: 'subdominant' };
        return { symbol: 'DD', group: 'secondary' };
      case 2:
        if (minorKey) return up ? { symbol: 'tP', group: 'tonic' } : { symbol: 'dG', group: 'dominant' };
        return up ? { symbol: '(D)Tp', group: 'secondary' } : { symbol: 'Dp', group: 'dominant' };
      case 5:
        if (minorKey) return up ? { symbol: 'tG', group: 'tonic' } : { symbol: 'vi', group: 'chromatic' };
        return up ? { symbol: '(D)Sp', group: 'secondary' } : { symbol: 'Tp', group: 'tonic' };
      case 6:
        if (q === 'dim') return { symbol: 'D̸', group: 'dominant' };
        if (minorKey && up) return { symbol: 'dP', group: 'dominant' };
        return up ? { symbol: '(D)Dp', group: 'secondary' } : null;
      default:
        return null;
    }
  }
  if (accidental === -1) {
    if (d === 1 && up) return { symbol: 'N', group: 'subdominant' };
    if (!minorKey && up && d === 2) return { symbol: 'tP', group: 'chromatic' };
    if (!minorKey && up && d === 5) return { symbol: 'tG', group: 'chromatic' };
    if (!minorKey && up && d === 6) return { symbol: 'dP', group: 'chromatic' };
    return null;
  }
  // Raised roots: leading-tone chords.
  if (d === 6 && q === 'dim') return { symbol: 'D̸', group: 'dominant' };
  if (d === 3 && q === 'dim') return { symbol: '(D̸)D', group: 'secondary' };
  return null;
}

/** Extension suffix in function notation ("⁷", "⁹", "⁶", "sus4" …). */
function extensionSuffix(intervals: readonly number[], quality: Quality): string {
  const has = (i: number) => intervals.some((x) => x === i);
  const pcs = new Set(intervals.map(pcOf));
  const seventh = pcs.has(10) || pcs.has(11) || (quality === 'dim' && pcs.has(9));
  let ext = '';
  if (has(21)) ext = '¹³';
  else if (has(17)) ext = '¹¹';
  else if (has(14) && seventh) ext = '⁹';
  else if (seventh) ext = '⁷';
  else if (pcs.has(9)) ext = '⁶';
  else if (has(14)) ext = 'add⁹';
  if (quality === 'open') {
    if (pcs.has(5) && !pcs.has(4) && !pcs.has(3)) ext += 'sus4';
    else if (pcs.has(2) && !pcs.has(4) && !pcs.has(3)) ext += 'sus2';
    else if (pcs.size <= 2) ext += '⁵';
  }
  if (quality === 'aug') ext += '⁺';
  return ext;
}

/**
 * Function symbol (Riemann style) for any chord on a scale degree, e.g.
 * "T", "Sp", "D⁷", "(D⁷)Tp", "N", "dP". Returns null if no sensible label.
 */
export function chordFunctionSymbol(
  scaleId: string,
  degree: number,
  accidental: -1 | 0 | 1,
  intervals: readonly number[],
): string | null {
  return describeFunction(scaleId, degree, accidental, intervals)?.symbol ?? null;
}

function describeFunction(
  scaleId: string,
  degree: number,
  accidental: -1 | 0 | 1,
  intervals: readonly number[],
): { symbol: string; group: ChordMenuGroup } | null {
  const scale = getHeptatonicIntervals(scaleId);
  const d = ((Math.round(degree) % 7) + 7) % 7;
  const quality = qualityOf(intervals);
  const pcs = new Set(intervals.map(pcOf));
  const suffix = extensionSuffix(intervals, quality);
  // Dominant-seventh shape: a (secondary) dominant of the chord a fifth below.
  if (pcs.has(4) && pcs.has(10) && !pcs.has(3) && !pcs.has(8)) {
    const rootRel = pcOf(scale[d]! + accidental);
    const targetRel = pcOf(rootRel + 5);
    if (targetRel === 0) return { symbol: `D${suffix}`, group: 'dominant' };
    const target = scale.findIndex((v) => pcOf(v) === targetRel);
    if (target >= 0) {
      if (target === 4) return { symbol: `DD${suffix}`, group: 'secondary' };
      const tf = baseFunction(scaleId, target, 0, diatonicQuality(scaleId, target));
      if (tf) return { symbol: `(D${suffix})${tf.symbol}`, group: 'secondary' };
    }
  }
  const base = baseFunction(scaleId, d, accidental, quality);
  if (!base) return null;
  if (quality === 'dim') {
    const seventh = pcs.has(9) || pcs.has(10);
    // vii° / viiø7 = shortened dominant (D̸⁷ / D̸⁹), ii° / iiø7 = s with added sixth.
    if (base.symbol === 'D̸') return { symbol: seventh ? 'D̸⁹' : 'D̸', group: base.group };
    if (base.symbol === 's⁶') return { symbol: seventh ? 's⁶₅' : 's⁶', group: base.group };
    if (!suffix) return { symbol: `${base.symbol}°`, group: base.group };
  }
  return { symbol: `${base.symbol}${suffix}`, group: base.group };
}

function chordName(rootPc: number, intervals: readonly number[], chordType: string): string {
  if (isChordPresetId(chordType) && CHORD_PRESETS[chordType].category === 'classical') {
    return `${NOTE_NAMES[pcOf(rootPc)] ?? 'C'}${CHORD_PRESETS[chordType].symbol}`;
  }
  return chordNameFor(rootPc, intervals);
}

function countExtras(intervals: readonly number[], quality: Quality): number {
  const pcs = new Set(intervals.map(pcOf));
  if (pcs.size <= 2) return 0;
  return Math.max(0, pcs.size - 3) + (quality === 'open' ? 1 : 0);
}

function optionKey(f: ChordMenuFields): string {
  return `${f.degree}|${f.accidental}|${f.chordType}|${f.templateId ?? ''}`;
}

interface Candidate {
  fields: ChordMenuFields;
  group?: ChordMenuGroup;
  fn?: string;
  hint?: string;
}

function buildOption(
  harmony: HarmonySettings,
  c: Candidate,
  forceGroup?: ChordMenuGroup,
): { option: ChordMenuOption; signature: string } | null {
  const { scaleId } = harmony;
  const scale = getHeptatonicIntervals(scaleId);
  const keyPc = normalizePitchClass(harmony.rootNote);
  const { degree, accidental, chordType } = c.fields;
  const intervals = resolveStepIntervals(scaleId, harmony.chordPreset, degree, accidental, chordType);
  const rootRel = scale[degree]! + accidental;
  const rootPc = pcOf(keyPc + rootRel);
  const quality = qualityOf(intervals);
  const fnInfo = describeFunction(scaleId, degree, accidental, intervals);
  const fn = c.fn ?? fnInfo?.symbol;
  const group = forceGroup ?? c.group ?? fnInfo?.group;
  if (!fn || !group) return null;
  const bassRel = resolveStepBassOffset({ bass: c.fields.bass ?? 'root' }, scaleId, rootRel, intervals);
  const bassPc = bassRel === null ? -1 : pcOf(keyPc + bassRel);
  const slash = bassPc >= 0 && bassPc !== rootPc ? `/${NOTE_NAMES[bassPc] ?? ''}` : '';
  const name = `${chordName(rootPc, intervals, chordType)}${slash}`;
  const scaleSet = new Set(scale.map(pcOf));
  const foreign = new Set(intervals.map((i) => pcOf(rootRel + i)).filter((pc) => !scaleSet.has(pc))).size;
  const roman = romanNumeral(degree, accidental, intervals);
  const option: ChordMenuOption = {
    key: optionKey(c.fields),
    group,
    fn,
    name,
    roman,
    label: `${fn} · ${name}`,
    hint: c.hint ?? `${roman} · ${name}`,
    extras: countExtras(intervals, quality),
    foreign,
    fields: c.fields,
  };
  const signature = `${pcOf(rootRel)}|${[...new Set(intervals.map(pcOf))].sort((a, b) => a - b).join(',')}|${c.fields.bass ?? 'root'}|${chordType === 'it6' || chordType === 'fr6' || chordType === 'ger6' ? chordType : ''}`;
  return { option, signature };
}

/** Diatonic chord type with this note count, as explicit preset (null if none). */
function diatonicPreset(scaleId: string, degree: number, count: 4 | 5): ChordPresetId | null {
  const preset = findChordPresetByIntervals(getDiatonicChordIntervals(scaleId, degree, count));
  return preset ? preset.id : null;
}

/** Tonika → Subdominante → Dominante order of the diatonic roots. */
const DIATONIC_ORDER = [0, 5, 3, 1, 4, 2, 6];

const TEMPLATE_GROUPS: Partial<Record<ClassicalTemplateId, ChordMenuGroup>> = {
  picardy: 'tonic',
  'tonic-minor': 'tonic',
  neapolitan: 'subdominant',
  'sixte-ajoutee': 'subdominant',
  'subdominant-minor': 'subdominant',
  dominant: 'dominant',
  dominant7: 'dominant',
  'leading-dim7': 'dominant',
  'double-dominant': 'secondary',
  'sec-dom-ii': 'secondary',
  'sec-dom-iii': 'secondary',
  'sec-dom-iv': 'secondary',
  'sec-dom-v': 'secondary',
  'sec-dom-vi': 'secondary',
  it6: 'aug6',
  fr6: 'aug6',
  ger6: 'aug6',
  'mediant-flat3': 'chromatic',
  'mediant-flat6': 'chromatic',
  'mediant-major3': 'chromatic',
  'mediant-major6': 'chromatic',
};

/**
 * All menu options for a builder tile, grouped by function and sorted
 * (fewest added / out-of-scale tones first). `current` adds the group
 * "Alle Klangfarben" with every chord colour on that tile's root.
 */
export function buildChordMenu(
  harmony: HarmonySettings,
  current?: Pick<ChordStepConfig, 'degree' | 'accidental'>,
): ChordMenuOption[] {
  const { scaleId } = harmony;
  const minorKey = isMinorKey(scaleId);
  const candidates: Candidate[] = [];
  const add = (degree: number, accidental: -1 | 0 | 1, chordType: string | null) => {
    if (chordType) candidates.push({ fields: { degree, accidental, chordType } });
  };

  // 1) Diatonic roots: triad, seventh, ninth and the common colours.
  for (const d of DIATONIC_ORDER) {
    const q = diatonicQuality(scaleId, d);
    add(d, 0, DIATONIC_TRIAD);
    add(d, 0, diatonicPreset(scaleId, d, 4));
    add(d, 0, diatonicPreset(scaleId, d, 5));
    if (d === 0 || d === 3) add(d, 0, q === 'minor' ? 'minor6' : q === 'major' ? 'major6' : null);
    if (d === 0 || d === 3 || d === 5) add(d, 0, q === 'minor' ? 'madd9' : q === 'major' ? 'add9' : null);
    if (d === 0 || d === 4) add(d, 0, 'sus4');
    if (d === 0 || d === 3) add(d, 0, 'sus2');
    if (d === 4) add(d, 0, 'dom9');
  }
  // Raised leading tone in natural minor (vii° of harmonic minor).
  const scale = getHeptatonicIntervals(scaleId);
  if (pcOf(scale[6]!) === 10) add(6, 1, DIATONIC_TRIAD);

  // 2) Classical function templates (resolved against the key).
  for (const tpl of Object.values(CLASSICAL_TEMPLATES)) {
    const group = TEMPLATE_GROUPS[tpl.id];
    if (!group) continue;
    if (tpl.id === 'picardy' && !minorKey) continue;
    if (tpl.id === 'tonic-minor' && minorKey) continue;
    const r = resolveClassicalTemplate(tpl.id, scaleId);
    // Secondary dominants: Riemann label of the target ("(D⁷)Sp"); none for diminished targets.
    let fn: string | undefined = tpl.symbol;
    if (tpl.id.startsWith('sec-dom-')) {
      const targetDegree = (tpl.degree + 3) % 7;
      if (diatonicQuality(scaleId, targetDegree) === 'dim') continue;
      fn = undefined;
    }
    candidates.push({
      fields: {
        degree: r.degree,
        accidental: r.accidental,
        chordType: r.chordType,
        templateId: tpl.id,
        bass: r.bass,
      },
      group,
      fn,
      hint: `${tpl.label}: ${tpl.hint}`,
    });
  }

  // 3) Borrowed major chords on lowered degrees (bII, bIII, bVI, bVII).
  for (const d of [1, 2, 5, 6]) {
    if (minorKey && d !== 1) continue;
    add(d, -1, DIATONIC_TRIAD);
  }

  const seen = new Set<string>();
  const keys = new Set<string>();
  const main: Array<ChordMenuOption & { order: number }> = [];
  candidates.forEach((c, order) => {
    const built = buildOption(harmony, c);
    if (!built || seen.has(built.signature) || keys.has(built.option.key)) return;
    seen.add(built.signature);
    keys.add(built.option.key);
    main.push({ ...built.option, order });
  });

  // 4) Every chord colour on the tile's current root.
  if (current) {
    const d = ((Math.round(current.degree) % 7) + 7) % 7;
    const acc = current.accidental === -1 || current.accidental === 1 ? current.accidental : 0;
    let order = candidates.length;
    for (const preset of Object.values(CHORD_PRESETS)) {
      if (preset.category === 'classical') continue;
      const built = buildOption(harmony, { fields: { degree: d, accidental: acc, chordType: preset.id } }, 'colours');
      if (!built) {
        // No function label: still offer the colour with the roman numeral.
        const intervals = resolveStepIntervals(scaleId, harmony.chordPreset, d, acc, preset.id);
        const roman = romanNumeral(d, acc, intervals);
        const keyPc = normalizePitchClass(harmony.rootNote);
        const name = chordName(pcOf(keyPc + scale[d]! + acc), intervals, preset.id);
        main.push({
          key: `c:${optionKey({ degree: d, accidental: acc, chordType: preset.id })}`,
          group: 'colours',
          fn: roman,
          name,
          roman,
          label: `${roman} · ${name}`,
          hint: `${roman} · ${name}`,
          extras: countExtras(intervals, qualityOf(intervals)),
          foreign: 0,
          fields: { degree: d, accidental: acc, chordType: preset.id },
          order: order++,
        });
        continue;
      }
      main.push({ ...built.option, key: `c:${built.option.key}`, order: order++ });
    }
  }

  const groupIdx = (g: ChordMenuGroup) => GROUP_ORDER.indexOf(g);
  main.sort(
    (a, b) =>
      groupIdx(a.group) - groupIdx(b.group) ||
      a.extras - b.extras ||
      a.foreign - b.foreign ||
      a.order - b.order,
  );
  return main.map(({ order: _o, ...rest }) => rest);
}

/** Groups options in menu order (for <optgroup>). */
export function groupChordMenu(
  options: readonly ChordMenuOption[],
): Array<{ group: ChordMenuGroup; label: string; options: ChordMenuOption[] }> {
  const out: Array<{ group: ChordMenuGroup; label: string; options: ChordMenuOption[] }> = [];
  for (const opt of options) {
    let last = out[out.length - 1];
    if (!last || last.group !== opt.group) {
      last = { group: opt.group, label: CHORD_MENU_GROUP_LABELS[opt.group], options: [] };
      out.push(last);
    }
    last.options.push(opt);
  }
  return out;
}

/**
 * The option matching a builder step: same template, else same fields, else
 * same sound (root + chord tones). Null if the step is not in the menu.
 */
export function findChordMenuOption(
  options: readonly ChordMenuOption[],
  harmony: HarmonySettings,
  step: Pick<ChordStepConfig, 'degree' | 'accidental' | 'chordType' | 'templateId'>,
): ChordMenuOption | null {
  if (step.templateId) {
    return options.find((o) => o.fields.templateId === step.templateId) ?? null;
  }
  const exact = options.find(
    (o) =>
      !o.fields.templateId &&
      o.fields.degree === step.degree &&
      o.fields.accidental === step.accidental &&
      o.fields.chordType === step.chordType,
  );
  if (exact) return exact;
  const scale = getHeptatonicIntervals(harmony.scaleId);
  const sound = (f: Pick<ChordStepConfig, 'degree' | 'accidental' | 'chordType'>) => {
    const iv = resolveStepIntervals(harmony.scaleId, harmony.chordPreset, f.degree, f.accidental, f.chordType);
    return `${pcOf(scale[f.degree]! + f.accidental)}|${[...new Set(iv.map(pcOf))].sort((a, b) => a - b).join(',')}`;
  };
  const target = sound(step);
  return options.find((o) => !o.fields.templateId && sound(o.fields) === target) ?? null;
}
