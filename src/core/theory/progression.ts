import type { ChordTransitionType, HarmonyFrame } from '../registry/types';
import {
  CHORD_PRESETS,
  findChordPresetByIntervals,
  getChordPreset,
  getProgressionPreset,
  isChordPresetId,
  type ChordPresetId,
} from './harmony';
import {
  getHeptatonicIntervals,
  getScaleDefinition,
  NOTE_NAMES,
  normalizePitchClass,
} from './scales';
import { DEFAULT_VOICING_RANGE, solveVoiceLeading } from './voiceLeading';

export type { ChordTransitionType };
export type ProgressionMode = 'preset' | 'custom';

/** One user-defined chord of the cadence builder ("Akkord-Baukasten"). */
export interface ChordStepConfig {
  readonly id: string;
  /** Scale degree 0..6 (I..VII). */
  readonly degree: number;
  /** -1 = b, 0 = natural, +1 = # */
  readonly accidental: -1 | 0 | 1;
  /** ChordPresetId or 'auto' (diatonic chord in the global colour). */
  readonly chordType: string;
  readonly durationBeats: number;
  readonly transitionType: ChordTransitionType;
  /** Length of the transition window at the end of this chord (beats). */
  readonly transitionBeats: number;
}

export interface HarmonySettings {
  readonly rootNote: number;
  readonly scaleId: string;
  readonly chordPreset: string;
  readonly progressionId: string;
  readonly progressionMode?: ProgressionMode;
  readonly customSteps?: readonly ChordStepConfig[];
  readonly voiceLeadingEnabled?: boolean;
}

export interface ResolvedChordStep {
  readonly startBeat: number;
  readonly durationBeats: number;
  /** Semitones from the key root, wrapped into -6..+5 (bass stays near the tonic). */
  readonly rootOffset: number;
  readonly rootPc: number;
  /** Intervals relative to the chord root. */
  readonly intervals: readonly number[];
  readonly chordPresetId: string;
  /** Roman numeral, e.g. "bVI", "ii", "V7". */
  readonly degreeLabel: string;
  /** Chord symbol, e.g. "Fmaj7". */
  readonly chordName: string;
  readonly transitionType: ChordTransitionType;
  readonly transitionBeats: number;
  /** Legacy parallel steps transpose the whole scale with the chord root. */
  readonly parallelScale: boolean;
}

export interface SolvedHarmonyStep extends ResolvedChordStep {
  readonly endBeat: number;
  readonly frame: HarmonyFrame;
}

export interface HarmonyTimeline {
  readonly steps: readonly SolvedHarmonyStep[];
  readonly totalBeats: number;
}

export const MIN_STEP_BEATS = 0.5;
export const MAX_STEP_BEATS = 128;
export const MAX_CUSTOM_STEPS = 128;

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'] as const;
const BASS_BASE_MIDI = 36;

const pcOf = (m: number): number => ((m % 12) + 12) % 12;

function wrapOffset(semitones: number): number {
  const pc = pcOf(Math.round(semitones));
  return pc >= 7 ? pc - 12 : pc;
}

/** Diatonic chord on a scale degree by stacking thirds of the (parent) scale. */
export function getDiatonicChordIntervals(
  scaleId: string,
  degree: number,
  noteCount: 3 | 4 | 5,
): number[] {
  const scale = getHeptatonicIntervals(scaleId);
  const d = ((Math.round(degree) % 7) + 7) % 7;
  const base = scale[d]!;
  const out: number[] = [];
  for (let k = 0; k < noteCount; k++) {
    const idx = d + 2 * k;
    out.push(scale[idx % 7]! + 12 * Math.floor(idx / 7) - base);
  }
  // A diatonic b9 (e.g. on iii / vii in major) is harsh: drop it.
  if (noteCount === 5 && out[4] === 13) out.pop();
  return out;
}

/** How many notes the global chord colour implies for 'auto' chords (null = use global chord as is). */
function autoNoteCount(globalChord: string): 3 | 4 | 5 | null {
  const preset = getChordPreset(globalChord);
  if (preset.id === 'sus2' || preset.id === 'sus4' || preset.id === 'power5') return null;
  if (preset.category === 'triad') return 3;
  if (preset.category === 'seventh') return 4;
  return 5;
}

function alteredAutoChord(accidental: -1 | 1, count: 3 | 4 | 5, degree: number): number[] {
  if (accidental === 1) {
    return count === 3 ? [...CHORD_PRESETS.dim.intervals] : [...CHORD_PRESETS.m7b5.intervals];
  }
  // Borrowed chords (bII, bIII, bVI, bVII) are major; bVII sounds best as dominant.
  if (count === 3) return [...CHORD_PRESETS.major.intervals];
  if (degree === 6) return [...(count === 5 ? CHORD_PRESETS.dom9 : CHORD_PRESETS.dom7).intervals];
  return [...(count === 5 ? CHORD_PRESETS.maj9 : CHORD_PRESETS.maj7).intervals];
}

export function resolveStepIntervals(
  scaleId: string,
  globalChord: string,
  degree: number,
  accidental: -1 | 0 | 1,
  chordType: string,
): number[] {
  if (chordType !== 'auto' && isChordPresetId(chordType)) {
    return [...CHORD_PRESETS[chordType].intervals];
  }
  const count = autoNoteCount(globalChord);
  if (count === null) return [...getChordPreset(globalChord).intervals];
  if (accidental !== 0) return alteredAutoChord(accidental, count, degree);
  return getDiatonicChordIntervals(scaleId, degree, count);
}

function chordSymbolFor(intervals: readonly number[]): { id: string; symbol: string } {
  const preset = findChordPresetByIntervals(intervals);
  if (preset) return { id: preset.id, symbol: preset.symbol };
  const hasMinor3 = intervals.includes(3);
  const hasMajor3 = intervals.includes(4);
  return { id: 'custom', symbol: hasMinor3 && !hasMajor3 ? 'm' : '' };
}

/** Roman numeral with quality (upper = major, lower = minor, ° = diminished). */
export function romanNumeral(
  degree: number,
  accidental: -1 | 0 | 1,
  intervals: readonly number[],
): string {
  const d = ((Math.round(degree) % 7) + 7) % 7;
  const prefix = accidental === -1 ? 'b' : accidental === 1 ? '#' : '';
  const isMinor = intervals.includes(3) && !intervals.includes(4);
  const isDim = intervals.includes(3) && intervals.includes(6) && !intervals.includes(7);
  const isAug = intervals.includes(4) && intervals.includes(8) && !intervals.includes(7);
  const base = ROMAN[d]!;
  const numeral = isMinor || isDim ? base.toLowerCase() : base;
  let suffix = '';
  if (isAug) suffix = intervals.includes(11) ? '+maj7' : intervals.includes(10) ? '+7' : '+';
  else if (isDim) suffix = intervals.includes(10) ? 'ø' : '°';
  else if (intervals.includes(10) && !isMinor && intervals.includes(4)) suffix = '7';
  else if (intervals.includes(11)) suffix = 'maj7';
  else if (intervals.includes(10)) suffix = '7';
  return `${prefix}${numeral}${suffix}`;
}

export function chordNameFor(rootPc: number, intervals: readonly number[]): string {
  return `${NOTE_NAMES[pcOf(rootPc)] ?? 'C'}${chordSymbolFor(intervals).symbol}`;
}

function clampDuration(beats: number): number {
  if (!Number.isFinite(beats)) return 4;
  return Math.min(MAX_STEP_BEATS, Math.max(MIN_STEP_BEATS, beats));
}

/**
 * Resolves the active harmony settings into a list of chord steps on a beat
 * timeline (preset or custom builder mode).
 */
export function resolveHarmonySteps(
  harmony: HarmonySettings,
  beatsPerBar: number,
): ResolvedChordStep[] {
  const keyPc = normalizePitchClass(harmony.rootNote);
  const bpb = Number.isFinite(beatsPerBar) && beatsPerBar > 0 ? beatsPerBar : 4;
  const out: ResolvedChordStep[] = [];
  let cursor = 0;

  const pushStep = (
    rootOffsetRaw: number,
    intervals: number[],
    durationBeats: number,
    degreeLabel: string,
    transitionType: ChordTransitionType,
    transitionBeats: number,
    parallelScale: boolean,
  ) => {
    const rootOffset = wrapOffset(rootOffsetRaw);
    const rootPc = pcOf(keyPc + rootOffset);
    const sym = chordSymbolFor(intervals);
    const dur = clampDuration(durationBeats);
    out.push({
      startBeat: cursor,
      durationBeats: dur,
      rootOffset,
      rootPc,
      intervals,
      chordPresetId: sym.id,
      degreeLabel,
      chordName: `${NOTE_NAMES[rootPc] ?? 'C'}${sym.symbol}`,
      transitionType,
      transitionBeats: Math.max(0, Math.min(dur * 0.5, transitionBeats)),
      parallelScale,
    });
    cursor += dur;
  };

  const custom = harmony.customSteps ?? [];
  if (harmony.progressionMode === 'custom' && custom.length > 0) {
    const scale = getHeptatonicIntervals(harmony.scaleId);
    for (const step of custom.slice(0, MAX_CUSTOM_STEPS)) {
      const degree = ((Math.round(step.degree) % 7) + 7) % 7;
      const acc = step.accidental === -1 || step.accidental === 1 ? step.accidental : 0;
      const intervals = resolveStepIntervals(
        harmony.scaleId,
        harmony.chordPreset,
        degree,
        acc,
        step.chordType,
      );
      pushStep(
        scale[degree]! + acc,
        intervals,
        step.durationBeats,
        romanNumeral(degree, acc, intervals),
        step.transitionType ?? 'cut',
        step.transitionBeats ?? 0,
        false,
      );
    }
    return out;
  }

  const preset = getProgressionPreset(harmony.progressionId);
  if (preset.steps && preset.steps.length > 0) {
    const scale = getHeptatonicIntervals(harmony.scaleId);
    for (const def of preset.steps) {
      const degree = ((Math.round(def.degree) % 7) + 7) % 7;
      const acc = def.accidental ?? 0;
      const intervals = resolveStepIntervals(
        harmony.scaleId,
        harmony.chordPreset,
        degree,
        acc,
        def.chordType ?? 'auto',
      );
      pushStep(
        scale[degree]! + acc,
        intervals,
        (def.bars ?? 1) * bpb,
        romanNumeral(degree, acc, intervals),
        'cut',
        0,
        false,
      );
    }
    return out;
  }

  // Legacy "Techno-Parallel": global chord type transposed by semitone offsets per bar.
  const chordIntervals = [...getChordPreset(harmony.chordPreset).intervals];
  const offsets = preset.semitoneOffsets ?? [0];
  for (const off of offsets.length > 0 ? offsets : [0]) {
    const wrapped = wrapOffset(off);
    const deg = degreeLabelForOffset(harmony.scaleId, wrapped, chordIntervals);
    pushStep(off, chordIntervals, bpb, deg, 'cut', 0, true);
  }
  return out;
}

function degreeLabelForOffset(
  scaleId: string,
  offset: number,
  intervals: readonly number[],
): string {
  const { degree, accidental } = offsetToDegree(scaleId, offset);
  return romanNumeral(degree, accidental, intervals);
}

/** Maps a semitone offset to the closest scale degree (+ accidental). */
export function offsetToDegree(
  scaleId: string,
  offset: number,
): { degree: number; accidental: -1 | 0 | 1 } {
  const scale = getHeptatonicIntervals(scaleId);
  const pc = pcOf(offset);
  const exact = scale.indexOf(pc);
  if (exact >= 0) return { degree: exact, accidental: 0 };
  const flatOf = scale.indexOf(pcOf(pc + 1));
  if (flatOf >= 0) return { degree: flatOf, accidental: -1 };
  const sharpOf = scale.indexOf(pcOf(pc - 1));
  if (sharpOf >= 0) return { degree: sharpOf, accidental: 1 };
  return { degree: 0, accidental: 0 };
}

/** Key scale with non-scale chord tones substituting their nearest neighbour. */
export function buildChordScalePcs(
  keyPc: number,
  scaleId: string,
  chordPcs: readonly number[],
): Set<number> {
  const set = new Set(getScaleDefinition(scaleId).intervals.map((i) => pcOf(keyPc + i)));
  const chordSet = new Set(chordPcs);
  for (const pc of chordPcs) {
    if (set.has(pc)) continue;
    const down = pcOf(pc - 1);
    const up = pcOf(pc + 1);
    if (set.has(down) && !chordSet.has(down)) set.delete(down);
    else if (set.has(up) && !chordSet.has(up)) set.delete(up);
    set.add(pc);
  }
  return set;
}

function notesInRange(pcs: Set<number>, minMidi: number, maxMidi: number): number[] {
  const out: number[] = [];
  for (let m = minMidi; m <= maxMidi; m++) if (pcs.has(pcOf(m))) out.push(m);
  return out;
}

/**
 * Builds the complete, pre-computed harmony timeline (voicings, bass, chord
 * scales) for the engine and UI. Pure; call only when settings change.
 */
export function buildHarmonyTimeline(
  harmony: HarmonySettings,
  beatsPerBar: number,
): HarmonyTimeline {
  const steps = resolveHarmonySteps(harmony, beatsPerBar);
  const keyPc = normalizePitchClass(harmony.rootNote);
  // A single chord has nothing to lead to: keep the classic root-position voicing.
  const voiceLeading = harmony.voiceLeadingEnabled !== false && steps.length > 1;

  const voicings = voiceLeading
    ? solveVoiceLeading(
        steps.map((st) => ({ rootPc: st.rootPc, intervals: st.intervals })),
        DEFAULT_VOICING_RANGE,
      )
    : steps.map((st) => {
        const rootMidi = BASS_BASE_MIDI + keyPc + st.rootOffset;
        return st.intervals.slice(0, 6).map((i) => rootMidi + 12 + i);
      });

  const solved: SolvedHarmonyStep[] = steps.map((st, idx) => {
    const rootMidi = BASS_BASE_MIDI + keyPc + st.rootOffset;
    const chordNotesMidi = voicings[idx] ?? [];
    let scaleNotesMidi: number[];
    if (st.parallelScale) {
      // Legacy behaviour: the scale moves with the chord root.
      const def = getScaleDefinition(harmony.scaleId);
      const set = new Set(def.intervals.map((i) => pcOf(st.rootPc + i)));
      scaleNotesMidi = notesInRange(set, 24, 96);
    } else {
      const chordPcs = st.intervals.map((i) => pcOf(st.rootPc + i));
      scaleNotesMidi = notesInRange(buildChordScalePcs(keyPc, harmony.scaleId, chordPcs), 24, 96);
    }
    const frame: HarmonyFrame = {
      rootNote: st.rootPc,
      rootMidi,
      keyRootMidi: BASS_BASE_MIDI + keyPc,
      bassMidi: rootMidi,
      scaleId: harmony.scaleId,
      chordPreset: st.chordPresetId,
      scaleNotesMidi,
      chordNotesMidi,
      stepIndex: idx,
    };
    return { ...st, endBeat: st.startBeat + st.durationBeats, frame };
  });

  const totalBeats = solved.length > 0 ? solved[solved.length - 1]!.endBeat : beatsPerBar;
  return { steps: solved, totalBeats: Math.max(MIN_STEP_BEATS, totalBeats) };
}

/** Finds the step index for an absolute beat position (looping). */
export function findStepIndexAtBeat(timeline: HarmonyTimeline, beat: number): number {
  const total = timeline.totalBeats;
  const pos = ((beat % total) + total) % total;
  const steps = timeline.steps;
  for (let i = 0; i < steps.length; i++) {
    if (pos < steps[i]!.endBeat) return i;
  }
  return Math.max(0, steps.length - 1);
}

/**
 * Legacy helper: harmony frame for a bar index (4/4 bar grid).
 */
export function computeHarmonyFrame(
  rootNote: number,
  scaleId: string,
  chordPreset: string,
  progressionId: string,
  barIndex: number,
): HarmonyFrame {
  const timeline = buildHarmonyTimeline(
    { rootNote, scaleId, chordPreset, progressionId, voiceLeadingEnabled: false },
    4,
  );
  const safeBar = Number.isFinite(barIndex) ? Math.floor(barIndex) : 0;
  const idx = findStepIndexAtBeat(timeline, safeBar * 4);
  return timeline.steps[idx]!.frame;
}

/**
 * Converts the currently selected preset (or legacy progression) into editable
 * builder steps, so a cadence can be loaded into the "Baukasten" and tweaked.
 */
export function presetToCustomSteps(
  harmony: HarmonySettings,
  beatsPerBar: number,
  makeId: () => string,
): ChordStepConfig[] {
  const preset = getProgressionPreset(harmony.progressionId);
  const bpb = Number.isFinite(beatsPerBar) && beatsPerBar > 0 ? beatsPerBar : 4;
  if (preset.steps && preset.steps.length > 0) {
    return preset.steps.map((def) => ({
      id: makeId(),
      degree: def.degree,
      accidental: def.accidental ?? 0,
      chordType: def.chordType ?? 'auto',
      durationBeats: (def.bars ?? 1) * bpb,
      transitionType: 'cut',
      transitionBeats: 0,
    }));
  }
  // Legacy parallel progression: keep the global chord type fixed per step and
  // merge consecutive identical bars.
  const offsets = preset.semitoneOffsets ?? [0];
  const steps: ChordStepConfig[] = [];
  for (const off of offsets) {
    const { degree, accidental } = offsetToDegree(harmony.scaleId, off);
    const prev = steps[steps.length - 1];
    if (prev && prev.degree === degree && prev.accidental === accidental) {
      steps[steps.length - 1] = { ...prev, durationBeats: prev.durationBeats + bpb };
      continue;
    }
    steps.push({
      id: makeId(),
      degree,
      accidental,
      chordType: isChordPresetId(harmony.chordPreset) ? harmony.chordPreset : 'auto',
      durationBeats: bpb,
      transitionType: 'cut',
      transitionBeats: 0,
    });
  }
  return steps;
}

/** Chord name preview for a degree button (e.g. "VI · F"). */
export function previewDegreeChord(
  harmony: HarmonySettings,
  degree: number,
  accidental: -1 | 0 | 1,
  chordType: string = 'auto',
): { roman: string; name: string } {
  const scale = getHeptatonicIntervals(harmony.scaleId);
  const intervals = resolveStepIntervals(
    harmony.scaleId,
    harmony.chordPreset,
    degree,
    accidental,
    chordType,
  );
  const rootPc = pcOf(normalizePitchClass(harmony.rootNote) + scale[degree]! + accidental);
  return {
    roman: romanNumeral(degree, accidental, intervals),
    name: chordNameFor(rootPc, intervals),
  };
}

export function midiToNoteLabel(midi: number): string {
  const name = NOTE_NAMES[pcOf(midi)] ?? 'C';
  return `${name}${Math.floor(midi / 12) - 1}`;
}

export type { ChordPresetId };
