import {
  clamp,
  OnePoleSmoother,
  PolyBlepOscillator,
  sanitizeSampleRate,
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
import { NoteHold, SUSTAIN_PARAM } from './voiceUtils';

const TWO_PI = Math.PI * 2;

function fastTanh(x: number): number {
  if (x <= -3) return -1;
  if (x >= 3) return 1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

const BODY_AIR_PARAM: ParameterSchema = {
  id: 'bodyAir',
  label: 'Körper & Luft',
  description: 'Mischt zwischen druckvollem Kick-Körper und luftiger Percussion-Textur.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.32,
  curve: 'linear',
  modulatable: true,
};

const PUNCH_DROP_PARAM: ParameterSchema = {
  id: 'punchDrop',
  label: 'Punch-Kick',
  description: 'Stärke des schnellen Tonhöhen-Abfalls am Anschlag für satten Techno-Druck.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.65,
  curve: 'linear',
  modulatable: true,
};

const DECAY_PARAM: ParameterSchema = {
  id: 'decay',
  label: 'Ausklingzeit',
  description: 'Wie lange der Impuls nachklingt – vom trockenen Klick bis zum tiefen Sub-Kick.',
  domain: 'timbre',
  min: 0.03,
  max: 1.5,
  defaultValue: 0.28,
  curve: 'exp',
  modulatable: true,
  unitLabel: 's',
};

const SNAP_PARAM: ParameterSchema = {
  id: 'snap',
  label: 'Anschlag-Knack',
  description: 'Schärfe und Durchsetzungskraft des ersten Transienten.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.6,
  curve: 'linear',
  modulatable: true,
};

const PITCH_OFFSET_PARAM: ParameterSchema = {
  id: 'pitchOffset',
  label: 'Tonhöhe',
  description: 'Stimmt den Grundschlag in Halbtönen passend zur Tonart.',
  domain: 'timbre',
  min: -24,
  max: 24,
  step: 1,
  defaultValue: 0,
  curve: 'linear',
  modulatable: true,
  unitLabel: 'st',
};

const TONE_COLOR_PARAM: ParameterSchema = {
  id: 'toneColor',
  label: 'Klangfarbe',
  description: 'Fügt warme Obertöne und leichte analoge Sättigung hinzu.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.25,
  curve: 'linear',
  modulatable: true,
};

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

export class PulseTextureVoice implements VoiceInstance {
  private readonly hold = new NoteHold();
  private holdVel = 1;
  private readonly sampleRate: number;
  private readonly bodyOsc: PolyBlepOscillator;
  private readonly harm2Osc: PolyBlepOscillator;
  private readonly harm3Osc: PolyBlepOscillator;
  private readonly noiseL: WhiteNoiseGenerator;
  private readonly noiseR: WhiteNoiseGenerator;
  private readonly airFilterL: ZdfSvfFilter;
  private readonly airFilterR: ZdfSvfFilter;
  private readonly clickFilter: ZdfSvfFilter;
  private readonly dcCoeff: number;
  private dcX1L = 0;
  private dcY1L = 0;
  private dcX1R = 0;
  private dcY1R = 0;

  private readonly bodyAirSmoother: OnePoleSmoother;
  private readonly toneColorSmoother: OnePoleSmoother;

  private bodyEnv = 0;
  private pitchEnv = 0;
  private snapEnv = 0;
  private airEnv = 0;
  private attackRamp = 1;
  private attackStep = 1;

  private lastDecay = -1;
  private lastSnap = -1;
  private bodyDecayCoeff = 0.999;
  private pitchDecayCoeff = 0.999;
  private snapDecayCoeff = 0.99;
  private airDecayCoeff = 0.999;

  private lastPitchMidi = Number.NaN;
  private cachedBaseHz = 55;
  private readonly bodyBuf = new Float32Array(8);
  private readonly clickBuf = new Float32Array(8);
  private readonly airBufL = new Float32Array(8);
  private readonly airBufR = new Float32Array(8);

  constructor(sampleRate: number) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.bodyOsc = new PolyBlepOscillator(this.sampleRate);
    this.bodyOsc.setWaveform('sine');

    this.harm2Osc = new PolyBlepOscillator(this.sampleRate);
    this.harm2Osc.setWaveform('sine');

    this.harm3Osc = new PolyBlepOscillator(this.sampleRate);
    this.harm3Osc.setWaveform('triangle');

    this.noiseL = new WhiteNoiseGenerator(0x13572468);
    this.noiseR = new WhiteNoiseGenerator(0x9abcdef1);

    this.airFilterL = new ZdfSvfFilter(this.sampleRate, 3600, 1.25, 1.35);
    this.airFilterR = new ZdfSvfFilter(this.sampleRate, 3850, 1.25, 1.35);
    this.clickFilter = new ZdfSvfFilter(this.sampleRate, 2600, 1.4, 1);

    const dcW0 = (TWO_PI * 18) / this.sampleRate;
    this.dcCoeff = Math.max(0.9, Math.min(0.99999, 1 - dcW0));

    this.bodyAirSmoother = new OnePoleSmoother(this.sampleRate, 12, BODY_AIR_PARAM.defaultValue);
    this.toneColorSmoother = new OnePoleSmoother(this.sampleRate, 12, TONE_COLOR_PARAM.defaultValue);

    this.attackStep = 1 / Math.max(1, Math.round(0.0012 * this.sampleRate));
  }

  public reset(): void {
    this.hold.reset();
    this.bodyOsc.reset(0);
    this.harm2Osc.reset(0);
    this.harm3Osc.reset(0);
    this.noiseL.reset();
    this.noiseR.reset();
    this.airFilterL.reset();
    this.airFilterR.reset();
    this.clickFilter.reset();
    this.dcX1L = 0;
    this.dcY1L = 0;
    this.dcX1R = 0;
    this.dcY1R = 0;
    this.bodyAirSmoother.reset(BODY_AIR_PARAM.defaultValue);
    this.toneColorSmoother.reset(TONE_COLOR_PARAM.defaultValue);
    this.bodyEnv = 0;
    this.pitchEnv = 0;
    this.snapEnv = 0;
    this.airEnv = 0;
    this.attackRamp = 1;
    this.lastDecay = -1;
    this.lastSnap = -1;
    this.lastPitchMidi = Number.NaN;
  }

  public process(
    outL: Float32Array,
    outR: Float32Array,
    params: Record<string, number>,
    ctx: VoiceRenderContext,
  ): void {
    const count = Math.min(ctx.numSamples | 0, outL.length, outR.length);
    if (count <= 0) return;

    const targetBodyAir = readParam(BODY_AIR_PARAM, params);
    const punchDrop = readParam(PUNCH_DROP_PARAM, params);
    const decay = readParam(DECAY_PARAM, params);
    const snap = readParam(SNAP_PARAM, params);
    const pitchOffset = readParam(PITCH_OFFSET_PARAM, params);
    const targetToneColor = readParam(TONE_COLOR_PARAM, params);
    const sustain = readParam(SUSTAIN_PARAM, params);

    const trig = Number.isFinite(ctx.timeFrame.triggerIntensity)
      ? clamp(ctx.timeFrame.triggerIntensity, 0, 1)
      : 0;
    const prevTrig = Number.isFinite(ctx.prevPulseTrigger) ? ctx.prevPulseTrigger : 0;
    const isNewTrigger = trig > 0.01 && prevTrig <= 0.01;

    if (isNewTrigger) {
      const vel = clamp(0.38 + 0.62 * trig, 0.2, 1);
      const accent = Number.isFinite(ctx.timeFrame.accent)
        ? clamp(ctx.timeFrame.accent, 0, 1)
        : 0.5;

      if (this.bodyEnv < 0.08) {
        this.bodyOsc.reset(0);
        this.harm2Osc.reset(0);
        this.harm3Osc.reset(0);
      }
      this.bodyEnv = Math.max(this.bodyEnv * 0.25, vel);
      this.holdVel = vel;
      this.pitchEnv = 1;
      this.snapEnv = vel;
      this.airEnv = Math.max(this.airEnv * 0.3, vel * (0.45 + 0.55 * accent));
      this.attackRamp = 0;
    }

    const holdFloor = this.hold.floor(ctx, isNewTrigger ? 1 : 0, sustain, this.holdVel);

    // Fold harmony root into warm kick fundamental octave [30..41] (~46..87 Hz),
    // then apply user pitchOffset freely in semitones.
    let rootKickMidi = Number.isFinite(ctx.harmony.rootMidi)
      ? ctx.harmony.rootMidi
      : 36;
    while (rootKickMidi > 41) rootKickMidi -= 12;
    while (rootKickMidi < 30) rootKickMidi += 12;

    const targetMidi = clamp(rootKickMidi + pitchOffset, 18, 96);
    if (Math.abs(targetMidi - this.lastPitchMidi) > 1e-6) {
      this.lastPitchMidi = targetMidi;
      this.cachedBaseHz = midiToFreq(targetMidi);
    }
    const baseHz = this.cachedBaseHz;

    const sr = this.sampleRate;
    if (Math.abs(decay - this.lastDecay) > 1e-6 || Math.abs(snap - this.lastSnap) > 1e-6) {
      this.lastDecay = decay;
      this.lastSnap = snap;

      const bodyTau = clamp(decay * 0.48, 0.018, 1.3);
      this.bodyDecayCoeff = Math.exp(-1 / (bodyTau * sr));

      const pitchTau = 0.016 + (1 - snap) * 0.024;
      this.pitchDecayCoeff = Math.exp(-1 / (pitchTau * sr));

      const snapTau = 0.0028 + (1 - snap) * 0.0035;
      this.snapDecayCoeff = Math.exp(-1 / (snapTau * sr));

      const airTau = 0.022 + decay * 0.22;
      this.airDecayCoeff = Math.exp(-1 / (airTau * sr));
    }

    const bodyDecayCoeff = this.bodyDecayCoeff;
    const pitchDecayCoeff = this.pitchDecayCoeff;
    const snapDecayCoeff = this.snapDecayCoeff;
    const airDecayCoeff = this.airDecayCoeff;

    const pulseEnergy = Number.isFinite(ctx.timeFrame.pulseEnergy)
      ? clamp(ctx.timeFrame.pulseEnergy, 0, 1)
      : 0;

    const maxOscHz = sr * 0.44;
    const maxAirHz = sr * 0.42;
    const clickFreq = clamp(1800 + snap * 2400, 500, sr * 0.4);
    this.clickFilter.setParams(clickFreq, 1.3, 1);

    for (let start = 0; start < count; start += 8) {
      const end = Math.min(start + 8, count);
      const subLen = end - start;

      let bodyAir = targetBodyAir;
      if (this.bodyAirSmoother.current !== bodyAir) {
        for (let k = 0; k < subLen; k++) {
          bodyAir = this.bodyAirSmoother.process(targetBodyAir);
        }
        if (Math.abs(bodyAir - targetBodyAir) < 1e-6) {
          bodyAir = targetBodyAir;
          this.bodyAirSmoother.reset(targetBodyAir);
        }
      }
      let toneColor = targetToneColor;
      if (this.toneColorSmoother.current !== toneColor) {
        for (let k = 0; k < subLen; k++) {
          toneColor = this.toneColorSmoother.process(targetToneColor);
        }
        if (Math.abs(toneColor - targetToneColor) < 1e-6) {
          toneColor = targetToneColor;
          this.toneColorSmoother.reset(targetToneColor);
        }
      }

      const instFreq = clamp(
        baseHz * (1 + punchDrop * 3.8 * this.pitchEnv),
        20,
        maxOscHz,
      );
      this.bodyOsc.setFreq(instFreq);
      this.harm2Osc.setFreq(Math.min(instFreq * 2, maxOscHz));
      this.harm3Osc.setFreq(Math.min(instFreq * 3, maxOscHz));

      const airFreq = clamp(2400 + toneColor * 5200, 600, maxAirHz);
      const airQ = 1.0 + snap * 0.9;
      this.airFilterL.setParams(airFreq, airQ, 1.35);
      this.airFilterR.setParams(Math.min(airFreq * 1.07, maxAirHz), airQ, 1.35);

      const harm2Gain = toneColor * 0.26;
      const harm3Gain = toneColor * toneColor * 0.14;
      const bodyDrive = 1.08 + toneColor * 1.45;
      const bodyMix = 1 - 0.32 * bodyAir;
      const airPulseBias = pulseEnergy * 0.14 * bodyAir;
      const airGain = bodyAir * 0.65;
      const snapGain = snap * 0.55;

      const bodyBuf = this.bodyBuf;
      const clickBuf = this.clickBuf;
      const airBufL = this.airBufL;
      const airBufR = this.airBufR;
      const bodyOsc = this.bodyOsc;
      const harm2Osc = this.harm2Osc;
      const harm3Osc = this.harm3Osc;
      const noiseL = this.noiseL;
      const noiseR = this.noiseR;
      const attackStep = this.attackStep;
      let attackRamp = this.attackRamp;
      let bodyEnv = this.bodyEnv;
      let pitchEnv = this.pitchEnv;

      for (let k = 0; k < subLen; k++) {
        if (attackRamp < 1) {
          attackRamp = Math.min(1, attackRamp + attackStep);
        }

        const osc1 = bodyOsc.processSample();
        const osc2 = harm2Osc.processSample();
        const osc3 = harm3Osc.processSample();

        const bodyRaw = (osc1 + harm2Gain * osc2 + harm3Gain * osc3) * bodyEnv * attackRamp;
        bodyBuf[k] = fastTanh(bodyRaw * bodyDrive) * 0.86 * bodyMix;

        const nL = noiseL.processSample();
        const nR = noiseR.processSample();
        clickBuf[k] = nL * 0.7 + osc2 * 0.3;
        airBufL[k] = nL;
        airBufR[k] = nR;

        bodyEnv *= bodyDecayCoeff;
        if (bodyEnv < holdFloor) bodyEnv = holdFloor;
        pitchEnv *= pitchDecayCoeff;
      }

      this.attackRamp = attackRamp;
      this.bodyEnv = bodyEnv;
      this.pitchEnv = pitchEnv;

      this.clickFilter.processBlock(clickBuf, 0, subLen);
      this.airFilterL.processBlock(airBufL, 0, subLen);
      this.airFilterR.processBlock(airBufR, 0, subLen);

      const dcCoeff = this.dcCoeff;
      let dcX1L = this.dcX1L;
      let dcY1L = this.dcY1L;
      let dcX1R = this.dcX1R;
      let dcY1R = this.dcY1R;
      let snapEnv = this.snapEnv;
      let airEnv = this.airEnv;

      for (let k = 0; k < subLen; k++) {
        const i = start + k;
        const clickSig = clickBuf[k]! * snapEnv * snapGain;
        const airGate = airEnv + airPulseBias;
        const airSigL = airBufL[k]! * airGate * airGain;
        const airSigR = airBufR[k]! * airGate * airGain;
        const bodyOut = bodyBuf[k]!;

        const inL = fastTanh((bodyOut + clickSig + airSigL) * 0.95);
        const inR = fastTanh((bodyOut + clickSig + airSigR) * 0.95);
        let yL = inL - dcX1L + dcCoeff * dcY1L;
        let yR = inR - dcX1R + dcCoeff * dcY1R;
        if (yL > -1e-20 && yL < 1e-20) yL = 0;
        if (yR > -1e-20 && yR < 1e-20) yR = 0;
        dcX1L = inL;
        dcY1L = yL;
        dcX1R = inR;
        dcY1R = yR;

        outL[i] = yL * 0 === 0 ? yL : 0;
        outR[i] = yR * 0 === 0 ? yR : 0;

        snapEnv *= snapDecayCoeff;
        airEnv *= airDecayCoeff;
      }

      this.snapEnv = snapEnv;
      this.airEnv = airEnv;
      this.dcX1L = dcX1L;
      this.dcY1L = dcY1L;
      this.dcX1R = dcX1R;
      this.dcY1R = dcY1R;
    }
  }
}

export const pulseTextureVoiceModule: VoiceModule = {
  id: 'pulse-texture',
  version: 1,
  category: 'rhythm',
  displayName: 'Puls & Textur',
  description: 'Druckvoller Techno-Kick und knackige Percussion mit luftiger Textur.',
  parameters: [
    BODY_AIR_PARAM,
    PUNCH_DROP_PARAM,
    DECAY_PARAM,
    SNAP_PARAM,
    PITCH_OFFSET_PARAM,
    TONE_COLOR_PARAM,
  ],
  createInstance(sampleRate: number): VoiceInstance {
    return new PulseTextureVoice(sampleRate);
  },
};
