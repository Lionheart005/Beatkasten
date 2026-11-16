import { DCBlocker, sanitizeSampleRate, WhiteNoiseGenerator, ZdfSvfFilter } from '../../dsp';
import type {
  ParameterSchema,
  VoiceInstance,
  VoiceModule,
  VoiceRenderContext,
} from '../../registry/types';
import { midiToFreq } from '../../theory';
import {
  BeatTracker,
  clamp01,
  decayCoeff,
  detectNewTrigger,
  DIST_MODE_OPTIONS,
  distort,
  fastTanh,
  readParam,
} from './voiceUtils';

/**
 * Hardtechno-Kick & Rumble.
 *
 * Kick: Sinus mit sehr schnellem, tiefem Tonhöhen-Fall („Tok“ → Druck), danach eine
 * kräftige Verzerrungsstufe (5 Arten) und ein Klang-Tiefpass gegen Kratzen.
 * Rumble: das grollende Nachdröhnen zwischen den Kicks (wie Kick → Hall → Verzerrer →
 * Tiefpass → Sidechain). Es wird hier direkt erzeugt: ein tiefer, von Rauschen
 * „zerknitterter“ Ton auf der Kick-Tonhöhe, der nach dem Kick anschwillt und vor dem
 * nächsten wieder verschwindet – tempo-synchron.
 */

const PUNCH_PARAM: ParameterSchema = {
  id: 'punch',
  label: 'Punch (Tonhöhen-Fall)',
  description: 'Wie hoch der Kick startet, bevor er in den Tiefbass fällt – mehr = härterer „Tok“-Anschlag.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.75,
  curve: 'linear',
  modulatable: true,
};

const SWEEP_PARAM: ParameterSchema = {
  id: 'sweepTime',
  label: 'Fall-Geschwindigkeit',
  description: 'Schnell = knackig & trocken, langsam = „Pew“/Zoom-Charakter (Hardstyle-artig).',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.3,
  curve: 'linear',
  modulatable: true,
};

const DECAY_PARAM: ParameterSchema = {
  id: 'decay',
  label: 'Kick-Länge',
  description: 'Kurzer Punch bis langer, dröhnender Tiefbass-Schwanz.',
  domain: 'timbre',
  min: 0.05,
  max: 1.2,
  defaultValue: 0.35,
  curve: 'exp',
  modulatable: true,
  unitLabel: 's',
};

const DRIVE_PARAM: ParameterSchema = {
  id: 'distortion',
  label: 'Verzerrung',
  description: 'Wie brutal der Kick verzerrt wird – 0 = sauber, 1 = Industrial/Hardtechno.',
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
  description: 'Charakter der Verzerrung: weich-warm, hart-geclippt, gebrochen (viele Obertöne), Röhre oder digital.',
  domain: 'timbre',
  min: 0,
  max: 4,
  step: 1,
  defaultValue: 1,
  curve: 'linear',
  modulatable: false,
  options: DIST_MODE_OPTIONS,
};

const TONE_PARAM: ParameterSchema = {
  id: 'tone',
  label: 'Klang (Helligkeit)',
  description: 'Dunkel & dumpf bis offen & kratzig – zähmt die Verzerrung.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.45,
  curve: 'linear',
  modulatable: true,
};

const CLICK_PARAM: ParameterSchema = {
  id: 'click',
  label: 'Anschlag-Klick',
  description: 'Zusätzlicher kurzer Klick ganz vorn – damit der Kick auch auf kleinen Boxen durchkommt.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.35,
  curve: 'linear',
  modulatable: true,
};

const TUNE_PARAM: ParameterSchema = {
  id: 'tune',
  label: 'Stimmung',
  description: 'Tonhöhe des Kicks in Halbtönen relativ zum Grundton.',
  domain: 'timbre',
  min: -12,
  max: 12,
  step: 1,
  defaultValue: 0,
  curve: 'linear',
  modulatable: true,
  unitLabel: 'st',
};

const PITCH_FOLLOW_PARAM: ParameterSchema = {
  id: 'pitchFollow',
  label: 'Tonhöhe folgt',
  description: 'Tonart = Kick bleibt immer auf dem Grundton der Tonart (typisch). Akkord = Kick wandert mit den Akkorden.',
  domain: 'harmony',
  min: 0,
  max: 1,
  step: 1,
  defaultValue: 0,
  curve: 'linear',
  modulatable: false,
  options: [
    { value: 0, label: 'Tonart-Grundton (fest)' },
    { value: 1, label: 'Akkord-Grundton (wandert)' },
  ],
};

const RUMBLE_PARAM: ParameterSchema = {
  id: 'rumble',
  label: 'Rumble (Grollen)',
  description: 'Menge des grollenden Nachdröhnens zwischen den Kicks – das Fundament von Hardtechno.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.5,
  curve: 'linear',
  modulatable: true,
};

const RUMBLE_LENGTH_PARAM: ParameterSchema = {
  id: 'rumbleLength',
  label: 'Rumble-Länge',
  description: 'Wie lange das Grollen nach dem Kick anhält (bezogen auf den Beat – passt sich dem Tempo an).',
  domain: 'timbre',
  min: 0.1,
  max: 1,
  defaultValue: 0.6,
  curve: 'linear',
  modulatable: true,
};

const RUMBLE_GRIT_PARAM: ParameterSchema = {
  id: 'rumbleGrit',
  label: 'Rumble-Dreck',
  description: 'Glattes Dröhnen bis zerknittertes, verzerrtes Grollen.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.5,
  curve: 'linear',
  modulatable: true,
};

const RUMBLE_DARK_PARAM: ParameterSchema = {
  id: 'rumbleDark',
  label: 'Rumble-Dunkelheit',
  description: 'Je höher, desto tiefer & dumpfer das Grollen (unterhalb der Mitten).',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.6,
  curve: 'linear',
  modulatable: true,
};

export class HardKickVoice implements VoiceInstance {
  private readonly sampleRate: number;
  private readonly beat: BeatTracker;
  private readonly noise = new WhiteNoiseGenerator(0x1b873593);
  private readonly toneLp: ZdfSvfFilter;
  private readonly clickBp: ZdfSvfFilter;
  private readonly rumbleNoiseLp: ZdfSvfFilter;
  private readonly rumbleLp: ZdfSvfFilter;
  private readonly dc: DCBlocker;
  private phase = 0;
  private rumblePhase = 0;
  private pitchEnv = 0;
  private ampEnv = 0;
  private clickEnv = 0;
  private sinceTrig = 1e9;
  private vel = 1;
  private hasHit = false;

  constructor(sampleRate: number) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.beat = new BeatTracker(this.sampleRate);
    this.toneLp = new ZdfSvfFilter(this.sampleRate, 6000, 0.7, 0);
    this.clickBp = new ZdfSvfFilter(this.sampleRate, 3200, 1.2, 1);
    this.rumbleNoiseLp = new ZdfSvfFilter(this.sampleRate, 60, 0.7, 0);
    this.rumbleLp = new ZdfSvfFilter(this.sampleRate, 300, 1.1, 0);
    this.dc = new DCBlocker(this.sampleRate, 18);
  }

  public reset(): void {
    this.beat.reset();
    this.noise.reset();
    this.toneLp.reset();
    this.clickBp.reset();
    this.rumbleNoiseLp.reset();
    this.rumbleLp.reset();
    this.dc.reset();
    this.phase = 0;
    this.rumblePhase = 0;
    this.pitchEnv = 0;
    this.ampEnv = 0;
    this.clickEnv = 0;
    this.sinceTrig = 1e9;
    this.hasHit = false;
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
    const bps = this.beat.update(ctx);

    const punch = readParam(PUNCH_PARAM, params);
    const sweep = readParam(SWEEP_PARAM, params);
    const decay = readParam(DECAY_PARAM, params);
    const drive = readParam(DRIVE_PARAM, params);
    const mode = Math.round(readParam(DIST_MODE_PARAM, params));
    const tone = readParam(TONE_PARAM, params);
    const click = readParam(CLICK_PARAM, params);
    const tune = readParam(TUNE_PARAM, params);
    const follow = Math.round(readParam(PITCH_FOLLOW_PARAM, params));
    const rumble = readParam(RUMBLE_PARAM, params);
    const rumbleLength = readParam(RUMBLE_LENGTH_PARAM, params);
    const grit = readParam(RUMBLE_GRIT_PARAM, params);
    const dark = readParam(RUMBLE_DARK_PARAM, params);

    // Tonhöhe: Grundton der Tonart (fest) oder des Akkords, gefaltet in 30..41 (~46–87 Hz)
    const chordRoot = Number.isFinite(ctx.harmony.rootMidi) ? ctx.harmony.rootMidi : 36;
    const keyRoot = ctx.harmony.keyRootMidi;
    let midi = follow === 1 || keyRoot === undefined || !Number.isFinite(keyRoot) ? chordRoot : keyRoot;
    while (midi > 41) midi -= 12;
    while (midi < 30) midi += 12;
    const baseHz = midiToFreq(midi + tune);

    const trig = detectNewTrigger(ctx);
    if (trig > 0) {
      const accent = Number.isFinite(ctx.timeFrame.accent) ? clamp01(ctx.timeFrame.accent) : 1;
      this.vel = 0.7 + 0.3 * Math.max(trig, accent);
      this.phase = 0; // harte Kicks brauchen jedes Mal dieselbe Startphase
      this.pitchEnv = 1;
      this.ampEnv = this.vel;
      this.clickEnv = this.vel;
      this.sinceTrig = 0;
      this.hasHit = true;
    }

    const pitchCoeff = decayCoeff(0.006 + sweep * sweep * 0.09, sr);
    const ampCoeff = decayCoeff(decay * 0.42, sr);
    const clickCoeff = decayCoeff(0.0018, sr);
    const startMul = 1 + punch * 11; // bis ~ 12-facher Startton
    const driveGain = 1 + drive * drive * 18;
    const driveNorm = 1 / (1 + drive * 0.35);
    this.toneLp.setParams(1200 * Math.pow(12, tone), 0.7, 0);
    this.clickBp.setParams(2200 + click * 2600, 1.2, 1);
    this.rumbleNoiseLp.setParams(25 + grit * 90, 0.7, 0);
    const rumbleCut = Math.max(90, baseHz * (6 - 4.5 * dark));
    this.rumbleLp.setParams(rumbleCut, 1.1 + grit * 1.2, 0);

    // Rumble-Hüllkurve in Beats: Anschwellen ab 1/16, Maximum ~1/4 Beat, Ausklingen bis rumbleLength
    const beatsNow = bps;
    const riseStart = 0.06;
    const peakAt = 0.22 + 0.15 * rumbleLength;
    const endAt = Math.min(0.98, peakAt + 0.12 + rumbleLength * 0.7);
    const rumbleGain = rumble * 1.4;
    const invSr = 1 / sr;
    const grDrive = 1 + grit * 7;

    for (let i = 0; i < count; i++) {
      // --- Kick-Körper ---
      const f = baseHz * (1 + (startMul - 1) * this.pitchEnv);
      this.phase += f * invSr;
      if (this.phase >= 1) this.phase -= 1;
      const body = Math.sin(this.phase * 6.283185307) * this.ampEnv;
      const n = this.noise.processSample();
      const clk = this.clickBp.processSample(n) * this.clickEnv * click * 1.8;
      let kick = distort((body + clk * 0.6) * driveGain, mode) * driveNorm;
      kick = this.toneLp.processSample(kick);

      // --- Rumble ---
      let rum = 0;
      if (this.hasHit && rumble > 0.001) {
        const tb = this.sinceTrig * beatsNow; // Zeit seit dem Kick in Beats
        let env = 0;
        if (tb > riseStart && tb < endAt) {
          if (tb < peakAt) {
            const x = (tb - riseStart) / (peakAt - riseStart);
            env = x * x * (3 - 2 * x);
          } else {
            const x = (tb - peakAt) / (endAt - peakAt);
            env = (1 - x) * (1 - x);
          }
        }
        this.rumblePhase += baseHz * invSr;
        if (this.rumblePhase >= 1) this.rumblePhase -= 1;
        const nLow = this.rumbleNoiseLp.processSample(n) * 9;
        const tonal =
          Math.sin(this.rumblePhase * 6.283185307) + 0.45 * Math.sin(this.rumblePhase * 12.566370614);
        // Rauschen „zerknittert“ den Ton (Amplituden- und leichte Phasen-Unruhe)
        const raw = tonal * (0.65 + 0.35 * nLow) + nLow * 0.4 * grit;
        rum = this.rumbleLp.processSample(fastTanh(raw * grDrive)) * env * rumbleGain * this.vel;
      } else {
        this.rumbleNoiseLp.processSample(n);
      }

      const y = this.dc.processSample(fastTanh((kick + rum) * 0.95) * 0.85);
      const v = y * 0 === 0 ? y : 0;
      outL[i] = v;
      outR[i] = v;

      this.pitchEnv *= pitchCoeff;
      this.ampEnv *= ampCoeff;
      this.clickEnv *= clickCoeff;
      this.sinceTrig++;
    }
    if (this.ampEnv < 1e-7) this.ampEnv = 0;
    if (this.sinceTrig > 1e9) this.sinceTrig = 1e9;
  }
}

export const hardKickVoiceModule: VoiceModule = {
  id: 'hard-kick',
  version: 1,
  category: 'rhythm',
  displayName: 'Hardtechno-Kick & Rumble',
  description:
    'Verzerrte, druckvolle Kick mit tempo-synchronem Rumble (Grollen) – das Fundament von Hard- & Industrial-Techno.',
  parameters: [
    PUNCH_PARAM,
    SWEEP_PARAM,
    DECAY_PARAM,
    DRIVE_PARAM,
    DIST_MODE_PARAM,
    TONE_PARAM,
    CLICK_PARAM,
    TUNE_PARAM,
    PITCH_FOLLOW_PARAM,
    RUMBLE_PARAM,
    RUMBLE_LENGTH_PARAM,
    RUMBLE_GRIT_PARAM,
    RUMBLE_DARK_PARAM,
  ],
  createInstance(sampleRate: number): VoiceInstance {
    return new HardKickVoice(sampleRate);
  },
};
