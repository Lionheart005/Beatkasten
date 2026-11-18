import { clamp, sanitizeSampleRate, WhiteNoiseGenerator, ZdfSvfFilter } from '../../dsp';
import type {
  ParameterSchema,
  VoiceInstance,
  VoiceModule,
  VoiceRenderContext,
} from '../../registry/types';
import { clamp01, decayCoeff, detectNewTrigger, fastTanh, NoteHold, readParam, SUSTAIN_PARAM } from './voiceUtils';

/**
 * Clap & Snare: ein Händeklatscher entsteht aus 3–4 sehr kurz hintereinander
 * liegenden Rausch-Stößen plus Raum-Ausklang; die Snare aus gestimmtem Fell
 * (zwei Sinus mit Tonhöhen-Fall) plus Teppich-Rauschen. Stufenlos überblendbar.
 */

const NUM_BURSTS = 4;

const MORPH_PARAM: ParameterSchema = {
  id: 'clapSnare',
  label: 'Clap ↔ Snare',
  description: '0 = Händeklatscher (Clap), 1 = Snare-Trommel mit Fell, dazwischen geschichtet.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.2,
  curve: 'linear',
  modulatable: true,
};

const TONE_PARAM: ParameterSchema = {
  id: 'tone',
  label: 'Klangfarbe',
  description: 'Dumpf & hölzern bis hell & knackig.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.5,
  curve: 'linear',
  modulatable: true,
};

const DECAY_PARAM: ParameterSchema = {
  id: 'decay',
  label: 'Ausklingzeit',
  description: 'Trocken & kurz bis zu einem langen, hallenden Ausklang.',
  domain: 'timbre',
  min: 0.04,
  max: 0.9,
  defaultValue: 0.22,
  curve: 'exp',
  modulatable: true,
  unitLabel: 's',
};

const SPREAD_PARAM: ParameterSchema = {
  id: 'spread',
  label: 'Klatsch-Spreizung',
  description: 'Abstand der einzelnen Klatscher: eng = ein Klatscher, weit = eine ganze Gruppe Hände.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.45,
  curve: 'linear',
  modulatable: true,
};

const BODY_TUNE_PARAM: ParameterSchema = {
  id: 'bodyTune',
  label: 'Fell-Stimmung',
  description: 'Tonhöhe des Snare-Fells in Halbtönen.',
  domain: 'timbre',
  min: -12,
  max: 12,
  step: 1,
  defaultValue: 0,
  curve: 'linear',
  modulatable: true,
  unitLabel: 'st',
};

const SNAPPY_PARAM: ParameterSchema = {
  id: 'snappy',
  label: 'Teppich (Rasseln)',
  description: 'Wie stark der Snare-Teppich mitrasselt – wenig = Tom-artig, viel = scharfer Schnarr.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.6,
  curve: 'linear',
  modulatable: true,
};

const WIDTH_PARAM: ParameterSchema = {
  id: 'width',
  label: 'Stereo-Breite',
  description: 'Mono-mittig bis breit im Raum verteilt.',
  domain: 'space',
  min: 0,
  max: 1,
  defaultValue: 0.45,
  curve: 'linear',
  modulatable: true,
};

export class ClapSnareVoice implements VoiceInstance {
  private readonly hold = new NoteHold();
  private holdVel = 1;
  private readonly sampleRate: number;
  private readonly noiseL = new WhiteNoiseGenerator(0x6a09e667);
  private readonly noiseR = new WhiteNoiseGenerator(0xbb67ae85);
  private readonly clapBpL: ZdfSvfFilter;
  private readonly clapBpR: ZdfSvfFilter;
  private readonly snareHp: ZdfSvfFilter;
  private sinceTrig = 1e9;
  private vel = 0;
  private burstEnv = 0;
  private tailEnv = 0;
  private bodyEnv = 0;
  private pitchEnv = 0;
  private rattleEnv = 0;
  private phase1 = 0;
  private phase2 = 0;
  private burstSpacing = 480;

  constructor(sampleRate: number) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.clapBpL = new ZdfSvfFilter(this.sampleRate, 1200, 1.6, 1);
    this.clapBpR = new ZdfSvfFilter(this.sampleRate, 1260, 1.6, 1);
    this.snareHp = new ZdfSvfFilter(this.sampleRate, 2200, 0.8, 2);
  }

  public reset(): void {
    this.hold.reset();
    this.sinceTrig = 1e9;
    this.vel = 0;
    this.burstEnv = 0;
    this.tailEnv = 0;
    this.bodyEnv = 0;
    this.pitchEnv = 0;
    this.rattleEnv = 0;
    this.phase1 = 0;
    this.phase2 = 0;
    this.clapBpL.reset();
    this.clapBpR.reset();
    this.snareHp.reset();
    this.noiseL.reset();
    this.noiseR.reset();
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

    const morph = readParam(MORPH_PARAM, params);
    const tone = readParam(TONE_PARAM, params);
    const decay = readParam(DECAY_PARAM, params);
    const spread = readParam(SPREAD_PARAM, params);
    const bodyTune = readParam(BODY_TUNE_PARAM, params);
    const snappy = readParam(SNAPPY_PARAM, params);
    const width = readParam(WIDTH_PARAM, params);
    const sustain = readParam(SUSTAIN_PARAM, params);

    const trig = detectNewTrigger(ctx);
    if (trig > 0) {
      const accent = Number.isFinite(ctx.timeFrame.accent) ? clamp01(ctx.timeFrame.accent) : 0.6;
      this.vel = clamp(0.45 + 0.4 * trig + 0.15 * accent, 0.2, 1);
      this.sinceTrig = 0;
      this.burstSpacing = Math.max(1, Math.round((0.004 + spread * 0.011) * sr));
      this.burstEnv = this.vel;
      this.tailEnv = 0;
      this.bodyEnv = this.vel;
      this.pitchEnv = 1;
      this.rattleEnv = this.vel;
      this.holdVel = this.vel;
      this.phase1 = 0;
      this.phase2 = 0.25;
    }

    const holdFloor = this.hold.floor(ctx, trig, sustain, this.holdVel);
    const clapHz = clamp(800 + tone * 1500, 300, sr * 0.4);
    this.clapBpL.setParams(clapHz, 1.5, 1);
    this.clapBpR.setParams(clapHz * (1 + 0.05 * width), 1.5, 1);
    this.snareHp.setParams(clamp(1400 + tone * 3200, 500, sr * 0.4), 0.8, 2);

    const burstCoeff = decayCoeff(0.0032, sr);
    const tailCoeff = decayCoeff(decay * 0.45, sr);
    const bodyCoeff = decayCoeff(0.035 + decay * 0.12, sr);
    const pitchCoeff = decayCoeff(0.012, sr);
    const rattleCoeff = decayCoeff(0.04 + decay * 0.3, sr);
    const bodyHz = 185 * Math.pow(2, bodyTune / 12);
    const invSr = 1 / sr;
    const clapAmt = 1 - morph;
    const snareAmt = morph;
    const spacing = this.burstSpacing;
    const lastBurstAt = spacing * (NUM_BURSTS - 1);

    for (let i = 0; i < count; i++) {
      const t = this.sinceTrig;
      if (t > 0 && t <= lastBurstAt && t % spacing === 0) {
        // Folge-Klatscher: etwas leiser, der letzte geht in den Raum-Ausklang über
        const k = t / spacing;
        this.burstEnv = this.vel * (1 - 0.12 * k);
        if (k === NUM_BURSTS - 1) this.tailEnv = this.vel * 0.85;
      }
      this.sinceTrig = t + 1;

      const nL = this.noiseL.processSample();
      const nR = this.noiseR.processSample();
      const nMid = (nL + nR) * 0.5;
      const wL = nMid + (nL - nMid) * width;
      const wR = nMid + (nR - nMid) * width;

      // Clap
      const clapEnv = this.burstEnv + this.tailEnv * 0.55;
      const clapL = this.clapBpL.processSample(wL * clapEnv) * 2.4;
      const clapR = this.clapBpR.processSample(wR * clapEnv) * 2.4;

      // Snare-Fell: Grundton + Oberton (Verhältnis ~1,78) mit kurzem Tonhöhen-Fall
      const f = bodyHz * (1 + 0.55 * this.pitchEnv);
      this.phase1 += f * invSr;
      if (this.phase1 >= 1) this.phase1 -= 1;
      this.phase2 += f * 1.78 * invSr;
      if (this.phase2 >= 1) this.phase2 -= 1;
      const body =
        (Math.sin(this.phase1 * 6.283185307) * 0.75 + Math.sin(this.phase2 * 6.283185307) * 0.35) *
        this.bodyEnv *
        (1.1 - 0.5 * snappy);
      const rattle = this.snareHp.processSample(nMid) * this.rattleEnv * snappy * 1.25;
      const snare = body + rattle;

      const yL = clapL * clapAmt + (snare + (wL - nMid) * this.rattleEnv * snappy * 0.3) * snareAmt;
      const yR = clapR * clapAmt + (snare + (wR - nMid) * this.rattleEnv * snappy * 0.3) * snareAmt;
      const oL = fastTanh(yL * 1.2) * 0.8;
      const oR = fastTanh(yR * 1.2) * 0.8;
      outL[i] = oL * 0 === 0 ? oL : 0;
      outR[i] = oR * 0 === 0 ? oR : 0;

      this.burstEnv *= burstCoeff;
      this.tailEnv *= tailCoeff;
      this.bodyEnv *= bodyCoeff;
      this.pitchEnv *= pitchCoeff;
      this.rattleEnv *= rattleCoeff;
      if (holdFloor > 0) {
        if (this.rattleEnv < holdFloor) this.rattleEnv = holdFloor;
        if (t >= lastBurstAt && this.tailEnv < holdFloor * 0.85) this.tailEnv = holdFloor * 0.85;
      }
      if (this.burstEnv < 1e-6) this.burstEnv = 0;
      if (this.tailEnv < 1e-6) this.tailEnv = 0;
      if (this.bodyEnv < 1e-6) this.bodyEnv = 0;
      if (this.rattleEnv < 1e-6) this.rattleEnv = 0;
    }
    if (this.sinceTrig > 1e9) this.sinceTrig = 1e9;
  }
}

export const clapSnareVoiceModule: VoiceModule = {
  id: 'clap-snare',
  version: 1,
  category: 'rhythm',
  displayName: 'Clap & Snare',
  description:
    'Händeklatscher und Snare-Trommel – der Rückschlag auf 2 und 4, stufenlos zwischen Clap und Snare überblendbar.',
  parameters: [MORPH_PARAM, TONE_PARAM, DECAY_PARAM, SPREAD_PARAM, BODY_TUNE_PARAM, SNAPPY_PARAM, WIDTH_PARAM],
  createInstance(sampleRate: number): VoiceInstance {
    return new ClapSnareVoice(sampleRate);
  },
};
