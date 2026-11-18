import { clamp, DCBlocker, sanitizeSampleRate, ZdfSvfFilter } from '../../dsp';
import type {
  ParameterSchema,
  VoiceInstance,
  VoiceModule,
  VoiceRenderContext,
} from '../../registry/types';
import { midiToFreq } from '../../theory';
import { MELODY_EXTRA_PARAMS } from '../../theory/melody';
import { BASS_RANGE_PARAM, BassNotePicker, createBassOctaveParam, createBassPatternParam } from './bassNotes';
import {
  clamp01,
  decayCoeff,
  detectNewTrigger,
  DIST_MODE_OPTIONS,
  distort,
  NoteHold,
  readParam,
  SUSTAIN_PARAM,
} from './voiceUtils';

/**
 * Industrie-Bass (FM & Verzerrung): ein Sinus wird von einem zweiten Sinus in der
 * Frequenz moduliert (FM). Am Tonanfang ist die Modulation stark („Biss“, metallisch),
 * danach klingt sie ab. Rückkopplung macht ihn knurrig, die Verzerrung brutal; ein
 * eigener sauberer Sub darunter hält den Druck. Ideal für Offbeat-Bässe in Hard- &
 * Industrial-Techno.
 */

const RATIO_VALUES = [0.5, 1, 1.5, 2, 3, 4, 7];

const RATIO_PARAM: ParameterSchema = {
  id: 'fmRatio',
  label: 'Metall-Farbe (Verhältnis)',
  description: 'Verhältnis von Modulator zu Ton: 1 = rund & knurrig, 2 = hohl, 1,5/3/7 = metallisch & glockig-kalt.',
  domain: 'timbre',
  min: 0,
  max: 6,
  step: 1,
  defaultValue: 1,
  curve: 'linear',
  modulatable: false,
  options: RATIO_VALUES.map((v, i) => ({ value: i, label: `${v}×`.replace('.', ',') })),
};

const INDEX_PARAM: ParameterSchema = {
  id: 'fmAmount',
  label: 'Grund-Biss (FM-Stärke)',
  description: 'Wie viele Obertöne der Bass dauerhaft hat – 0 = reiner Sinus, 1 = sehr rau.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.3,
  curve: 'linear',
  modulatable: true,
};

const BITE_PARAM: ParameterSchema = {
  id: 'bite',
  label: 'Anschlag-Biss',
  description: 'Zusätzlicher Biss am Tonanfang („Donk“/„Bonk“), der schnell abklingt.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.6,
  curve: 'linear',
  modulatable: true,
};

const BITE_DECAY_PARAM: ParameterSchema = {
  id: 'biteDecay',
  label: 'Biss-Abklingzeit',
  description: 'Kurz = perkussiver Schlag, lang = der Biss zieht sich durch den Ton.',
  domain: 'timbre',
  min: 0.01,
  max: 0.6,
  defaultValue: 0.08,
  curve: 'exp',
  modulatable: true,
  unitLabel: 's',
};

const FEEDBACK_PARAM: ParameterSchema = {
  id: 'feedback',
  label: 'Knurren (Rückkopplung)',
  description: 'Der Modulator moduliert sich selbst – macht den Ton sägend, knurrig bis rauschig.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.2,
  curve: 'linear',
  modulatable: true,
};

const DRIVE_PARAM: ParameterSchema = {
  id: 'drive',
  label: 'Verzerrung',
  description: 'Wie stark der obere Bassteil verzerrt wird (der Sub bleibt sauber).',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.55,
  curve: 'linear',
  modulatable: true,
};

const DIST_MODE_PARAM: ParameterSchema = {
  id: 'distMode',
  label: 'Verzerrungs-Art',
  description: 'Weich, hart geclippt, gebrochen (Wavefold), Röhre oder digital (Bitcrusher).',
  domain: 'timbre',
  min: 0,
  max: 4,
  step: 1,
  defaultValue: 1,
  curve: 'linear',
  modulatable: false,
  options: DIST_MODE_OPTIONS,
};

const CRUSH_PARAM: ParameterSchema = {
  id: 'crush',
  label: 'Digital-Raster',
  description: 'Nur bei „Digital“: grobe Abtastung für kaputten, digitalen Industrial-Sound.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.3,
  curve: 'linear',
  modulatable: true,
};

const TONE_PARAM: ParameterSchema = {
  id: 'tone',
  label: 'Helligkeit',
  description: 'Dumpf bis kreischend hell (Tiefpass nach der Verzerrung).',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.5,
  curve: 'linear',
  modulatable: true,
};

const SUB_PARAM: ParameterSchema = {
  id: 'sub',
  label: 'Sub-Fundament',
  description: 'Sauberer Sinus auf dem Grundton – Druck ohne Matsch.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.5,
  curve: 'linear',
  modulatable: true,
};

const LENGTH_PARAM: ParameterSchema = {
  id: 'noteLength',
  label: 'Ton-Länge',
  description: 'Kurz & stakkato (typischer Offbeat-Bass) bis lang liegend.',
  domain: 'timbre',
  min: 0.03,
  max: 1,
  defaultValue: 0.25,
  curve: 'linear',
  modulatable: true,
};

const PITCH_DROP_PARAM: ParameterSchema = {
  id: 'pitchDrop',
  label: 'Tonhöhen-Fall',
  description: 'Jeder Ton fällt am Anfang kurz von oben ein – macht ihn perkussiv wie eine Tom.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.15,
  curve: 'linear',
  modulatable: true,
};

const PATTERN_PARAM = createBassPatternParam(0);
const OCTAVE_PARAM = createBassOctaveParam(0);

export class FmBassVoice implements VoiceInstance {
  private readonly hold = new NoteHold();
  private holdVel = 1;
  private readonly sampleRate: number;
  private readonly lp: ZdfSvfFilter;
  private readonly dc: DCBlocker;
  private readonly picker = new BassNotePicker();
  private carPhase = 0;
  private modPhase = 0;
  private subPhase = 0;
  private lastMod = 0;
  private hz = 55;
  private amp = 0;
  private biteEnv = 0;
  private pitchEnv = 0;
  private holdCounter = 0;
  private held = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.lp = new ZdfSvfFilter(this.sampleRate, 3000, 0.8, 0);
    this.dc = new DCBlocker(this.sampleRate, 20);
  }

  public reset(): void {
    this.hold.reset();
    this.lp.reset();
    this.dc.reset();
    this.picker.reset();
    this.carPhase = 0;
    this.modPhase = 0;
    this.subPhase = 0;
    this.lastMod = 0;
    this.amp = 0;
    this.biteEnv = 0;
    this.pitchEnv = 0;
    this.holdCounter = 0;
    this.held = 0;
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

    const ratio = RATIO_VALUES[Math.round(readParam(RATIO_PARAM, params))] ?? 1;
    const fmAmount = readParam(INDEX_PARAM, params);
    const bite = readParam(BITE_PARAM, params);
    const biteDecay = readParam(BITE_DECAY_PARAM, params);
    const feedback = readParam(FEEDBACK_PARAM, params);
    const drive = readParam(DRIVE_PARAM, params);
    const mode = Math.round(readParam(DIST_MODE_PARAM, params));
    const crush = readParam(CRUSH_PARAM, params);
    const tone = readParam(TONE_PARAM, params);
    const sub = readParam(SUB_PARAM, params);
    const noteLength = readParam(LENGTH_PARAM, params);
    const pitchDrop = readParam(PITCH_DROP_PARAM, params);
    const sustain = readParam(SUSTAIN_PARAM, params);

    const trig = detectNewTrigger(ctx);
    if (trig > 0) {
      const midi = this.picker.next(ctx, params, PATTERN_PARAM, OCTAVE_PARAM);
      if (!Number.isNaN(midi)) {
        this.hz = clamp(midiToFreq(midi), 20, sr * 0.3);
        const accent = Number.isFinite(ctx.timeFrame.accent) ? clamp01(ctx.timeFrame.accent) : 0.7;
        this.amp = 0.72 + 0.28 * accent;
        this.holdVel = this.amp;
        this.biteEnv = 1;
        this.pitchEnv = 1;
        // gleiche Startphase → jeder Ton schlägt gleich hart an
        this.carPhase = 0;
        this.modPhase = 0;
        this.subPhase = 0;
      }
    }

    const holdFloor = this.hold.floor(ctx, trig, sustain, this.holdVel);
    const ampCoeff = noteLength >= 0.995 ? 1 : decayCoeff(0.025 + noteLength * noteLength * 1.6, sr);
    const biteCoeff = decayCoeff(biteDecay * 0.5, sr);
    const pitchCoeff = decayCoeff(0.012, sr);
    const baseIndex = fmAmount * 3.2;
    const biteIndex = bite * 7;
    const fb = feedback * 1.6;
    const driveGain = 1 + drive * drive * 14;
    const driveNorm = 0.8 / (1 + drive * 0.8);
    this.lp.setParams(clamp(300 * Math.pow(40, tone), 200, sr * 0.42), 0.8, 0);
    const holdLen = mode === 4 ? Math.max(1, Math.round(1 + crush * crush * 24)) : 1;
    const invSr = 1 / sr;
    const TWO_PI = 6.283185307;
    const hz = this.hz;

    for (let i = 0; i < count; i++) {
      const f = hz * (1 + pitchDrop * 2 * this.pitchEnv);
      this.modPhase += f * ratio * invSr;
      if (this.modPhase >= 1) this.modPhase -= 1;
      const mod = Math.sin(TWO_PI * this.modPhase + fb * this.lastMod);
      this.lastMod = mod;
      const index = baseIndex + biteIndex * this.biteEnv;
      this.carPhase += f * invSr;
      if (this.carPhase >= 1) this.carPhase -= 1;
      const car = Math.sin(TWO_PI * this.carPhase + index * mod);

      let top = distort(car * driveGain, mode) * driveNorm;
      if (holdLen > 1) {
        // Sample-Halten für den Bitcrusher-Charakter
        if (this.holdCounter <= 0) {
          this.held = top;
          this.holdCounter = holdLen;
        }
        this.holdCounter--;
        top = this.held;
      }
      top = this.lp.processSample(top);

      this.subPhase += f * invSr;
      if (this.subPhase >= 1) this.subPhase -= 1;
      const s = Math.sin(TWO_PI * this.subPhase) * sub * 0.6;

      const y = this.dc.processSample((top * (1 - 0.35 * sub) + s) * this.amp);
      const v = y * 0 === 0 ? y : 0;
      outL[i] = v;
      outR[i] = v;
      this.amp *= ampCoeff;
      if (this.amp < holdFloor) this.amp = holdFloor;
      this.biteEnv *= biteCoeff;
      this.pitchEnv *= pitchCoeff;
    }
    if (this.amp < 1e-6) this.amp = 0;
  }
}

export const fmBassVoiceModule: VoiceModule = {
  id: 'fm-bass',
  version: 1,
  category: 'bass',
  displayName: 'Industrie-Bass (FM & Verzerrung)',
  description:
    'Harter, metallischer Bass mit FM-Biss, Knurren und 5 Verzerrungs-Arten (inkl. Bitcrusher) über sauberem Sub – der typische Offbeat-Bass im Hard- & Industrial-Techno.',
  parameters: [
    RATIO_PARAM,
    INDEX_PARAM,
    BITE_PARAM,
    BITE_DECAY_PARAM,
    FEEDBACK_PARAM,
    DRIVE_PARAM,
    DIST_MODE_PARAM,
    CRUSH_PARAM,
    TONE_PARAM,
    SUB_PARAM,
    LENGTH_PARAM,
    PITCH_DROP_PARAM,
    OCTAVE_PARAM,
    PATTERN_PARAM,
    BASS_RANGE_PARAM,
    ...MELODY_EXTRA_PARAMS,
  ],
  createInstance(sampleRate: number): VoiceInstance {
    return new FmBassVoice(sampleRate);
  },
};
