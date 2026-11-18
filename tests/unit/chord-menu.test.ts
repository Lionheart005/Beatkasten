import { describe, expect, it } from 'vitest';
import {
  buildChordMenu,
  CHORD_PRESETS,
  chordFunctionSymbol,
  DIATONIC_TRIAD,
  findChordMenuOption,
  groupChordMenu,
  previewDegreeChord,
  resolveStepIntervals,
  type HarmonySettings,
} from '../../src/core/theory';

// Global colour is a 7th chord on purpose: the builder triads must ignore it.
const C_MAJOR: HarmonySettings = { rootNote: 0, scaleId: 'major', chordPreset: 'minor7', progressionId: 'static' };
const A_MINOR: HarmonySettings = { rootNote: 9, scaleId: 'natural_minor', chordPreset: 'minor9', progressionId: 'static' };

describe('Diatonic triad chord type', () => {
  it('is a plain triad regardless of the global chord colour', () => {
    expect(resolveStepIntervals('major', 'minor7', 1, 0, DIATONIC_TRIAD)).toEqual([0, 3, 7]);
    expect(resolveStepIntervals('major', 'maj9', 4, 0, DIATONIC_TRIAD)).toEqual([0, 4, 7]);
    expect(resolveStepIntervals('major', 'maj9', 6, 0, DIATONIC_TRIAD)).toEqual([...CHORD_PRESETS.dim.intervals]);
    expect(resolveStepIntervals('major', 'maj9', 6, -1, DIATONIC_TRIAD)).toEqual([...CHORD_PRESETS.major.intervals]);
    expect(previewDegreeChord(C_MAJOR, 1, 0, DIATONIC_TRIAD).name).toBe('Dm');
    expect(previewDegreeChord(A_MINOR, 4, 0, DIATONIC_TRIAD).name).toBe('Em');
  });
});

describe('Function symbols', () => {
  const sym = (h: HarmonySettings, degree: number, acc: -1 | 0 | 1, type: string) =>
    chordFunctionSymbol(h.scaleId, degree, acc, resolveStepIntervals(h.scaleId, h.chordPreset, degree, acc, type));
  it('labels diatonic and chromatic chords in major', () => {
    expect(sym(C_MAJOR, 0, 0, DIATONIC_TRIAD)).toBe('T');
    expect(sym(C_MAJOR, 1, 0, DIATONIC_TRIAD)).toBe('Sp');
    expect(sym(C_MAJOR, 5, 0, DIATONIC_TRIAD)).toBe('Tp');
    expect(sym(C_MAJOR, 4, 0, 'dom7')).toBe('D⁷');
    expect(sym(C_MAJOR, 5, 0, 'dom7')).toBe('(D⁷)Sp');
    expect(sym(C_MAJOR, 1, 0, 'dom7')).toBe('DD⁷');
    expect(sym(C_MAJOR, 3, 0, 'major6')).toBe('S⁶');
    expect(sym(C_MAJOR, 6, -1, DIATONIC_TRIAD)).toBe('dP');
  });
  it('labels minor keys in lower case', () => {
    expect(sym(A_MINOR, 0, 0, DIATONIC_TRIAD)).toBe('t');
    expect(sym(A_MINOR, 3, 0, DIATONIC_TRIAD)).toBe('s');
    expect(sym(A_MINOR, 2, 0, DIATONIC_TRIAD)).toBe('tP');
    expect(sym(A_MINOR, 4, 0, 'major')).toBe('D');
  });
});

describe('Combined chord menu', () => {
  const menu = buildChordMenu(C_MAJOR, { degree: 1, accidental: 0 });
  const groups = groupChordMenu(menu);

  it('is grouped by function: Tonika, Subdominante, Dominante first', () => {
    expect(groups.slice(0, 3).map((g) => g.group)).toEqual(['tonic', 'subdominant', 'dominant']);
    expect(groups[0]!.options[0]!.label).toBe('T · C');
    expect(groups[1]!.options[0]!.label).toBe('S · F');
    expect(groups[2]!.options[0]!.label).toBe('D · G');
  });

  it('puts chords with more added tones further down in every group', () => {
    for (const g of groups) {
      for (let i = 1; i < g.options.length; i++) {
        expect(g.options[i]!.extras).toBeGreaterThanOrEqual(g.options[i - 1]!.extras);
      }
    }
  });

  it('every option shows function and harmony and has a unique value', () => {
    expect(new Set(menu.map((o) => o.key)).size).toBe(menu.length);
    for (const o of menu) expect(o.label).toBe(`${o.fn} · ${o.name}`);
  });

  it('contains the classical chords (Neapolitan, augmented sixths, secondary dominants)', () => {
    const labels = menu.map((o) => o.label);
    expect(labels).toContain('N⁶ · C#/F');
    expect(menu.some((o) => o.fields.templateId === 'ger6' && o.group === 'aug6')).toBe(true);
    expect(labels).toContain('(D⁷)Sp · A7');
    expect(labels).toContain('vii°⁷ · B°7');
  });

  it('offers every chord colour on the tile root', () => {
    const colours = groups.find((g) => g.group === 'colours')!;
    expect(colours.options.some((o) => o.name === 'Dm13')).toBe(true);
    expect(colours.options.every((o) => o.fields.degree === 1)).toBe(true);
  });

  it('finds the option of an existing step (template, triad, auto)', () => {
    expect(
      findChordMenuOption(menu, C_MAJOR, { degree: 1, accidental: -1, chordType: 'major', templateId: 'neapolitan' })
        ?.fields.templateId,
    ).toBe('neapolitan');
    expect(findChordMenuOption(menu, C_MAJOR, { degree: 3, accidental: 0, chordType: DIATONIC_TRIAD })?.label).toBe('S · F');
    // 'auto' in the global colour minor7 on ii sounds like Dm7.
    expect(findChordMenuOption(menu, C_MAJOR, { degree: 1, accidental: 0, chordType: 'auto' })?.name).toBe('Dm7');
  });

  it('minor keys: Picardy third in Tonika, major V in Dominante', () => {
    const m = buildChordMenu(A_MINOR);
    expect(m.find((o) => o.fields.templateId === 'picardy')?.group).toBe('tonic');
    expect(m.find((o) => o.fields.templateId === 'dominant')?.label).toBe('D · E');
    expect(m[0]!.label).toBe('t · Am');
  });
});
