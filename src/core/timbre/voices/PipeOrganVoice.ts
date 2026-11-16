import {
  clamp,
  OnePoleSmoother,
  sanitizeSampleRate,
  StereoDCBlocker,
  WhiteNoiseGenerator,
  ZdfSvfFilter,
} from '../../dsp';
import {
  type ParameterSchema,
  type VoiceInstance,
  type VoiceModule,
  type VoiceRenderContext,
} from '../../registry/types';
import { midiToFreq } from '../../theory';
import {
  computeMelodyStep,
  EXTENDED_MELODY_OPTIONS,
  extendedMelodyDegree,
  fillChordDegrees,
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

const TWO_PI = Math.PI * 2;
const NUM_VOICES = 4;
const NUM_DRAWBARS = 6;
const SCALE_BUF_CAP = 24;
const TREMOLO_LFO_HZ = 5.2;

// Drawbar harmonic multipliers: 16' (0.5x), 8' (1x), 4' (2x), 2 2/3' Nasat (3x), 2' (4x), 1 3/5' Terz (5x)
const DRAWBAR_MULTS = new Float64Array([0.5, 1.0, 2.0, 3.0, 4.0, 5.0]);
// Drawbar registration profiles: Flute (0.0) -> Rich Drawbar (0.5) -> Church Mixture (1.0)
const REG_FLUTE = new Float64Array([0.24, 0.78, 0.18, 0.02, 0.0, 0.0]);
const REG_DRAWBAR = new Float64Array([0.42, 0.64, 0.48, 0.30, 0.22, 0.12]);
const REG_MIXTURE = new Float64Array([0.34, 0.50, 0.54, 0.44, 0.44, 0.36]);

const SPRUNG_DEGREES = new Int32Array([0, 4, 2, 5, 1, 6, 3, 4]);

function fastTanh(x: number): number {
  if (x <= -3) return -1;
  if (x >= 3) return 1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

const REGISTER_PARAM: ParameterSchema = {
  id: 'register',
  label: 'Register (Flöte ↔ Mixtur)',
  description:
    'Blendet stufenlos von warmer 8′-Flöte über volle Zugriegel bis zur hellen Kirchen-Mixtur.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.55,
  curve: 'linear',
  modulatable: true,
};

const CHIFF_PARAM: ParameterSchema = {
  id: 'chiff',
  label: 'Anblas-Chiff (Luft)',
  description:
    'Regelt das typische Luft- und Anblasgeräusch der Orgelpfeifen beim Tonansatz.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.38,
  curve: 'linear',
  modulatable: true,
};

const TREMOLO_PARAM: ParameterSchema = {
  id: 'tremolo',
  label: 'Pfeifen-Tremulant',
  description:
    'Erzeugt schwebende Tremulant-Modulation und räumliche C/C#-Pfeifenlade.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.28,
  curve: 'linear',
  modulatable: true,
};

const RELEASE_PARAM: ParameterSchema = {
  id: 'release',
  label: 'Ausklang',
  description: 'Bestimmt Nachhall und Ausschwingzeit der Orgelpfeifen.',
  domain: 'timbre',
  min: 0.04,
  max: 1.8,
  defaultValue: 0.32,
  curve: 'exp',
  modulatable: true,
  unitLabel: 's',
};

const DRONE_HOLD_PARAM: ParameterSchema = {
  id: 'droneHold',
  label: 'Dauerton (Durchgehend)',
  description:
    '0 = folgt den Puls-Wellen rhythmisch, 1 = hält den Orgelton durchgehend ohne Wellen-Auf-und-Ab.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0,
  curve: 'linear',
  modulatable: true,
};

const VOICE_MODE_PARAM: ParameterSchema = {
  id: 'voiceMode',
  label: 'Stimm-Modus',
  description:
    '0=Einzelstimme (Oberstimme), 1=Oktav/Quinte-Duett, 2=Orgel-Akkord',
  domain: 'harmony',
  min: 0,
  max: 2,
  step: 1,
  defaultValue: 0,
  curve: 'linear',
  modulatable: false,
  options: [
    { value: 0, label: 'Einzelstimme (Oberstimme)' },
    { value: 1, label: 'Oktav/Quinte-Duett' },
    { value: 2, label: 'Orgel-Akkord' },
  ],
};

const OCTAVE_SHIFT_PARAM: ParameterSchema = {
  id: 'octaveShift',
  label: 'Oktavlage',
  description: 'Verschiebt die Tonlage des Pfeifenwerks um ganze Oktaven.',
  domain: 'harmony',
  min: -1,
  max: 2,
  step: 1,
  defaultValue: 1,
  curve: 'linear',
  modulatable: false,
};

const MELODY_PATTERN_PARAM: ParameterSchema = {
  id: 'melodyPattern',
  label: 'Melodie-Bewegung',
  description:
    'Wie sich die Orgelstimme bewegt – Grundton, Pendel, Läufe, Akkord-Arpeggien oder gewürfelte Motive. Im Orgel-Akkord-Modus wird der ganze Akkord mitbewegt.',
  domain: 'harmony',
  min: 0,
  max: MELODY_MAX_MODE,
  step: 1,
  defaultValue: 1,
  curve: 'linear',
  modulatable: false,
  options: [
    { value: 0, label: 'Grundton/Akkord' },
    { value: 1, label: 'Pendel 1–5' },
    { value: 2, label: 'Skala-Lauf' },
    { value: 3, label: 'Sprung-Rätsel' },
    { value: 4, label: 'Quinte/Terz-Duett' },
    ...EXTENDED_MELODY_OPTIONS,
  ],
};

const MELODY_RANGE_PARAM: ParameterSchema = {
  id: 'melodyRange',
  label: 'Ton-Bewegung',
  description: 'Spannweite der Melodie für Läufe, Arpeggien und Zufallsmodi (klein = enge Schritte, groß = über mehrere Oktaven).',
  domain: 'harmony',
  min: 0,
  max: 1,
  defaultValue: 0.45,
  curve: 'linear',
  modulatable: true,
};

const DUET_DEGREES = new Int32Array([0, 2, 4, 2, 0, 3, 4, 1]);

function readParam(schema: ParameterSchema, params: Record<string, number>): number {
  const raw = params[schema.id];
  const candidate = raw !== undefined && Number.isFinite(raw) ? raw : schema.defaultValue;
  const min = schema.min;
  const max = schema.max;
  const clamped = candidate < min ? min : candidate > max ? max : candidate;
  const step = schema.step;
  if (step === undefined || step <= 0) return clamped;
  const snapped = min + Math.round((clamped - min) / step) * step;
  return snapped < min ? min : snapped > max ? max : snapped;
}

export class PipeOrganVoice implements VoiceInstance {
  private readonly sampleRate: number;
  private readonly dcBlocker: StereoDCBlocker;
  private readonly chiffNoise: WhiteNoiseGenerator;
  private readonly chiffFilterL: ZdfSvfFilter;
  private readonly chiffFilterR: ZdfSvfFilter;

  private readonly registerSmoother: OnePoleSmoother;
  private readonly chiffSmoother: OnePoleSmoother;
  private readonly tremoloSmoother: OnePoleSmoother;

  // Polyphonic pipe voice state (4 voices)
  private readonly voicePhase = new Float64Array(NUM_VOICES);
  private readonly voiceTargetMidi = new Float64Array(NUM_VOICES);
  private readonly voiceCachedMidi = new Float64Array(NUM_VOICES);
  private readonly voiceHz = new Float64Array(NUM_VOICES);
  private readonly voiceEnv = new Float64Array(NUM_VOICES);
  private readonly voiceActiveTarget = new Uint8Array(NUM_VOICES);
  private readonly voicePanCos = new Float64Array(NUM_VOICES);
  private readonly voicePanSin = new Float64Array(NUM_VOICES);

  // Pre-allocated buffers
  private readonly scaleBuf = new Float64Array(SCALE_BUF_CAP);
  private readonly drawbarGains = new Float64Array(NUM_DRAWBARS);
  private readonly chiffBufL = new Float32Array(8);
  private readonly chiffBufR = new Float32Array(8);
  private readonly prevVoiceMidi = new Float64Array(NUM_VOICES);
  private readonly prevVoiceActive = new Uint8Array(NUM_VOICES);

  private readonly attackCoeff: number;
  private readonly chiffAttackStep: number;
  private readonly chiffDecayCoeff: number;
  private readonly lfoInc: number;

  private lfoPhase = 0;
  private trigEnv = 0;
  private chiffEnv = 0;
  private chiffAttack = 1;
  private chiffCenterHz = 1800;

  private noteCounter = 0;
  private readonly melInfo: MelodyStepInfo = { step: 0, phrase: 0, isNewNote: true };
  private readonly chordDegBuf = new Int8Array(SCALE_BUF_CAP);
  private readonly degOut = new Float64Array(1);
  private melodyParams: Record<string, number> = {};
  private hasInitializedNotes = false;
  private hasSeenTrigger = false;
  private lastRelease = -1;
  private readonly gateReleaseCoeff: number;
  private trigDecayCoeff = 0.999;
  private lastVoiceMode = -1;
  private lastOctaveShift = 999;
  private lastRootMidi = -1;
  private lastMelodyPattern = -1;

  constructor(sampleRate: number) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.dcBlocker = new StereoDCBlocker(this.sampleRate, 18);
    this.chiffNoise = new WhiteNoiseGenerator(0x52c8a31f);
    this.chiffFilterL = new ZdfSvfFilter(this.sampleRate, 1800, 2.2, 1);
    this.chiffFilterR = new ZdfSvfFilter(this.sampleRate, 1980, 2.2, 1);

    this.registerSmoother = new OnePoleSmoother(
      this.sampleRate,
      14,
      REGISTER_PARAM.defaultValue,
    );
    this.chiffSmoother = new OnePoleSmoother(
      this.sampleRate,
      12,
      CHIFF_PARAM.defaultValue,
    );
    this.tremoloSmoother = new OnePoleSmoother(
      this.sampleRate,
      15,
      TREMOLO_PARAM.defaultValue,
    );

    this.attackCoeff = Math.exp(-1 / (0.0035 * this.sampleRate));
    this.gateReleaseCoeff = Math.exp(-1 / (0.008 * this.sampleRate));
    this.chiffAttackStep = 1 / Math.max(1, Math.round(0.0015 * this.sampleRate));
    // ~18 ms chiff burst (tau = 7.5 ms -> >90% decayed by 18 ms)
    this.chiffDecayCoeff = Math.exp(-1 / (0.0075 * this.sampleRate));
    this.lfoInc = TREMOLO_LFO_HZ / this.sampleRate;

    for (let v = 0; v < NUM_VOICES; v++) {
      this.voicePhase[v] = (v * 0.19) % 1;
      this.voiceTargetMidi[v] = 60;
      this.voiceCachedMidi[v] = Number.NaN;
      this.voiceHz[v] = 261.63;
      this.voiceEnv[v] = 0;
      this.voiceActiveTarget[v] = 0;
      this.voicePanCos[v] = 0.70710678;
      this.voicePanSin[v] = 0.70710678;
    }
  }

  public reset(): void {
    this.dcBlocker.reset();
    this.chiffNoise.reset();
    this.chiffFilterL.reset();
    this.chiffFilterR.reset();
    this.registerSmoother.reset(REGISTER_PARAM.defaultValue);
    this.chiffSmoother.reset(CHIFF_PARAM.defaultValue);
    this.tremoloSmoother.reset(TREMOLO_PARAM.defaultValue);

    for (let v = 0; v < NUM_VOICES; v++) {
      this.voicePhase[v] = (v * 0.19) % 1;
      this.voiceTargetMidi[v] = 60;
      this.voiceCachedMidi[v] = Number.NaN;
      this.voiceHz[v] = 261.63;
      this.voiceEnv[v] = 0;
      this.voiceActiveTarget[v] = 0;
      this.prevVoiceMidi[v] = Number.NaN;
      this.prevVoiceActive[v] = 0;
    }

    this.lfoPhase = 0;
    this.trigEnv = 0;
    this.chiffEnv = 0;
    this.chiffAttack = 1;
    this.chiffCenterHz = 1800;
    this.noteCounter = 0;
    this.hasInitializedNotes = false;
    this.hasSeenTrigger = false;
    this.lastRelease = -1;
    this.lastVoiceMode = -1;
    this.lastOctaveShift = 999;
    this.lastRootMidi = -1;
    this.lastMelodyPattern = -1;
  }

  private fillFoldedScale(
    scaleNotesMidi: readonly number[],
    targetBaseMidi: number,
  ): number {
    let pcMask = 0;
    for (let i = 0; i < scaleNotesMidi.length; i++) {
      const m = scaleNotesMidi[i]!;
      if (!Number.isFinite(m)) continue;
      const offset = (((Math.round(m) - targetBaseMidi) % 12) + 12) % 12;
      pcMask |= 1 << offset;
    }
    if (pcMask === 0) {
      pcMask = (1 << 0) | (1 << 2) | (1 << 3) | (1 << 5) | (1 << 7) | (1 << 8) | (1 << 10);
    }

    let count = 0;
    for (let oct = 0; oct < 3 && count < SCALE_BUF_CAP; oct++) {
      for (let semi = 0; semi < 12 && count < SCALE_BUF_CAP; semi++) {
        if ((pcMask & (1 << semi)) !== 0) {
          this.scaleBuf[count++] = targetBaseMidi + oct * 12 + semi;
        }
      }
    }
    if (count === 0) {
      this.scaleBuf[0] = targetBaseMidi;
      return 1;
    }
    return count;
  }

  private selectNotes(
    ctx: VoiceRenderContext,
    voiceMode: number,
    octaveShift: number,
    melodyPattern: number,
    counter: number,
  ): boolean {
    const params = this.melodyParams;
    const rootMidi = Number.isFinite(ctx.harmony.rootMidi) ? ctx.harmony.rootMidi : 36;
    let targetBaseMidi = rootMidi + (octaveShift + 1) * 12;
    while (targetBaseMidi < 28) targetBaseMidi += 12;
    while (targetBaseMidi > 96) targetBaseMidi -= 12;

    const scaleLen = this.fillFoldedScale(ctx.harmony.scaleNotesMidi, targetBaseMidi);
    const octDegs = Math.max(1, Math.floor(scaleLen / 3));
    const mel = computeMelodyStep(
      counter,
      readParam(MELODY_RATE_PARAM, params),
      readParam(MELODY_LENGTH_PARAM, params),
      melodyPattern,
      this.melInfo,
    );
    const step = mel.step;
    const seed = readParam(MELODY_SEED_PARAM, params);
    const chordCount = fillChordDegrees(
      this.scaleBuf,
      scaleLen,
      ctx.harmony.chordNotesMidi,
      this.chordDegBuf,
    );

    let leadDeg = 0;
    switch (melodyPattern) {
      case 0: // Grundton/Akkord
        leadDeg = 0;
        break;
      case 1: // Pendel 1–5
        leadDeg = (step & 1) === 0 ? 0 : Math.min(scaleLen - 1, 4);
        break;
      case 2: // Skala-Lauf
        leadDeg = step % octDegs;
        break;
      case 3: // Sprung-Rätsel
        leadDeg = (SPRUNG_DEGREES[step & 7] ?? 0) % octDegs;
        break;
      case 4: // Quinte/Terz-Duett (Lauf der Unterstimme)
        leadDeg = (DUET_DEGREES[step & 7] ?? 0) % Math.max(1, scaleLen);
        break;
      default:
        leadDeg = extendedMelodyDegree(
          melodyPattern,
          step,
          mel.phrase,
          readParam(MELODY_RANGE_PARAM, params),
          scaleLen,
          this.chordDegBuf,
          chordCount,
          seed,
        );
        break;
    }

    const octaveJump = shapeMelodyNote(
      leadDeg,
      step,
      seed,
      readParam(MELODY_CHORD_TONES_PARAM, params),
      readParam(MELODY_LEAP_PARAM, params),
      readParam(MELODY_REST_PARAM, params),
      this.chordDegBuf,
      chordCount,
      this.degOut,
    );
    // Haltebogen: vorige Töne liegen lassen.
    if (Number.isNaN(octaveJump) && this.hasInitializedNotes) return false;
    leadDeg = Math.max(0, Math.min(scaleLen - 1, this.degOut[0]!));
    const leadMidi =
      (this.scaleBuf[leadDeg] ?? targetBaseMidi) + (Number.isNaN(octaveJump) ? 0 : octaveJump);

    if (voiceMode === 0) {
      // Single upper voice
      this.voiceTargetMidi[0] = leadMidi;
      this.voiceActiveTarget[0] = 1;
      this.voiceActiveTarget[1] = 0;
      this.voiceActiveTarget[2] = 0;
      this.voiceActiveTarget[3] = 0;
    } else if (voiceMode === 1) {
      // 2 notes: root/lead + diatonic 5th (with occasional octave on every 4th step)
      const fifthDeg = Math.min(scaleLen - 1, leadDeg + 4);
      const upperMidi =
        (step & 3) === 3 ? leadMidi + 12 : (this.scaleBuf[fifthDeg] ?? leadMidi + 7);
      this.voiceTargetMidi[0] = leadMidi;
      this.voiceTargetMidi[1] = upperMidi;
      this.voiceActiveTarget[0] = 1;
      this.voiceActiveTarget[1] = 1;
      this.voiceActiveTarget[2] = 0;
      this.voiceActiveTarget[3] = 0;
    } else {
      // Up to 4 chordNotesMidi shifted by octaveShift
      const chordSrc = ctx.harmony.chordNotesMidi;
      const chordTranspose = leadMidi - targetBaseMidi;
      const octDelta = octaveShift * 12 + (melodyPattern === 0 ? 0 : chordTranspose);

      if (chordSrc.length > 0) {
        const count = Math.min(NUM_VOICES, chordSrc.length);
        for (let v = 0; v < NUM_VOICES; v++) {
          if (v < count) {
            this.voiceTargetMidi[v] = chordSrc[v]! + octDelta;
          } else {
            // Double chord root an octave higher for 3-note triads
            this.voiceTargetMidi[v] = chordSrc[0]! + octDelta + 12;
          }
          this.voiceActiveTarget[v] = 1;
        }
      } else {
        this.voiceTargetMidi[0] = leadMidi;
        this.voiceTargetMidi[1] = leadMidi + 3;
        this.voiceTargetMidi[2] = leadMidi + 7;
        this.voiceTargetMidi[3] = leadMidi + 12;
        this.voiceActiveTarget[0] = 1;
        this.voiceActiveTarget[1] = 1;
        this.voiceActiveTarget[2] = 1;
        this.voiceActiveTarget[3] = 1;
      }
    }

    const maxHz = this.sampleRate * 0.42;
    for (let v = 0; v < NUM_VOICES; v++) {
      const m = clamp(this.voiceTargetMidi[v]!, 24, 108);
      if (m !== this.voiceCachedMidi[v]) {
        this.voiceCachedMidi[v] = m;
        this.voiceHz[v] = clamp(midiToFreq(m), 28, maxHz);
      }
    }

    this.chiffCenterHz = clamp(this.voiceHz[0]! * 2.4, 850, Math.min(4000, this.sampleRate * 0.38));
    return true;
  }

  private updateDrawbars(register: number): void {
    let sumWeight = 0;
    if (register <= 0.5) {
      const t = register * 2;
      for (let d = 0; d < NUM_DRAWBARS; d++) {
        const g = REG_FLUTE[d]! + t * (REG_DRAWBAR[d]! - REG_FLUTE[d]!);
        this.drawbarGains[d] = g;
        sumWeight += g;
      }
    } else {
      const t = (register - 0.5) * 2;
      for (let d = 0; d < NUM_DRAWBARS; d++) {
        const g = REG_DRAWBAR[d]! + t * (REG_MIXTURE[d]! - REG_DRAWBAR[d]!);
        this.drawbarGains[d] = g;
        sumWeight += g;
      }
    }
    // Gentle loudness normalization across flute <-> mixture
    const norm = sumWeight > 1e-6 ? 1.0 / Math.sqrt(sumWeight * 1.15) : 1.0;
    for (let d = 0; d < NUM_DRAWBARS; d++) {
      this.drawbarGains[d] = this.drawbarGains[d]! * norm;
    }
  }

  public process(
    outL: Float32Array,
    outR: Float32Array,
    params: Record<string, number>,
    ctx: VoiceRenderContext,
  ): void {
    const count = Math.min(ctx.numSamples | 0, outL.length, outR.length);
    if (count <= 0) return;

    const targetRegister = readParam(REGISTER_PARAM, params);
    const targetChiff = readParam(CHIFF_PARAM, params);
    const targetTremolo = readParam(TREMOLO_PARAM, params);
    const release = readParam(RELEASE_PARAM, params);
    const droneHold = readParam(DRONE_HOLD_PARAM, params);
    const voiceMode = Math.round(readParam(VOICE_MODE_PARAM, params));
    const octaveShift = Math.round(readParam(OCTAVE_SHIFT_PARAM, params));
    const melodyPattern = Math.round(readParam(MELODY_PATTERN_PARAM, params));
    this.melodyParams = params;

    const sr = this.sampleRate;
    if (Math.abs(release - this.lastRelease) > 1e-5) {
      this.lastRelease = release;
      const trigTau = clamp(release * 0.28, 0.015, 0.45);
      this.trigDecayCoeff = Math.exp(-1 / (trigTau * sr));
    }

    const trig = Number.isFinite(ctx.timeFrame.triggerIntensity)
      ? clamp(ctx.timeFrame.triggerIntensity, 0, 1)
      : 0;
    const prevTrig = Number.isFinite(ctx.prevPulseTrigger) ? ctx.prevPulseTrigger : 0;
    const isNewTrigger = trig > 0.01 && prevTrig <= 0.01;
    const rootMidi = Number.isFinite(ctx.harmony.rootMidi) ? ctx.harmony.rootMidi : 36;

    if (isNewTrigger) {
      this.hasSeenTrigger = true;
      const wasInitialized = this.hasInitializedNotes;
      for (let v = 0; v < NUM_VOICES; v++) {
        this.prevVoiceMidi[v] = this.voiceCachedMidi[v]!;
        this.prevVoiceActive[v] = this.voiceActiveTarget[v]!;
      }

      const counter = this.noteCounter++;
      this.selectNotes(ctx, voiceMode, octaveShift, melodyPattern, counter);
      this.hasInitializedNotes = true;
      this.lastVoiceMode = voiceMode;
      this.lastOctaveShift = octaveShift;
      this.lastRootMidi = rootMidi;
      this.lastMelodyPattern = melodyPattern;

      let notesChanged = !wasInitialized;
      if (!notesChanged) {
        for (let v = 0; v < NUM_VOICES; v++) {
          if (
            this.voiceActiveTarget[v] !== this.prevVoiceActive[v] ||
            (this.voiceActiveTarget[v] === 1 &&
              this.voiceCachedMidi[v] !== this.prevVoiceMidi[v])
          ) {
            notesChanged = true;
            break;
          }
        }
      }

      const accent = Number.isFinite(ctx.timeFrame.accent)
        ? clamp(ctx.timeFrame.accent, 0, 1)
        : 0.5;
      const vel = clamp((0.46 + 0.54 * trig) * (0.85 + 0.15 * accent), 0.25, 1);

      this.trigEnv = Math.max(this.trigEnv, vel);
      if (!(wasInitialized && droneHold > 0.5 && !notesChanged)) {
        this.chiffEnv = Math.max(this.chiffEnv * 0.2, vel);
        this.chiffAttack = 0;
      }

      // Reset phase only for completely silent voices
      for (let v = 0; v < NUM_VOICES; v++) {
        if (this.voiceActiveTarget[v] === 1 && this.voiceEnv[v]! < 0.004) {
          this.voicePhase[v] = (v * 0.19) % 1;
        }
      }
    } else if (
      !this.hasInitializedNotes ||
      voiceMode !== this.lastVoiceMode ||
      octaveShift !== this.lastOctaveShift ||
      rootMidi !== this.lastRootMidi ||
      melodyPattern !== this.lastMelodyPattern
    ) {
      this.selectNotes(
        ctx,
        voiceMode,
        octaveShift,
        melodyPattern,
        Math.max(0, this.noteCounter - 1),
      );
      this.hasInitializedNotes = true;
      this.lastVoiceMode = voiceMode;
      this.lastOctaveShift = octaveShift;
      this.lastRootMidi = rootMidi;
      this.lastMelodyPattern = melodyPattern;
    }

    const pulseEnergy = Number.isFinite(ctx.timeFrame.pulseEnergy)
      ? clamp(ctx.timeFrame.pulseEnergy, 0, 1)
      : 0;
    const shapedPulse = pulseEnergy * (0.35 + 0.65 * pulseEnergy);
    const sustainBlend = clamp((release - 0.06) / 0.6, 0, 1);

    const invSr = 1 / sr;
    const nyqStart = sr * 0.36;
    const nyqEnd = sr * 0.45;
    const nyqSpanInv = 1 / Math.max(1, nyqEnd - nyqStart);

    const attackCoeff = this.attackCoeff;
    const gateReleaseCoeff = this.gateReleaseCoeff;
    const trigDecayCoeff = this.trigDecayCoeff;
    const chiffAttackStep = this.chiffAttackStep;
    const chiffDecayCoeff = this.chiffDecayCoeff;
    const lfoInc = this.lfoInc;

    for (let start = 0; start < count; start += 8) {
      const end = Math.min(start + 8, count);
      const subLen = end - start;

      let register = targetRegister;
      if (this.registerSmoother.current !== register) {
        for (let k = 0; k < subLen; k++) {
          register = this.registerSmoother.process(targetRegister);
        }
        if (Math.abs(register - targetRegister) < 1e-6) {
          register = targetRegister;
          this.registerSmoother.reset(targetRegister);
        }
      }

      let chiff = targetChiff;
      if (this.chiffSmoother.current !== chiff) {
        for (let k = 0; k < subLen; k++) {
          chiff = this.chiffSmoother.process(targetChiff);
        }
        if (Math.abs(chiff - targetChiff) < 1e-6) {
          chiff = targetChiff;
          this.chiffSmoother.reset(targetChiff);
        }
      }

      let tremolo = targetTremolo;
      if (this.tremoloSmoother.current !== tremolo) {
        for (let k = 0; k < subLen; k++) {
          tremolo = this.tremoloSmoother.process(targetTremolo);
        }
        if (Math.abs(tremolo - targetTremolo) < 1e-6) {
          tremolo = targetTremolo;
          this.tremoloSmoother.reset(targetTremolo);
        }
      }

      this.updateDrawbars(register);
      const w0 = this.drawbarGains[0]!;
      const w1 = this.drawbarGains[1]!;
      const w2 = this.drawbarGains[2]!;
      const w3 = this.drawbarGains[3]!;
      const w4 = this.drawbarGains[4]!;
      const w5 = this.drawbarGains[5]!;

      // Update C/C# pipe chest stereo panning per voice
      const chestSpread = 0.1 + 0.44 * tremolo;
      for (let v = 0; v < NUM_VOICES; v++) {
        const midiInt = Math.round(this.voiceCachedMidi[v]!);
        const chestSign = (midiInt & 1) === 0 ? -1 : 1;
        const pan = chestSign * chestSpread;
        const angle = (pan + 1) * 0.25 * Math.PI;
        this.voicePanCos[v] = Math.cos(angle);
        this.voicePanSin[v] = Math.sin(angle);
      }

      // Chiff bandpass noise
      this.chiffFilterL.setParams(this.chiffCenterHz, 2.2, 1);
      this.chiffFilterR.setParams(
        Math.min(this.chiffCenterHz * 1.1, sr * 0.41),
        2.2,
        1,
      );
      for (let k = 0; k < subLen; k++) {
        const n = this.chiffNoise.processSample();
        this.chiffBufL[k] = n;
        this.chiffBufR[k] = -n;
      }
      this.chiffFilterL.processBlock(this.chiffBufL, 0, subLen);
      this.chiffFilterR.processBlock(this.chiffBufR, 0, subLen);

      const voiceScale = voiceMode === 2 ? 0.32 : voiceMode === 1 ? 0.44 : 0.56;
      const chiffGain = chiff * 0.48;

      for (let k = 0; k < subLen; k++) {
        const i = start + k;

        // 5.2 Hz organ tremulant LFO
        const lfoSin = Math.sin(TWO_PI * this.lfoPhase);
        this.lfoPhase += lfoInc;
        if (this.lfoPhase >= 1) this.lfoPhase -= Math.floor(this.lfoPhase);

        const ampTrem = 1 - tremolo * 0.18 * (0.5 + 0.5 * lfoSin);
        const pitchVib = 1 + tremolo * 0.0045 * lfoSin;

        const noteEnv = this.hasSeenTrigger
          ? this.trigEnv + (1 - this.trigEnv) * sustainBlend
          : 1;
        const rhythmicGate = shapedPulse * noteEnv;
        const driveGate = rhythmicGate + droneHold * (1 - rhythmicGate);
        this.trigEnv *= trigDecayCoeff;
        if (this.trigEnv < 1e-6) this.trigEnv = 0;

        let sumL = 0;
        let sumR = 0;

        for (let v = 0; v < NUM_VOICES; v++) {
          const targetGate = this.voiceActiveTarget[v] === 1 ? driveGate : 0;
          let env = this.voiceEnv[v]!;
          if (targetGate > env) {
            env = targetGate + attackCoeff * (env - targetGate);
          } else {
            env = targetGate + gateReleaseCoeff * (env - targetGate);
          }
          if (env < 1e-6 && targetGate < 1e-6) {
            this.voiceEnv[v] = 0;
            continue;
          }
          this.voiceEnv[v] = env;

          const hz = this.voiceHz[v]! * pitchVib;
          let p = this.voicePhase[v]!;
          const theta = TWO_PI * p;
          const s1 = Math.sin(theta);
          const c1 = Math.cos(theta);

          // Exact harmonic recurrence from fundamental 0.5x phase:
          // s1 = 0.5x, s2 = 1x, s4 = 2x, s6 = 3x, s8 = 4x, s10 = 5x
          const s2 = 2 * s1 * c1;
          const c2 = c1 * c1 - s1 * s1;
          const s4 = 2 * s2 * c2;
          const c4 = c2 * c2 - s2 * s2;
          const s6 = s4 * c2 + c4 * s2;
          const s8 = 2 * s4 * c4;
          const c8 = c4 * c4 - s4 * s4;
          const s10 = s8 * c2 + c8 * s2;

          let pipeSig = 0;
          const f0 = hz * DRAWBAR_MULTS[0]!;
          const f1 = hz * DRAWBAR_MULTS[1]!;
          const f2 = hz * DRAWBAR_MULTS[2]!;
          const f3 = hz * DRAWBAR_MULTS[3]!;
          const f4 = hz * DRAWBAR_MULTS[4]!;
          const f5 = hz * DRAWBAR_MULTS[5]!;

          if (f0 < nyqEnd) {
            const g = f0 <= nyqStart ? 1 : 1 - (f0 - nyqStart) * nyqSpanInv;
            pipeSig += s1 * w0 * g;
          }
          if (f1 < nyqEnd) {
            const g = f1 <= nyqStart ? 1 : 1 - (f1 - nyqStart) * nyqSpanInv;
            pipeSig += s2 * w1 * g;
          }
          if (f2 < nyqEnd) {
            const g = f2 <= nyqStart ? 1 : 1 - (f2 - nyqStart) * nyqSpanInv;
            pipeSig += s4 * w2 * g;
          }
          if (f3 < nyqEnd) {
            const g = f3 <= nyqStart ? 1 : 1 - (f3 - nyqStart) * nyqSpanInv;
            pipeSig += s6 * w3 * g;
          }
          if (f4 < nyqEnd) {
            const g = f4 <= nyqStart ? 1 : 1 - (f4 - nyqStart) * nyqSpanInv;
            pipeSig += s8 * w4 * g;
          }
          if (f5 < nyqEnd) {
            const g = f5 <= nyqStart ? 1 : 1 - (f5 - nyqStart) * nyqSpanInv;
            pipeSig += s10 * w5 * g;
          }

          p += 0.5 * hz * invSr;
          if (p >= 1) p -= Math.floor(p);
          this.voicePhase[v] = p;

          const vOut = pipeSig * env * ampTrem * voiceScale;
          sumL += vOut * this.voicePanCos[v]!;
          sumR += vOut * this.voicePanSin[v]!;
        }

        if (this.chiffEnv > 1e-6) {
          if (this.chiffAttack < 1) {
            this.chiffAttack = Math.min(1, this.chiffAttack + chiffAttackStep);
          }
          const cEnv = this.chiffEnv * this.chiffAttack * chiffGain;
          sumL += this.chiffBufL[k]! * cEnv;
          sumR += this.chiffBufR[k]! * cEnv;
          this.chiffEnv *= chiffDecayCoeff;
          if (this.chiffEnv < 1e-6) this.chiffEnv = 0;
        }

        const satL = fastTanh(sumL * 0.9);
        const satR = fastTanh(sumR * 0.9);
        this.dcBlocker.process(satL, satR);

        const yL = this.dcBlocker.outL;
        const yR = this.dcBlocker.outR;
        outL[i] = yL * 0 === 0 ? clamp(yL, -1.2, 1.2) : 0;
        outR[i] = yR * 0 === 0 ? clamp(yR, -1.2, 1.2) : 0;
      }
    }
  }
}

export const pipeOrganVoiceModule: VoiceModule = {
  id: 'pipe-organ',
  version: 1,
  category: 'harmony',
  displayName: 'Orgelpipes & Zugriegel',
  description:
    'Pfeifenorgel- und Zugriegel-Register mit Anblas-Chiff, für Solo-Oberstimmen oder Orgelakkorde.',
  parameters: [
    REGISTER_PARAM,
    CHIFF_PARAM,
    TREMOLO_PARAM,
    RELEASE_PARAM,
    DRONE_HOLD_PARAM,
    VOICE_MODE_PARAM,
    OCTAVE_SHIFT_PARAM,
    MELODY_PATTERN_PARAM,
    MELODY_RANGE_PARAM,
    ...MELODY_EXTRA_PARAMS,
  ],
  createInstance(sampleRate: number): VoiceInstance {
    return new PipeOrganVoice(sampleRate);
  },
};
