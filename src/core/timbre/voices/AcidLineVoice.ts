import { clamp, PolyBlepOscillator, sanitizeSampleRate, ZdfSvfFilter } from '../../dsp';
import type {
  ParameterSchema,
  VoiceInstance,
  VoiceModule,
  VoiceRenderContext,
} from '../../registry/types';
import { midiToFreq } from '../../theory';
import {
  computeMelodyStep,
  EXTENDED_MELODY_OPTIONS,
  extendedMelodyDegree,
  fillChordDegrees,
  hash01,
  MELODY_CHORD_TONES_PARAM,
  MELODY_EXTRA_PARAMS,
  MELODY_LEAP_PARAM,
  MELODY_LENGTH_PARAM,
  MELODY_MAX_MODE,
  MELODY_RATE_PARAM,
  MELODY_REST_PARAM,
  MELODY_SEED_PARAM,
  shapeMelodyNote,
  type MelodyStepInfo,
} from '../../theory/melody';
import {
  clamp01,
  decayCoeff,
  detectNewTrigger,
  fastTanh,
  foldScaleInto,
  NoteHold,
  readParam,
  SUSTAIN_PARAM,
} from './voiceUtils';

/**
 * Acid-Linie im Stil der legendären Bass-Maschine: Säge/Rechteck durch ein
 * quietschendes, resonantes Tiefpass-Filter, dessen Hüllkurve bei jedem Ton
 * aufreißt. Akzente und Gleit-Töne werden deterministisch „gewürfelt“, die
 * Töne kommen aus dem gemeinsamen Melodie-Generator (immer in Tonart & Akkord).
 */

const SCALE_CAP = 24;

const WAVE_PARAM: ParameterSchema = {
  id: 'wave',
  label: 'Säge ↔ Rechteck',
  description: '0 = Sägezahn (scharf, klassisch), 1 = Rechteck (hohl, nasal).',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0,
  curve: 'linear',
  modulatable: true,
};

const CUTOFF_PARAM: ParameterSchema = {
  id: 'cutoff',
  label: 'Grund-Helligkeit',
  description: 'Wie offen das Filter zwischen den Tönen ist – die wichtigste Hand am Acid-Regler. Langsam bewegt = der typische Acid-Aufbau.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.3,
  curve: 'linear',
  modulatable: true,
};

const RESONANCE_PARAM: ParameterSchema = {
  id: 'resonance',
  label: 'Quietschen (Resonanz)',
  description: 'Betont die Filterkante – von rund bis zum singenden, zwitschernden Acid-Quaken.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.7,
  curve: 'linear',
  modulatable: true,
};

const ENV_MOD_PARAM: ParameterSchema = {
  id: 'envMod',
  label: 'Aufreißen pro Ton',
  description: 'Wie weit das Filter bei jedem Ton aufgeht („wau“) – 0 = statisch, 1 = maximaler Biss.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.55,
  curve: 'linear',
  modulatable: true,
};

const DECAY_PARAM: ParameterSchema = {
  id: 'decay',
  label: 'Filter-Ausklang',
  description: 'Wie schnell sich das Filter nach jedem Ton wieder schließt: kurz = „tock“, lang = „wauuu“.',
  domain: 'timbre',
  min: 0.04,
  max: 1.2,
  defaultValue: 0.22,
  curve: 'exp',
  modulatable: true,
  unitLabel: 's',
};

const NOTE_LENGTH_PARAM: ParameterSchema = {
  id: 'noteLength',
  label: 'Ton-Länge',
  description: 'Staccato (kurz getupft) bis legato (Töne gehen ineinander über).',
  domain: 'timbre',
  min: 0.03,
  max: 1,
  defaultValue: 0.35,
  curve: 'linear',
  modulatable: true,
};

const ACCENT_PARAM: ParameterSchema = {
  id: 'accent',
  label: 'Akzente',
  description: 'Wie viele Töne lauter und mit extra Filter-Biss gespielt werden (gewürfelt, wiederholt sich mit der Phrase).',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.35,
  curve: 'linear',
  modulatable: true,
};

const SLIDE_PARAM: ParameterSchema = {
  id: 'slide',
  label: 'Gleit-Töne',
  description: 'Wie viele Töne ohne neuen Anschlag in den nächsten Ton hineingleiten – das typische Acid-„Jaulen“.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.25,
  curve: 'linear',
  modulatable: true,
};

const DRIVE_PARAM: ParameterSchema = {
  id: 'drive',
  label: 'Verzerrung',
  description: 'Röhrenartige Sättigung nach dem Filter – macht die Linie dreckig und durchsetzungsstark.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.35,
  curve: 'linear',
  modulatable: true,
};

const OCTAVE_PARAM: ParameterSchema = {
  id: 'octaveShift',
  label: 'Oktavlage',
  description: '-1 = tiefer Bass-Bereich, 0 = klassische Acid-Lage, +1 = hohe Lead-Lage.',
  domain: 'harmony',
  min: -1,
  max: 2,
  step: 1,
  defaultValue: 0,
  curve: 'linear',
  modulatable: false,
};

const PATTERN_PARAM: ParameterSchema = {
  id: 'melodyPattern',
  label: 'Linien-Muster',
  description: 'Wie sich die Linie durch Tonleiter und Akkord bewegt.',
  domain: 'harmony',
  min: 0,
  max: MELODY_MAX_MODE,
  step: 1,
  defaultValue: 10,
  curve: 'linear',
  modulatable: false,
  options: [
    { value: 0, label: 'Grundton-Puls' },
    { value: 1, label: 'Grundton ↔ Oktave' },
    { value: 2, label: 'Skala aufwärts' },
    { value: 3, label: 'Grundton + Quinte' },
    { value: 4, label: 'Grundton, Terz, Quinte, Oktave' },
    ...EXTENDED_MELODY_OPTIONS,
  ],
};

const RANGE_PARAM: ParameterSchema = {
  id: 'melodyRange',
  label: 'Ton-Bewegung',
  description: 'Spannweite der Linie (klein = wenige Nachbartöne, groß = über zwei Oktaven).',
  domain: 'harmony',
  min: 0,
  max: 1,
  defaultValue: 0.4,
  curve: 'linear',
  modulatable: true,
};

const LEGACY_DEGREES_4 = new Int32Array([0, 2, 4, 7]);

export class AcidLineVoice implements VoiceInstance {
  private readonly hold = new NoteHold();
  private holdVel = 1;
  private readonly sampleRate: number;
  private readonly saw: PolyBlepOscillator;
  private readonly sq: PolyBlepOscillator;
  private readonly lp1: ZdfSvfFilter;
  private readonly lp2: ZdfSvfFilter;
  private readonly hp: ZdfSvfFilter;
  private readonly scaleBuf = new Float64Array(SCALE_CAP);
  private readonly chordDegBuf = new Int8Array(SCALE_CAP);
  private readonly degOut = new Float64Array(1);
  private readonly melInfo: MelodyStepInfo = { step: 0, phrase: 0, isNewNote: true };

  private noteCounter = 0;
  private curMidi = 45;
  private targetMidi = 45;
  private glideCoeff = 0;
  private ampEnv = 0;
  private ampCoeff = 0.999;
  private gate = 0;
  private filterEnv = 0;
  private accentAmt = 0;
  private hasNote = false;

  constructor(sampleRate: number) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.saw = new PolyBlepOscillator(this.sampleRate);
    this.saw.setWaveform('saw');
    this.sq = new PolyBlepOscillator(this.sampleRate);
    this.sq.setWaveform('pulse');
    this.sq.setPulseWidth(0.5);
    this.lp1 = new ZdfSvfFilter(this.sampleRate, 800, 0.7, 0);
    this.lp2 = new ZdfSvfFilter(this.sampleRate, 800, 2, 0);
    this.hp = new ZdfSvfFilter(this.sampleRate, 35, 0.7, 2);
  }

  public reset(): void {
    this.hold.reset();
    this.saw.reset(0);
    this.sq.reset(0);
    this.lp1.reset();
    this.lp2.reset();
    this.hp.reset();
    this.noteCounter = 0;
    this.ampEnv = 0;
    this.gate = 0;
    this.filterEnv = 0;
    this.accentAmt = 0;
    this.hasNote = false;
  }

  private pickNote(ctx: VoiceRenderContext, params: Record<string, number>): number {
    const octave = Math.round(readParam(OCTAVE_PARAM, params));
    let base = (Number.isFinite(ctx.harmony.rootMidi) ? ctx.harmony.rootMidi : 33) + 12 * (octave + 1);
    while (base < 28) base += 12;
    while (base > 84) base -= 12;
    const scaleLen = foldScaleInto(ctx.harmony.scaleNotesMidi, base, this.scaleBuf);
    const chordCount = fillChordDegrees(this.scaleBuf, scaleLen, ctx.harmony.chordNotesMidi, this.chordDegBuf);

    const mode = Math.round(readParam(PATTERN_PARAM, params));
    const mel = computeMelodyStep(
      this.noteCounter++,
      readParam(MELODY_RATE_PARAM, params),
      readParam(MELODY_LENGTH_PARAM, params),
      mode,
      this.melInfo,
    );
    const step = mel.step;
    const seed = readParam(MELODY_SEED_PARAM, params);
    const range = readParam(RANGE_PARAM, params);
    const octDegs = Math.max(1, Math.floor(scaleLen / 3));

    let deg = 0;
    let semis = 0;
    switch (mode) {
      case 0:
        deg = 0;
        break;
      case 1:
        deg = 0;
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

  public process(
    outL: Float32Array,
    outR: Float32Array,
    params: Record<string, number>,
    ctx: VoiceRenderContext,
  ): void {
    const count = Math.min(ctx.numSamples | 0, outL.length, outR.length);
    if (count <= 0) return;
    const sr = this.sampleRate;

    const wave = readParam(WAVE_PARAM, params);
    const cutoff = readParam(CUTOFF_PARAM, params);
    const resonance = readParam(RESONANCE_PARAM, params);
    const envMod = readParam(ENV_MOD_PARAM, params);
    const decay = readParam(DECAY_PARAM, params);
    const noteLength = readParam(NOTE_LENGTH_PARAM, params);
    const accentProb = readParam(ACCENT_PARAM, params);
    const slideProb = readParam(SLIDE_PARAM, params);
    const drive = readParam(DRIVE_PARAM, params);
    const sustain = readParam(SUSTAIN_PARAM, params);

    const trig = detectNewTrigger(ctx);
    if (trig > 0) {
      const counterBefore = this.noteCounter;
      const midi = this.pickNote(ctx, params);
      if (!Number.isNaN(midi)) {
        const seed = readParam(MELODY_SEED_PARAM, params) | 0;
        const step = this.melInfo.step;
        const timeAccent = Number.isFinite(ctx.timeFrame.accent) ? clamp01(ctx.timeFrame.accent) : 0.5;
        const isAccent = hash01(seed, step, 707) < accentProb * (0.6 + 0.4 * timeAccent);
        const isSlide = this.hasNote && this.gate > 0.5 && hash01(seed, counterBefore, 808) < slideProb * 0.8;
        this.targetMidi = midi;
        if (!this.hasNote) this.curMidi = midi;
        this.hasNote = true;
        this.glideCoeff = isSlide ? decayCoeff(0.045, sr) : 0;
        if (!isSlide) {
          this.curMidi = midi;
          this.ampEnv = Math.max(this.ampEnv * 0.3, 0.72 + 0.28 * trig);
          this.holdVel = 0.72 + 0.28 * trig;
        }
        this.accentAmt = isAccent ? 1 : 0;
        this.filterEnv = isSlide ? Math.max(this.filterEnv, 0.55) : 1;
        this.gate = 1;
      }
    }

    const holdFloor = this.hold.floor(ctx, trig, sustain, this.holdVel);
    // Ton-Länge: Gate-Zeit in Sekunden (wie lange der Ton nach dem Anschlag steht)
    const gateTime = 0.03 + noteLength * noteLength * 0.9;
    this.ampCoeff = decayCoeff(gateTime, sr);
    const filterCoeff = decayCoeff(decay * (this.accentAmt > 0 ? 0.65 : 1), sr);
    const resQ = 0.7 + resonance * resonance * 4.8 + this.accentAmt * resonance * 0.4;
    const baseHz = 90 * Math.pow(48, cutoff); // ~90 Hz … 4,3 kHz
    const envDepth = envMod * (1 + 0.6 * this.accentAmt);
    const ampAccent = 1 + 0.35 * this.accentAmt;
    const driveGain = 1 + drive * 5;
    const outGain = (0.85 / Math.sqrt(driveGain)) * (1 - 0.25 * resonance);
    const maxHz = sr * 0.42;
    const sawAmt = 1 - wave;
    const sqAmt = wave;

    let curMidi = this.curMidi;
    const targetMidi = this.targetMidi;
    const glideCoeff = this.glideCoeff;
    let ampEnv = this.ampEnv;
    let filterEnv = this.filterEnv;
    const ampCoeff = this.ampCoeff;

    for (let start = 0; start < count; start += 8) {
      const end = Math.min(start + 8, count);
      // Tonhöhe & Filter mit 8-Sample-Kontrollrate (billig, aber ohne Treppen hörbar)
      if (glideCoeff > 0) curMidi = targetMidi + (curMidi - targetMidi) * Math.pow(glideCoeff, end - start);
      else curMidi = targetMidi;
      const hz = clamp(midiToFreq(curMidi), 20, maxHz);
      this.saw.setFreq(hz);
      this.sq.setFreq(hz);
      const fHz = clamp(baseHz * (1 + envDepth * filterEnv * 14), 40, maxHz);
      this.lp1.setParams(fHz, 0.65, 0);
      this.lp2.setParams(fHz, resQ, 0);

      for (let i = start; i < end; i++) {
        const osc = this.saw.processSample() * sawAmt + this.sq.processSample() * sqAmt * 0.8;
        const f1 = this.lp1.processSample(osc);
        const f2 = this.lp2.processSample(fastTanh(f1 * 1.3));
        const shaped = fastTanh(f2 * driveGain) * outGain * ampEnv * ampAccent;
        const y = this.hp.processSample(shaped);
        const v = y * 0 === 0 ? y : 0;
        outL[i] = v;
        outR[i] = v;
        ampEnv *= ampCoeff;
        if (ampEnv < holdFloor) ampEnv = holdFloor;
        filterEnv *= filterCoeff;
      }
    }
    if (ampEnv < 1e-6) ampEnv = 0;
    if (filterEnv < 1e-6) filterEnv = 0;
    this.curMidi = curMidi;
    this.ampEnv = ampEnv;
    this.filterEnv = filterEnv;
    // Gate gilt als „offen“, solange der Ton noch deutlich klingt (für Gleit-Töne).
    this.gate = ampEnv > 0.12 ? 1 : 0;
  }
}

export const acidLineVoiceModule: VoiceModule = {
  id: 'acid-line',
  version: 1,
  category: 'bass',
  displayName: 'Acid-Linie (303-Stil)',
  description:
    'Quietschende, resonante Bass-Linie mit Akzenten und Gleit-Tönen – immer in Tonart & Akkord. Langsam an „Grund-Helligkeit“ drehen = Acid-Aufbau.',
  parameters: [
    WAVE_PARAM,
    CUTOFF_PARAM,
    RESONANCE_PARAM,
    ENV_MOD_PARAM,
    DECAY_PARAM,
    NOTE_LENGTH_PARAM,
    ACCENT_PARAM,
    SLIDE_PARAM,
    DRIVE_PARAM,
    OCTAVE_PARAM,
    PATTERN_PARAM,
    RANGE_PARAM,
    ...MELODY_EXTRA_PARAMS,
  ],
  createInstance(sampleRate: number): VoiceInstance {
    return new AcidLineVoice(sampleRate);
  },
};
