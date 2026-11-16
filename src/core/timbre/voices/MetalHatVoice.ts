import { clamp, sanitizeSampleRate, WhiteNoiseGenerator, ZdfSvfFilter } from '../../dsp';
import type {
  ParameterSchema,
  VoiceInstance,
  VoiceModule,
  VoiceRenderContext,
} from '../../registry/types';
import { clamp01, decayCoeff, detectNewTrigger, fastTanh, readParam } from './voiceUtils';

/**
 * Hi-Hat & Becken: sechs inharmonische Rechteck-Oszillatoren (klassische
 * Drum-Machine-Verhältnisse) + Rauschen, durch Bandpass & Hochpass geformt.
 * „Öffnung“ blendet stufenlos von geschlossener Hi-Hat zu offenem Becken.
 */

const METAL_RATIOS = new Float64Array([1.0, 1.4826, 1.8003, 2.5461, 2.6303, 3.8968]);
const METAL_BASE_HZ = 205.3;
const NUM_OSC = 6;

const OPENNESS_PARAM: ParameterSchema = {
  id: 'openness',
  label: 'Öffnung',
  description: '0 = kurze, geschlossene Hi-Hat („tz“), 1 = offenes, lang zischendes Becken („tssss“).',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.15,
  curve: 'linear',
  modulatable: true,
};

const TONE_PARAM: ParameterSchema = {
  id: 'tone',
  label: 'Helligkeit',
  description: 'Dunkel & weich (gedämpft) bis gleißend hell.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.6,
  curve: 'linear',
  modulatable: true,
};

const METAL_NOISE_PARAM: ParameterSchema = {
  id: 'metalNoise',
  label: 'Metall ↔ Rauschen',
  description: '0 = metallisch-klingelnd (Becken-Obertöne), 1 = reines Zischen.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.45,
  curve: 'linear',
  modulatable: true,
};

const TUNE_PARAM: ParameterSchema = {
  id: 'tune',
  label: 'Stimmung',
  description: 'Verschiebt die metallischen Obertöne – tiefer = schwerer Ride, höher = feines Shaker-Glitzern.',
  domain: 'timbre',
  min: -12,
  max: 12,
  step: 1,
  defaultValue: 0,
  curve: 'linear',
  modulatable: true,
  unitLabel: 'st',
};

const DYNAMICS_PARAM: ParameterSchema = {
  id: 'dynamics',
  label: 'Dynamik',
  description: 'Wie stark leise und betonte Schläge sich unterscheiden (0 = alle gleich, 1 = lebendige Akzente).',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.55,
  curve: 'linear',
  modulatable: true,
};

const WIDTH_PARAM: ParameterSchema = {
  id: 'width',
  label: 'Stereo-Breite',
  description: 'Wie breit das Zischen im Raum steht.',
  domain: 'space',
  min: 0,
  max: 1,
  defaultValue: 0.5,
  curve: 'linear',
  modulatable: true,
};

export class MetalHatVoice implements VoiceInstance {
  private readonly sampleRate: number;
  private readonly phases = new Float64Array(NUM_OSC);
  private readonly incs = new Float64Array(NUM_OSC);
  private readonly noiseL = new WhiteNoiseGenerator(0x51ed270b);
  private readonly noiseR = new WhiteNoiseGenerator(0x2f8c6a13);
  private readonly bpL: ZdfSvfFilter;
  private readonly bpR: ZdfSvfFilter;
  private readonly hpL: ZdfSvfFilter;
  private readonly hpR: ZdfSvfFilter;
  private env = 0;
  private envCoeff = 0.999;
  private attack = 1;
  private readonly attackStep: number;
  private lastTune = Number.NaN;
  private lastOpen = -1;
  private vel = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.bpL = new ZdfSvfFilter(this.sampleRate, 9000, 1.1, 1);
    this.bpR = new ZdfSvfFilter(this.sampleRate, 9400, 1.1, 1);
    this.hpL = new ZdfSvfFilter(this.sampleRate, 6500, 0.75, 2);
    this.hpR = new ZdfSvfFilter(this.sampleRate, 6800, 0.75, 2);
    this.attackStep = 1 / Math.max(1, Math.round(0.0004 * this.sampleRate));
    for (let i = 0; i < NUM_OSC; i++) this.phases[i] = (i * 0.137) % 1;
  }

  public reset(): void {
    this.env = 0;
    this.attack = 1;
    this.vel = 0;
    this.bpL.reset();
    this.bpR.reset();
    this.hpL.reset();
    this.hpR.reset();
    this.noiseL.reset();
    this.noiseR.reset();
    this.lastTune = Number.NaN;
    this.lastOpen = -1;
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

    const openness = readParam(OPENNESS_PARAM, params);
    const tone = readParam(TONE_PARAM, params);
    const metalNoise = readParam(METAL_NOISE_PARAM, params);
    const tune = readParam(TUNE_PARAM, params);
    const dynamics = readParam(DYNAMICS_PARAM, params);
    const width = readParam(WIDTH_PARAM, params);

    if (tune !== this.lastTune) {
      this.lastTune = tune;
      const base = METAL_BASE_HZ * Math.pow(2, tune / 12) * 1.7;
      for (let i = 0; i < NUM_OSC; i++) {
        this.incs[i] = Math.min(0.45, (base * METAL_RATIOS[i]!) / sr);
      }
    }
    if (Math.abs(openness - this.lastOpen) > 1e-4) {
      this.lastOpen = openness;
      // 18 ms (geschlossen) … ~1,1 s (offen), quadratisch für feine Kontrolle unten
      this.envCoeff = decayCoeff(0.018 + openness * openness * 1.05, sr);
    }

    const trig = detectNewTrigger(ctx);
    if (trig > 0) {
      const accent = Number.isFinite(ctx.timeFrame.accent) ? clamp01(ctx.timeFrame.accent) : 0.6;
      const raw = 0.55 * trig + 0.45 * accent;
      this.vel = clamp(1 - dynamics + dynamics * raw, 0.12, 1);
      // Choke: neuer Schlag schneidet den alten ab (wie bei einer echten Hi-Hat)
      this.env = this.vel;
      this.attack = 0;
    }

    const bpHz = clamp(6000 + tone * 6500, 2000, sr * 0.42);
    const hpHz = clamp(4200 + tone * 4200, 1500, sr * 0.4);
    const q = 0.9 + (1 - metalNoise) * 1.6;
    this.bpL.setParams(bpHz, q, 1);
    this.bpR.setParams(Math.min(bpHz * (1 + 0.06 * width), sr * 0.42), q, 1);
    this.hpL.setParams(hpHz, 0.75, 2);
    this.hpR.setParams(hpHz * (1 + 0.04 * width), 0.75, 2);

    const metalGain = (1 - metalNoise) * 0.42;
    const noiseGain = 0.25 + metalNoise * 0.75;
    const sideAmt = width * 0.8;
    const envCoeff = this.envCoeff;
    const attackStep = this.attackStep;
    const phases = this.phases;
    const incs = this.incs;
    let env = this.env;
    let attack = this.attack;

    for (let i = 0; i < count; i++) {
      if (env < 1e-5) {
        env = 0;
        // Filter-Zustand weiter laufen lassen, aber mit Stille füttern
        const sL = this.hpL.processSample(this.bpL.processSample(0));
        const sR = this.hpR.processSample(this.bpR.processSample(0));
        outL[i] = sL * 0 === 0 ? sL : 0;
        outR[i] = sR * 0 === 0 ? sR : 0;
        continue;
      }
      if (attack < 1) attack = Math.min(1, attack + attackStep);
      let metal = 0;
      for (let o = 0; o < NUM_OSC; o++) {
        let p = phases[o]! + incs[o]!;
        if (p >= 1) p -= 1;
        phases[o] = p;
        metal += p < 0.5 ? 1 : -1;
      }
      metal *= metalGain / NUM_OSC * 2.2;
      const nL = this.noiseL.processSample();
      const nR = this.noiseR.processSample();
      const nMid = (nL + nR) * 0.5;
      const srcL = metal + (nMid + (nL - nMid) * sideAmt) * noiseGain;
      const srcR = metal + (nMid + (nR - nMid) * sideAmt) * noiseGain;
      const e = env * attack;
      const yL = this.hpL.processSample(this.bpL.processSample(srcL * e));
      const yR = this.hpR.processSample(this.bpR.processSample(srcR * e));
      const oL = fastTanh(yL * 2.2) * 0.95;
      const oR = fastTanh(yR * 2.2) * 0.95;
      outL[i] = oL * 0 === 0 ? oL : 0;
      outR[i] = oR * 0 === 0 ? oR : 0;
      env *= envCoeff;
    }
    this.env = env;
    this.attack = attack;
  }
}

export const metalHatVoiceModule: VoiceModule = {
  id: 'metal-hat',
  version: 1,
  category: 'rhythm',
  displayName: 'Hi-Hat & Becken',
  description:
    'Metallisch-zischende Hi-Hats, Shaker und offene Becken – das Treibende über dem Kick (ideal auf Offbeats und 16teln).',
  parameters: [OPENNESS_PARAM, TONE_PARAM, METAL_NOISE_PARAM, TUNE_PARAM, DYNAMICS_PARAM, WIDTH_PARAM],
  createInstance(sampleRate: number): VoiceInstance {
    return new MetalHatVoice(sampleRate);
  },
};
