import type { ParameterSchema, VoiceRenderContext } from '../../registry/types';
import {
  computeMelodyStep,
  EXTENDED_MELODY_OPTIONS,
  extendedMelodyDegree,
  fillChordDegrees,
  MELODY_CHORD_TONES_PARAM,
  MELODY_LEAP_PARAM,
  MELODY_LENGTH_PARAM,
  MELODY_MAX_MODE,
  MELODY_RATE_PARAM,
  MELODY_REST_PARAM,
  MELODY_SEED_PARAM,
  shapeMelodyNote,
  type MelodyStepInfo,
} from '../../theory/melody';
import { foldScaleInto, readParam } from './voiceUtils';

/** Bass-Linien-Muster (gemeinsam für Reese- und Industrie-Bass). */
export function createBassPatternParam(defaultValue: number): ParameterSchema {
  return {
    id: 'melodyPattern',
    label: 'Bass-Linie',
    description: 'Welche Töne der Bass spielt – vom stoisch treibenden Grundton bis zu gewürfelten Linien in Tonart & Akkord.',
    domain: 'harmony',
    min: 0,
    max: MELODY_MAX_MODE,
    step: 1,
    defaultValue,
    curve: 'linear',
    modulatable: false,
    options: [
      { value: 0, label: 'Grundton (stoisch)' },
      { value: 1, label: 'Grundton ↔ Oktave' },
      { value: 2, label: 'Skala aufwärts' },
      { value: 3, label: 'Grundton ↔ Quinte' },
      { value: 4, label: 'Grundton, Terz, Quinte, Oktave' },
      ...EXTENDED_MELODY_OPTIONS,
    ],
  };
}

export const BASS_RANGE_PARAM: ParameterSchema = {
  id: 'melodyRange',
  label: 'Ton-Bewegung',
  description: 'Spannweite der Bass-Linie (klein = Nachbartöne, groß = über zwei Oktaven).',
  domain: 'harmony',
  min: 0,
  max: 1,
  defaultValue: 0.3,
  curve: 'linear',
  modulatable: true,
};

export function createBassOctaveParam(defaultValue: number): ParameterSchema {
  return {
    id: 'octaveShift',
    label: 'Oktavlage',
    description: '-1 = tief & drückend (Sub), 0 = klassische Basslage, +1 = mittig/aggressiv.',
    domain: 'harmony',
    min: -1,
    max: 1,
    step: 1,
    defaultValue,
    curve: 'linear',
    modulatable: false,
  };
}

const LEGACY_DEGREES_4 = [0, 2, 4, 7];

/** Wählt Bass-Noten aus Tonart & Akkord (zero alloc). */
export class BassNotePicker {
  private readonly scaleBuf = new Float64Array(24);
  private readonly chordDegBuf = new Int8Array(24);
  private readonly degOut = new Float64Array(1);
  public readonly mel: MelodyStepInfo = { step: 0, phrase: 0, isNewNote: true };
  private counter = 0;

  public reset(): void {
    this.counter = 0;
  }

  /** Nächste Note (MIDI) oder NaN für eine Pause. */
  public next(
    ctx: VoiceRenderContext,
    params: Record<string, number>,
    patternSchema: ParameterSchema,
    octaveSchema: ParameterSchema,
  ): number {
    const octave = Math.round(readParam(octaveSchema, params));
    let base = (Number.isFinite(ctx.harmony.rootMidi) ? ctx.harmony.rootMidi : 33) + 12 * octave;
    while (base < 24) base += 12;
    while (base > 64) base -= 12;
    const scaleLen = foldScaleInto(ctx.harmony.scaleNotesMidi, base, this.scaleBuf);
    const chordCount = fillChordDegrees(this.scaleBuf, scaleLen, ctx.harmony.chordNotesMidi, this.chordDegBuf);
    const mode = Math.round(readParam(patternSchema, params));
    const mel = computeMelodyStep(
      this.counter++,
      readParam(MELODY_RATE_PARAM, params),
      readParam(MELODY_LENGTH_PARAM, params),
      mode,
      this.mel,
    );
    const step = mel.step;
    const seed = readParam(MELODY_SEED_PARAM, params);
    const range = readParam(BASS_RANGE_PARAM, params);
    const octDegs = Math.max(1, Math.floor(scaleLen / 3));
    let deg = 0;
    let semis = 0;
    switch (mode) {
      case 0:
        break;
      case 1:
        semis = (step & 1) === 1 ? 12 : 0;
        break;
      case 2:
        deg = step % Math.max(2, Math.round(2 + range * octDegs));
        break;
      case 3:
        deg = (step & 1) === 1 ? Math.min(scaleLen - 1, 4) : 0;
        break;
      case 4: {
        const d = LEGACY_DEGREES_4[step & 3]!;
        deg = d === 7 ? 0 : Math.min(scaleLen - 1, d);
        semis = d === 7 ? 12 : 0;
        break;
      }
      default:
        deg = extendedMelodyDegree(mode, step, mel.phrase, range, scaleLen, this.chordDegBuf, chordCount, seed);
    }
    const jump = shapeMelodyNote(
      deg,
      step,
      seed,
      readParam(MELODY_CHORD_TONES_PARAM, params),
      readParam(MELODY_LEAP_PARAM, params),
      readParam(MELODY_REST_PARAM, params),
      this.chordDegBuf,
      chordCount,
      this.degOut,
    );
    if (Number.isNaN(jump)) return Number.NaN;
    deg = Math.max(0, Math.min(scaleLen - 1, this.degOut[0]!));
    return (this.scaleBuf[deg] ?? base) + semis + jump;
  }
}
