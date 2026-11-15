import {
  clamp,
  OnePoleSmoother,
  PolyBlepOscillator,
  sanitizeSampleRate,
  ZdfSvfFilter,
} from '../../dsp';
import {
  type ParameterSchema,
  type VoiceInstance,
  type VoiceModule,
  type VoiceRenderContext,
} from '../../registry/types';
import { midiToFreq } from '../../theory';

const TWO_PI = Math.PI * 2;

function fastTanh(x: number): number {
  if (x <= -3) return -1;
  if (x >= 3) return 1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

const SUB_WARMTH_PARAM: ParameterSchema = {
  id: 'subWarmth',
  label: 'Sub-Wärme',
  description: 'Füllt den Tiefbass mit einer warmen Oktav-Schicht und runder Sättigung.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.78,
  curve: 'linear',
  modulatable: true,
};

const PHASE_BITE_PARAM: ParameterSchema = {
  id: 'phaseBite',
  label: 'Obertöne & Biss',
  description: 'Fügt knurrende Oberton-Färbung hinzu, damit der Bass auf jedem System trägt.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.22,
  curve: 'linear',
  modulatable: true,
};

const GLIDE_PARAM: ParameterSchema = {
  id: 'glide',
  label: 'Glide (Übergang)',
  description: 'Weiches Hinübergleiten zwischen aufeinanderfolgenden Bass-Noten.',
  domain: 'timbre',
  min: 0,
  max: 0.35,
  defaultValue: 0.04,
  curve: 'linear',
  modulatable: true,
  unitLabel: 's',
};

const OCTAVE_SHIFT_PARAM: ParameterSchema = {
  id: 'octaveShift',
  label: 'Oktavlage',
  description: 'Verschiebt den Bassbereich um ganze Oktaven nach unten oder oben.',
  domain: 'harmony',
  min: -2,
  max: 1,
  step: 1,
  defaultValue: -1,
  curve: 'linear',
  modulatable: false,
};

const AUTO_DUCK_PARAM: ParameterSchema = {
  id: 'autoDuck',
  label: 'Beat-Ducking',
  description: 'Senkt den Subbass auf jeder Viertelnote ab, damit die Kick frei atmet.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.55,
  curve: 'linear',
  modulatable: true,
};

const SUSTAIN_HOLD_PARAM: ParameterSchema = {
  id: 'sustainHold',
  label: 'Halte-Energie',
  description: 'Bestimmt, wie lang und tragend der Bass zwischen den Pulsen stehen bleibt.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.6,
  curve: 'linear',
  modulatable: true,
};

const STEP_DEGREE_OFFSETS = [0, 0, 2, 0, 4, 0, 1, 3] as const;

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

function selectScaleBassMidi(
  scaleNotesMidi: readonly number[],
  rootMidi: number,
  octaveShift: number,
  stepIndex: number,
): number {
  let targetBase = rootMidi + octaveShift * 12;
  while (targetBase < 24) targetBase += 12;
  while (targetBase > 72) targetBase -= 12;

  if (scaleNotesMidi.length === 0) {
    return targetBase;
  }

  let closestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < scaleNotesMidi.length; i++) {
    const n = scaleNotesMidi[i]!;
    const dist = Math.abs(n - targetBase);
    if (dist < bestDist) {
      bestDist = dist;
      closestIdx = i;
    }
  }

  const safeStep = Number.isFinite(stepIndex) ? Math.abs(Math.floor(stepIndex)) : 0;
  const degreeOffset = STEP_DEGREE_OFFSETS[safeStep % STEP_DEGREE_OFFSETS.length] ?? 0;
  const noteIdx = Math.min(scaleNotesMidi.length - 1, closestIdx + degreeOffset);
  let chosen = scaleNotesMidi[noteIdx] ?? targetBase;

  while (chosen < 24) chosen += 12;
  while (chosen > 76) chosen -= 12;
  return chosen;
}

export class SubMotionVoice implements VoiceInstance {
  private readonly sampleRate: number;
  private readonly subOsc: PolyBlepOscillator;
  private readonly warmOsc: PolyBlepOscillator;
  private readonly biteOsc: PolyBlepOscillator;
  private readonly biteFilter: ZdfSvfFilter;
  private readonly dcCoeff: number;
  private dcX1 = 0;
  private dcY1 = 0;

  private readonly freqSmoother: OnePoleSmoother;
  private readonly warmthSmoother: OnePoleSmoother;
  private readonly biteSmoother: OnePoleSmoother;

  private readonly trigDecayCoeff: number;
  private trigBoost = 0;
  private lastGlideMs = -1;
  private lastEnvMs = -1;
  private envCurrent = 0;
  private envCoeff = 0.999;
  private lastTargetMidi = Number.NaN;
  private cachedTargetHz = 55;
  private readonly biteBuf = new Float32Array(8);

  constructor(sampleRate: number) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.trigDecayCoeff = Math.exp(-1 / (0.11 * this.sampleRate));
    this.subOsc = new PolyBlepOscillator(this.sampleRate);
    this.subOsc.setWaveform('sine');

    this.warmOsc = new PolyBlepOscillator(this.sampleRate);
    this.warmOsc.setWaveform('sine');

    this.biteOsc = new PolyBlepOscillator(this.sampleRate);
    this.biteOsc.setWaveform('saw');

    this.biteFilter = new ZdfSvfFilter(this.sampleRate, 420, 0.95, 0);
    const dcW0 = (TWO_PI * 18) / this.sampleRate;
    this.dcCoeff = Math.max(0.9, Math.min(0.99999, 1 - dcW0));

    this.freqSmoother = new OnePoleSmoother(this.sampleRate, 40, 55);
    this.envCoeff = Math.exp(-1 / (0.018 * this.sampleRate));
    this.warmthSmoother = new OnePoleSmoother(this.sampleRate, 12, SUB_WARMTH_PARAM.defaultValue);
    this.biteSmoother = new OnePoleSmoother(this.sampleRate, 12, PHASE_BITE_PARAM.defaultValue);
  }

  public reset(): void {
    this.subOsc.reset(0);
    this.warmOsc.reset(0);
    this.biteOsc.reset(0);
    this.biteFilter.reset();
    this.dcX1 = 0;
    this.dcY1 = 0;
    this.freqSmoother.reset(55);
    this.envCurrent = 0;
    this.envCoeff = Math.exp(-1 / (0.018 * this.sampleRate));
    this.warmthSmoother.reset(SUB_WARMTH_PARAM.defaultValue);
    this.biteSmoother.reset(PHASE_BITE_PARAM.defaultValue);
    this.trigBoost = 0;
    this.lastGlideMs = -1;
    this.lastEnvMs = -1;
    this.lastTargetMidi = Number.NaN;
    this.cachedTargetHz = 55;
  }

  public process(
    outL: Float32Array,
    outR: Float32Array,
    params: Record<string, number>,
    ctx: VoiceRenderContext,
  ): void {
    const count = Math.min(ctx.numSamples | 0, outL.length, outR.length);
    if (count <= 0) return;

    const targetWarmth = readParam(SUB_WARMTH_PARAM, params);
    const targetBite = readParam(PHASE_BITE_PARAM, params);
    const glideSec = readParam(GLIDE_PARAM, params);
    const octaveShift = Math.round(readParam(OCTAVE_SHIFT_PARAM, params));
    const autoDuck = readParam(AUTO_DUCK_PARAM, params);
    const sustainHold = readParam(SUSTAIN_HOLD_PARAM, params);

    const glideMs = Math.max(2, glideSec * 1000);
    if (Math.abs(glideMs - this.lastGlideMs) > 0.05) {
      this.lastGlideMs = glideMs;
      this.freqSmoother.setTimeMs(glideMs);
    }

    const envMs = 10 + sustainHold * 45;
    if (Math.abs(envMs - this.lastEnvMs) > 0.05) {
      this.lastEnvMs = envMs;
      this.envCoeff = Math.exp(-1 / (envMs * 0.001 * this.sampleRate));
    }

    const pulseEnergy = Number.isFinite(ctx.timeFrame.pulseEnergy)
      ? clamp(ctx.timeFrame.pulseEnergy, 0, 1)
      : 0;

    const trig = Number.isFinite(ctx.timeFrame.triggerIntensity)
      ? clamp(ctx.timeFrame.triggerIntensity, 0, 1)
      : 0;
    const prevTrig = Number.isFinite(ctx.prevPulseTrigger) ? ctx.prevPulseTrigger : 0;
    if (trig > 0.01 && prevTrig <= 0.01) {
      this.trigBoost = Math.max(this.trigBoost, 0.35 * trig);
    }

    const rootMidi = Number.isFinite(ctx.harmony.rootMidi) ? ctx.harmony.rootMidi : 36;
    const targetMidi = selectScaleBassMidi(
      ctx.harmony.scaleNotesMidi,
      rootMidi,
      octaveShift,
      ctx.timeFrame.stepIndex,
    );
    if (targetMidi !== this.lastTargetMidi) {
      this.lastTargetMidi = targetMidi;
      this.cachedTargetHz = clamp(midiToFreq(targetMidi), 24, this.sampleRate * 0.25);
    }
    const targetHz = this.cachedTargetHz;

    const shapedPulse = pulseEnergy * (0.35 + 0.65 * pulseEnergy);
    const decayWeight = clamp(sustainHold * 2, 0, 1);
    const droneFloor = clamp((sustainHold - 0.5) / 0.5, 0, 1);
    const rhythmicGate = Math.max(shapedPulse, this.trigBoost * decayWeight * pulseEnergy);
    const targetGate = clamp(rhythmicGate + droneFloor * (1 - rhythmicGate), 0, 1);

    const trigDecayCoeff = this.trigDecayCoeff;

    // Estimate beat advancement per sample (~128 BPM fallback if beatsPerBar is nominal)
    const baseBeat = Number.isFinite(ctx.beatPosition) ? ctx.beatPosition : 0;
    const beatsPerSample = 2.133333 / this.sampleRate;
    const maxOscHz = this.sampleRate * 0.44;

    for (let start = 0; start < count; start += 8) {
      const end = Math.min(start + 8, count);
      const subLen = end - start;

      let freq = targetHz;
      if (this.freqSmoother.current !== freq) {
        for (let k = 0; k < subLen; k++) {
          freq = this.freqSmoother.process(targetHz);
        }
        if (Math.abs(freq - targetHz) < 1e-4) {
          freq = targetHz;
          this.freqSmoother.reset(targetHz);
        }
      }
      let warmth = targetWarmth;
      if (this.warmthSmoother.current !== warmth) {
        for (let k = 0; k < subLen; k++) {
          warmth = this.warmthSmoother.process(targetWarmth);
        }
        if (Math.abs(warmth - targetWarmth) < 1e-6) {
          warmth = targetWarmth;
          this.warmthSmoother.reset(targetWarmth);
        }
      }
      let bite = targetBite;
      if (this.biteSmoother.current !== bite) {
        for (let k = 0; k < subLen; k++) {
          bite = this.biteSmoother.process(targetBite);
        }
        if (Math.abs(bite - targetBite) < 1e-6) {
          bite = targetBite;
          this.biteSmoother.reset(targetBite);
        }
      }

      this.subOsc.setFreq(freq);
      this.warmOsc.setFreq(Math.min(freq * 2, maxOscHz));
      this.biteOsc.setFreq(freq);

      const envApprox = this.envCurrent;
      const biteCutoff = clamp(freq * (1.8 + bite * 8.5 + envApprox * 2.5), 110, 3200);
      this.biteFilter.setParams(biteCutoff, 0.9 + bite * 0.9, 0);

      let duck = 1;
      if (autoDuck > 1e-5) {
        const beatNow = baseBeat + start * beatsPerSample;
        const beatFrac = ((beatNow % 1) + 1) % 1;
        duck = 1 - autoDuck * 0.75 * Math.exp(-beatFrac * 6);
      }

      const subGain = 0.76 + 0.16 * warmth;
      const warmGain = 0.3 * warmth;
      const biteGain = 0.38 * bite;
      const driveGain = 0.95 + 0.7 * warmth;
      const outScale = duck * 0.62;

      const biteBuf = this.biteBuf;
      const biteOsc = this.biteOsc;
      for (let k = 0; k < subLen; k++) {
        biteBuf[k] = biteOsc.processSample();
      }
      this.biteFilter.processBlock(biteBuf, 0, subLen);

      const subOsc = this.subOsc;
      const warmOsc = this.warmOsc;
      const envCoeff = this.envCoeff;
      let env = this.envCurrent;
      const dcCoeff = this.dcCoeff;
      let dcX1 = this.dcX1;
      let dcY1 = this.dcY1;
      let trigBoost = this.trigBoost;

      for (let k = 0; k < subLen; k++) {
        const i = start + k;
        env = targetGate + envCoeff * (env - targetGate);
        const sub = subOsc.processSample();
        const warm = warmOsc.processSample();
        const sawFiltered = biteBuf[k]!;

        const raw = sub * subGain + warm * warmGain + sawFiltered * biteGain;
        const shaped = fastTanh(raw * driveGain);

        const x = shaped * env * outScale;
        const y = x - dcX1 + dcCoeff * dcY1;
        dcX1 = x;
        dcY1 = y;
        outL[i] = y;
        outR[i] = y;

        trigBoost *= trigDecayCoeff;
      }

      if (!Number.isFinite(dcY1)) {
        dcX1 = 0; dcY1 = 0; env = 0;
        for (let k = 0; k < subLen; k++) { outL[start + k] = 0; outR[start + k] = 0; }
      } else {
        if (dcY1 > -1e-20 && dcY1 < 1e-20) dcY1 = 0;
        if (env > -1e-20 && env < 1e-20) env = 0;
      }

      this.envCurrent = env;
      this.trigBoost = trigBoost;
      this.dcX1 = dcX1;
      this.dcY1 = dcY1;
    }
  }
}

export const subMotionVoiceModule: VoiceModule = {
  id: 'sub-motion',
  version: 1,
  category: 'bass',
  displayName: 'Sub-Bewegung',
  description: 'Warmer, skalen-gebundener Subbass mit weichem Glide und Beat-Ducking.',
  parameters: [
    SUB_WARMTH_PARAM,
    PHASE_BITE_PARAM,
    GLIDE_PARAM,
    OCTAVE_SHIFT_PARAM,
    AUTO_DUCK_PARAM,
    SUSTAIN_HOLD_PARAM,
  ],
  createInstance(sampleRate: number): VoiceInstance {
    return new SubMotionVoice(sampleRate);
  },
};
