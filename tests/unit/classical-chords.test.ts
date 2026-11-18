import { describe, expect, it } from 'vitest';
import {
  buildHarmonyTimeline,
  CHORD_PRESETS,
  CLASSICAL_TEMPLATES,
  NOTE_NAMES,
  pcToDegreeAccidental,
  presetToCustomSteps,
  resolveClassicalTemplate,
  resolveHarmonySteps,
  type ClassicalTemplateId,
  type HarmonySettings,
} from '../../src/core/theory';

const A_MINOR: HarmonySettings = {
  rootNote: 9,
  scaleId: 'natural_minor',
  chordPreset: 'minor',
  progressionId: 'static',
};
const C_MAJOR: HarmonySettings = {
  rootNote: 0,
  scaleId: 'major',
  chordPreset: 'major',
  progressionId: 'static',
};

/** Resolves a single template chord in a key → note names (root first) + bass. */
function chordOf(h: HarmonySettings, id: ClassicalTemplateId) {
  const r = resolveClassicalTemplate(id, h.scaleId);
  const steps = resolveHarmonySteps(
    {
      ...h,
      progressionMode: 'custom',
      customSteps: [
        {
          id: 'x',
          degree: 0,
          accidental: 0,
          chordType: 'auto',
          durationBeats: 4,
          transitionType: 'cut',
          transitionBeats: 0,
          bass: r.bass,
          templateId: id,
        },
      ],
    },
    4,
  );
  const st = steps[0]!;
  return {
    notes: st.intervals.map((i) => NOTE_NAMES[(st.rootPc + i) % 12]),
    bass: NOTE_NAMES[st.bassPc],
    name: st.chordName,
    fn: st.functionLabel,
  };
}

describe('Classical chord types', () => {
  it('defines the augmented sixth chords', () => {
    expect(CHORD_PRESETS.it6.intervals).toEqual([0, 4, 10]);
    expect(CHORD_PRESETS.fr6.intervals).toEqual([0, 4, 6, 10]);
    expect(CHORD_PRESETS.ger6.intervals).toEqual([0, 4, 7, 10]);
    expect(CHORD_PRESETS.ger6.category).toBe('classical');
  });

  it('maps pitch classes to degree + accidental with the right letter', () => {
    expect(pcToDegreeAccidental('natural_minor', 1, 1)).toEqual({ degree: 1, accidental: -1 });
    expect(pcToDegreeAccidental('major', 8, 5)).toEqual({ degree: 5, accidental: -1 });
    expect(pcToDegreeAccidental('natural_minor', 8, 5)).toEqual({ degree: 5, accidental: 0 });
    expect(pcToDegreeAccidental('natural_minor', 11, 6)).toEqual({ degree: 6, accidental: 1 });
    expect(pcToDegreeAccidental('major', 6)).toEqual({ degree: 4, accidental: -1 });
  });
});

describe('Function templates (a minor / C major)', () => {
  it('Neapolitan: Bb/D in a minor, Db/F in C major', () => {
    const a = chordOf(A_MINOR, 'neapolitan');
    expect(a.notes).toEqual(['A#', 'D', 'F']);
    expect(a.bass).toBe('D');
    expect(a.fn).toBe('N⁶');
    const c = chordOf(C_MAJOR, 'neapolitan');
    expect(c.notes).toEqual(['C#', 'F', 'G#']);
    expect(c.bass).toBe('F');
  });

  it('Sixte ajoutée: Dm6 in a minor, F6 in C major', () => {
    expect(chordOf(A_MINOR, 'sixte-ajoutee').notes).toEqual(['D', 'F', 'A', 'B']);
    expect(chordOf(C_MAJOR, 'sixte-ajoutee').notes).toEqual(['F', 'A', 'C', 'D']);
  });

  it('augmented sixths on bVI', () => {
    expect(chordOf(A_MINOR, 'it6').notes).toEqual(['F', 'A', 'D#']);
    expect(chordOf(A_MINOR, 'fr6').notes).toEqual(['F', 'A', 'B', 'D#']);
    expect(chordOf(A_MINOR, 'ger6').notes).toEqual(['F', 'A', 'C', 'D#']);
    expect(chordOf(C_MAJOR, 'it6').notes).toEqual(['G#', 'C', 'F#']);
    expect(chordOf(C_MAJOR, 'fr6').notes).toEqual(['G#', 'C', 'D', 'F#']);
    const ger = chordOf(C_MAJOR, 'ger6');
    expect(ger.notes).toEqual(['G#', 'C', 'D#', 'F#']);
    expect(ger.bass).toBe('G#');
    // Enharmonic dom7 twin keeps its own name.
    expect(ger.name).toContain('Dt⁺⁶');
  });

  it('double dominant, Picardy, minor subdominant, vii°7, mediants', () => {
    expect(chordOf(A_MINOR, 'double-dominant').notes).toEqual(['B', 'D#', 'F#', 'A']);
    expect(chordOf(C_MAJOR, 'double-dominant').notes).toEqual(['D', 'F#', 'A', 'C']);
    expect(chordOf(A_MINOR, 'picardy').notes).toEqual(['A', 'C#', 'E']);
    expect(chordOf(C_MAJOR, 'subdominant-minor').notes).toEqual(['F', 'G#', 'C']);
    expect(chordOf(A_MINOR, 'leading-dim7').notes).toEqual(['G#', 'B', 'D', 'F']);
    expect(chordOf(C_MAJOR, 'leading-dim7').notes).toEqual(['B', 'D', 'F', 'G#']);
    expect(chordOf(C_MAJOR, 'mediant-flat3').notes).toEqual(['D#', 'G', 'A#']);
    expect(chordOf(C_MAJOR, 'mediant-flat6').notes).toEqual(['G#', 'C', 'D#']);
  });

  it('secondary dominants resolve a fifth above their target', () => {
    expect(chordOf(C_MAJOR, 'sec-dom-ii').notes[0]).toBe('A');
    expect(chordOf(C_MAJOR, 'sec-dom-vi').notes[0]).toBe('E');
    expect(chordOf(C_MAJOR, 'sec-dom-iv').notes).toEqual(['C', 'E', 'G', 'A#']);
    expect(chordOf(A_MINOR, 'sec-dom-iv').notes[0]).toBe('A');
    for (const tpl of Object.values(CLASSICAL_TEMPLATES)) {
      // Every template resolves without throwing in every scale family.
      for (const sc of ['major', 'natural_minor', 'harmonic_minor', 'dorian', 'minor_pentatonic']) {
        const r = resolveClassicalTemplate(tpl.id, sc);
        expect(r.degree).toBeGreaterThanOrEqual(0);
        expect(r.degree).toBeLessThan(7);
      }
    }
  });
});

describe('Classical cadences', () => {
  it('Neapolitan cadence in a minor: Am – Bb/D – E7 – Am', () => {
    const tl = buildHarmonyTimeline({ ...A_MINOR, progressionId: 'cad_neapolitan' }, 4);
    expect(tl.steps.map((s) => s.chordName)).toEqual(['Am', 'A#/D', 'E7', 'Am']);
    expect(tl.steps[1]!.functionLabel).toBe('N⁶');
    expect(tl.totalBeats).toBe(16);
  });

  it('Picardy cadence ends on a major tonic', () => {
    const tl = buildHarmonyTimeline({ ...A_MINOR, progressionId: 'cad_picardy' }, 4);
    expect(tl.steps.map((s) => s.chordName)).toEqual(['Am', 'Dm', 'E7', 'A']);
  });

  it('loads into the builder with template ids that follow a scale change', () => {
    const steps = presetToCustomSteps({ ...A_MINOR, progressionId: 'cad_german_sixth' }, 4, () => 'id');
    expect(steps[1]!.templateId).toBe('ger6');
    expect(steps[0]!.templateId).toBeUndefined();
    const inMajor = resolveHarmonySteps(
      { ...C_MAJOR, progressionMode: 'custom', customSteps: steps },
      4,
    );
    // bVI in C major = Ab (flat), in a minor = F (natural).
    expect(inMajor[1]!.rootPc).toBe(8);
  });

  it('German sixth → V: bass and #4 move outward by a semitone to the octave', () => {
    const tl = buildHarmonyTimeline({ ...A_MINOR, progressionId: 'cad_german_sixth' }, 4);
    const ger = tl.steps[1]!;
    const v = tl.steps[2]!;
    // Bass: F (b6) down to E.
    expect(v.frame.bassMidi! - ger.frame.bassMidi!).toBe(-1);
    // Upper voice: D# (#4) up to E.
    const sharp4 = ger.frame.chordNotesMidi.find((m) => m % 12 === 3);
    expect(sharp4).toBeDefined();
    expect(v.frame.chordNotesMidi).toContain(sharp4! + 1);
  });

  it('old cadences are unchanged', () => {
    const tl = buildHarmonyTimeline({ ...C_MAJOR, progressionId: 'cad_major_full' }, 4);
    expect(tl.steps.map((s) => s.chordName)).toEqual(['C', 'F', 'G', 'C']);
    expect(tl.steps.every((s) => s.functionLabel === null)).toBe(true);
    const dom = buildHarmonyTimeline({ ...C_MAJOR, progressionId: 'cad_jazz_minor' }, 4);
    expect(dom.steps[1]!.chordName).toBe('G7');
  });
});
