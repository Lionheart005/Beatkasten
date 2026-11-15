import {
  clamp,
  OnePoleSmoother,
  PolyBlepOscillator,
  sanitizeSampleRate,
  ZdfSvfFilter,
} from '../../dsp';
import { wrapPhase01 } from '../../math';
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

const NUM_VOICES = 4;
const MAX_ARP_NOTES = 16;
const VOICE_PAN_POSITIONS = [-0.72, -0.24, 0.24, 0.72] as const;

const CHORD_ARP_MORPH_PARAM: ParameterSchema = {
  id: 'chordArpMorph',
  label: 'Akkord ↔ Arpeggio',
  description: 'Blendet stufenlos vom stehenden Flächen-Akkord zum rhythmischen Arpeggio.',
  domain: 'harmony',
  min: 0,
  max: 1,
  defaultValue: 0.22,
  curve: 'linear',
  modulatable: true,
};

const ARP_SPEED_PARAM: ParameterSchema = {
  id: 'arpSpeed',
  label: 'Arpeggio-Tempo',
  description: 'Geschwindigkeit der einzelnen Tonfolgen innerhalb eines Zyklus.',
  domain: 'time',
  min: 1,
  max: 8,
  defaultValue: 2,
  curve: 'linear',
  modulatable: true,
};

const ARP_PATTERN_PARAM: ParameterSchema = {
  id: 'arpPattern',
  label: 'Arpeggio-Muster',
  description: 'Reihenfolge, in der die Akkordtöne gespielt werden.',
  domain: 'harmony',
  min: 0,
  max: 3,
  step: 1,
  defaultValue: 0,
  curve: 'linear',
  modulatable: false,
  options: [
    { value: 0, label: 'Aufwärts' },
    { value: 1, label: 'Abwärts' },
    { value: 2, label: 'Pendel' },
    { value: 3, label: 'Wellen-Sprung' },
  ],
};

const OCTAVE_SPREAD_PARAM: ParameterSchema = {
  id: 'octaveSpread',
  label: 'Oktav-Weite',
  description: 'Wie weit sich die Töne nach oben über mehrere Oktaven öffnen.',
  domain: 'harmony',
  min: 1,
  max: 3,
  defaultValue: 1.5,
  curve: 'linear',
  modulatable: true,
};

const TIMBRE_SHAPE_PARAM: ParameterSchema = {
  id: 'timbreShape',
  label: 'Klang-Fülle',
  description: 'Von weichem, warmem Pad bis zu hellem, obertonreichem Synthesizer-Klang.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.35,
  curve: 'linear',
  modulatable: true,
};

const DETUNE_SHIMMER_PARAM: ParameterSchema = {
  id: 'detuneShimmer',
  label: 'Breite & Schwebung',
  description: 'Verstimmt die Stimmen leicht gegeneinander für einen breiten Stereo-Klang.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.35,
  curve: 'linear',
  modulatable: true,
};

const SOFTNESS_PARAM: ParameterSchema = {
  id: 'softness',
  label: 'Weichheit',
  description: 'Sanfteres Ein- und Ausschwingen der Töne ohne harte Kanten.',
  domain: 'timbre',
  min: 0.005,
  max: 0.8,
  defaultValue: 0.14,
  curve: 'linear',
  modulatable: true,
  unitLabel: 's',
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

function selectPatternIndex(pattern: number, step: number, noteCount: number): number {
  if (noteCount <= 1) return 0;
  const s = ((step % Math.max(1, noteCount * 2)) + noteCount * 2) % (noteCount * 2);

  switch (pattern) {
    case 1: // Abwärts
      return noteCount - 1 - (step % noteCount);
    case 2: {
      // Pendel
      const period = Math.max(1, noteCount * 2 - 2);
      const pos = step % period;
      return pos < noteCount ? pos : period - pos;
    }
    case 3: {
      // Wellen-Sprung
      const jump = (s * 2 + (s >= noteCount ? 1 : 0)) % noteCount;
      return jump;
    }
    case 0:
    default:
      return step % noteCount;
  }
}

export class ChordArpVoice implements VoiceInstance {
  private readonly sampleRate: number;
  private readonly oscA: PolyBlepOscillator[] = [];
  private readonly oscB: PolyBlepOscillator[] = [];
  private readonly filters: ZdfSvfFilter[] = [];
  private readonly voiceFreq: OnePoleSmoother[] = [];
  private readonly voiceTargetMidi = new Float64Array(NUM_VOICES);
  private readonly voiceCachedMidi = new Float64Array(NUM_VOICES);
  private readonly voiceTargetHz = new Float64Array(NUM_VOICES);
  private readonly voiceEnvCurrent = new Float64Array(NUM_VOICES);
  private readonly voiceArpGate = new Float64Array(NUM_VOICES);
  private readonly voicePanCos = new Float64Array(NUM_VOICES);
  private readonly voicePanSin = new Float64Array(NUM_VOICES);
  private readonly arpNotesBuf = new Float64Array(MAX_ARP_NOTES);
  private readonly voiceBuf0 = new Float32Array(8);
  private readonly voiceBuf1 = new Float32Array(8);
  private readonly voiceBuf2 = new Float32Array(8);
  private readonly voiceBuf3 = new Float32Array(8);

  private readonly timbreSmoother: OnePoleSmoother;
  private readonly detuneSmoother: OnePoleSmoother;
  private readonly morphSmoother: OnePoleSmoother;
  private readonly dcCoeff: number;
  private dcX1L = 0;
  private dcY1L = 0;
  private dcX1R = 0;
  private dcY1R = 0;

  private lastArpStep = -1;
  private roundRobinIdx = 0;
  private lastEnvMs = -1;
  private voiceEnvCoeff = 0.999;
  private lastSpreadAmount = -1;

  constructor(sampleRate: number) {
    this.sampleRate = sanitizeSampleRate(sampleRate);

    for (let v = 0; v < NUM_VOICES; v++) {
      const a = new PolyBlepOscillator(this.sampleRate);
      a.setWaveform('saw');
      a.reset((v * 0.17) % 1);
      this.oscA.push(a);

      const b = new PolyBlepOscillator(this.sampleRate);
      b.setWaveform('saw');
      b.reset((v * 0.31 + 0.5) % 1);
      this.oscB.push(b);

      this.filters.push(new ZdfSvfFilter(this.sampleRate, 1400, 0.8, 0));
      this.voiceFreq.push(new OnePoleSmoother(this.sampleRate, 14, 220));
      this.voiceTargetMidi[v] = 60;
      this.voiceCachedMidi[v] = Number.NaN;
      this.voiceTargetHz[v] = 220;
      this.voiceEnvCurrent[v] = 0;
      this.voiceArpGate[v] = 0;
    }

    this.voiceEnvCoeff = Math.exp(-1 / (0.14 * this.sampleRate));
    this.timbreSmoother = new OnePoleSmoother(this.sampleRate, 12, TIMBRE_SHAPE_PARAM.defaultValue);
    this.detuneSmoother = new OnePoleSmoother(this.sampleRate, 12, DETUNE_SHIMMER_PARAM.defaultValue);
    this.morphSmoother = new OnePoleSmoother(this.sampleRate, 15, CHORD_ARP_MORPH_PARAM.defaultValue);
    const dcW0 = (TWO_PI * 18) / this.sampleRate;
    this.dcCoeff = Math.max(0.9, Math.min(0.99999, 1 - dcW0));
  }

  public reset(): void {
    for (let v = 0; v < NUM_VOICES; v++) {
      this.oscA[v]!.reset((v * 0.17) % 1);
      this.oscB[v]!.reset((v * 0.31 + 0.5) % 1);
      this.filters[v]!.reset();
      this.voiceFreq[v]!.reset(220);
      this.voiceTargetMidi[v] = 60;
      this.voiceCachedMidi[v] = Number.NaN;
      this.voiceTargetHz[v] = 220;
      this.voiceEnvCurrent[v] = 0;
      this.voiceArpGate[v] = 0;
    }
    this.timbreSmoother.reset(TIMBRE_SHAPE_PARAM.defaultValue);
    this.detuneSmoother.reset(DETUNE_SHIMMER_PARAM.defaultValue);
    this.morphSmoother.reset(CHORD_ARP_MORPH_PARAM.defaultValue);
    this.dcX1L = 0;
    this.dcY1L = 0;
    this.dcX1R = 0;
    this.dcY1R = 0;
    this.lastArpStep = -1;
    this.roundRobinIdx = 0;
    this.lastEnvMs = -1;
    this.voiceEnvCoeff = Math.exp(-1 / (0.14 * this.sampleRate));
    this.lastSpreadAmount = -1;
  }

  public process(
    outL: Float32Array,
    outR: Float32Array,
    params: Record<string, number>,
    ctx: VoiceRenderContext,
  ): void {
    const count = Math.min(ctx.numSamples | 0, outL.length, outR.length);
    if (count <= 0) return;

    const targetMorph = readParam(CHORD_ARP_MORPH_PARAM, params);
    const arpSpeed = readParam(ARP_SPEED_PARAM, params);
    const arpPattern = Math.round(readParam(ARP_PATTERN_PARAM, params));
    const octaveSpread = readParam(OCTAVE_SPREAD_PARAM, params);
    const targetTimbre = readParam(TIMBRE_SHAPE_PARAM, params);
    const targetDetune = readParam(DETUNE_SHIMMER_PARAM, params);
    const softness = readParam(SOFTNESS_PARAM, params);

    const rootMidi = Number.isFinite(ctx.harmony.rootMidi) ? ctx.harmony.rootMidi : 36;
    const chordSrc = ctx.harmony.chordNotesMidi;
    const baseChordLen = chordSrc.length > 0 ? chordSrc.length : 3;

    // Populate preallocated arpNotesBuf without heap allocation.
    const octaves = Math.max(1, Math.min(3, Math.ceil(octaveSpread)));
    let arpCount = 0;
    for (let oct = 0; oct < octaves && arpCount < MAX_ARP_NOTES; oct++) {
      for (let c = 0; c < baseChordLen && arpCount < MAX_ARP_NOTES; c++) {
        const baseNote =
          chordSrc.length > 0
            ? chordSrc[c]!
            : rootMidi + 12 + (c === 0 ? 0 : c === 1 ? 3 : 7);
        this.arpNotesBuf[arpCount++] = baseNote + oct * 12;
      }
    }
    if (arpCount === 0) {
      this.arpNotesBuf[0] = rootMidi + 12;
      arpCount = 1;
    }

    const pulseEnergy = Number.isFinite(ctx.timeFrame.pulseEnergy)
      ? clamp(ctx.timeFrame.pulseEnergy, 0, 1)
      : 0;
    const warpedPhase = wrapPhase01(ctx.timeFrame.warpedPhase);

    const envMs = clamp(softness * 1000, 5, 800);
    if (Math.abs(envMs - this.lastEnvMs) > 0.1) {
      this.lastEnvMs = envMs;
      this.voiceEnvCoeff = Math.exp(-1 / (envMs * 0.001 * this.sampleRate));
    }

    // Determine active arp step and smooth step gate
    const totalArpSteps = Math.max(1, Math.round(arpSpeed * Math.max(2, baseChordLen)));
    const arpCyclePos = wrapPhase01(warpedPhase * arpSpeed);
    const currentArpStep = Math.floor(arpCyclePos * Math.max(2, baseChordLen));
    const stepFrac = arpCyclePos * Math.max(2, baseChordLen) - currentArpStep;

    if (targetMorph <= 0.02) {
      // Pure chord mode: all 4 voices play the chord notes together
      for (let v = 0; v < NUM_VOICES; v++) {
        const chordMidi =
          chordSrc.length > 0
            ? chordSrc[v % chordSrc.length]! + (v >= chordSrc.length ? 12 : 0)
            : rootMidi + 12 + (v === 0 ? 0 : v === 1 ? 3 : v === 2 ? 7 : 12);
        this.voiceTargetMidi[v] = chordMidi;
        this.voiceArpGate[v] = 0.38 + 0.62 * pulseEnergy;
      }
      this.lastArpStep = currentArpStep;
    } else {
      if (currentArpStep !== this.lastArpStep) {
        this.lastArpStep = currentArpStep;
        this.roundRobinIdx = (this.roundRobinIdx + 1) % NUM_VOICES;

        const absStep =
          Math.max(0, ctx.timeFrame.stepIndex) + currentArpStep + totalArpSteps * 0;
        const noteIdx = selectPatternIndex(arpPattern, absStep, arpCount);
        const pickedMidi = this.arpNotesBuf[noteIdx] ?? rootMidi + 12;
        this.voiceTargetMidi[this.roundRobinIdx] = pickedMidi;
      }

      const activeGate =
        Math.exp(-stepFrac * (1.0 + (1 - clamp(softness / 0.8, 0, 1)) * 3.8)) *
        (0.45 + 0.55 * pulseEnergy);
      const chordPadGate = 0.38 + 0.62 * pulseEnergy;

      for (let v = 0; v < NUM_VOICES; v++) {
        if (v === this.roundRobinIdx) {
          this.voiceArpGate[v] =
            (1 - targetMorph) * chordPadGate + targetMorph * activeGate;
        } else {
          // Non-active voices sustain gently in chord mode and decay smoothly in arp mode
          const decayTail =
            (1 - targetMorph) * chordPadGate + targetMorph * 0.14 * pulseEnergy;
          this.voiceArpGate[v] = decayTail;
          if (targetMorph < 0.35) {
            const chordMidi =
              chordSrc.length > 0
                ? chordSrc[v % chordSrc.length]! + (v >= chordSrc.length ? 12 : 0)
                : rootMidi + 12 + (v === 0 ? 0 : v === 1 ? 3 : v === 2 ? 7 : 12);
            this.voiceTargetMidi[v] = chordMidi;
          }
        }
      }
    }

    const maxVoiceHz = this.sampleRate * 0.35;
    const maxFilterHz = this.sampleRate * 0.42;
    const maxOscHz = this.sampleRate * 0.44;
    for (let v = 0; v < NUM_VOICES; v++) {
      const m = this.voiceTargetMidi[v] ?? 60;
      if (m !== this.voiceCachedMidi[v]) {
        this.voiceCachedMidi[v] = m;
        this.voiceTargetHz[v] = clamp(midiToFreq(m), 32, maxVoiceHz);
      }
    }

    for (let start = 0; start < count; start += 8) {
      const end = Math.min(start + 8, count);
      const subLen = end - start;

      let timbre = targetTimbre;
      if (this.timbreSmoother.current !== timbre) {
        for (let k = 0; k < subLen; k++) {
          timbre = this.timbreSmoother.process(targetTimbre);
        }
        if (Math.abs(timbre - targetTimbre) < 1e-6) {
          timbre = targetTimbre;
          this.timbreSmoother.reset(targetTimbre);
        }
      }
      let detune = targetDetune;
      if (this.detuneSmoother.current !== detune) {
        for (let k = 0; k < subLen; k++) {
          detune = this.detuneSmoother.process(targetDetune);
        }
        if (Math.abs(detune - targetDetune) < 1e-6) {
          detune = targetDetune;
          this.detuneSmoother.reset(targetDetune);
        }
      }
      let morph = targetMorph;
      if (this.morphSmoother.current !== morph) {
        for (let k = 0; k < subLen; k++) {
          morph = this.morphSmoother.process(targetMorph);
        }
        if (Math.abs(morph - targetMorph) < 1e-6) {
          morph = targetMorph;
          this.morphSmoother.reset(targetMorph);
        }
      }

      const detuneRatio = 0.0012 + detune * 0.011;
      const spreadAmount = 0.15 + detune * 0.72;
      if (Math.abs(spreadAmount - this.lastSpreadAmount) > 1e-6) {
        this.lastSpreadAmount = spreadAmount;
        for (let v = 0; v < NUM_VOICES; v++) {
          const pan = (VOICE_PAN_POSITIONS[v] ?? 0) * spreadAmount;
          const angle = (pan + 1) * 0.25 * Math.PI;
          this.voicePanCos[v] = Math.cos(angle);
          this.voicePanSin[v] = Math.sin(angle);
        }
      }

      const filterBaseCutoff = 320 + timbre * timbre * 5200 + morph * 450;
      const filterEnvRange = 900 + timbre * 2400;
      const filterQ = 0.72 + timbre * 0.45;

      for (let v = 0; v < NUM_VOICES; v++) {
        const targetHz = this.voiceTargetHz[v]!;
        const freqSmoother = this.voiceFreq[v]!;
        let hz = targetHz;
        if (freqSmoother.current !== targetHz) {
          for (let k = 0; k < subLen; k++) {
            hz = freqSmoother.process(targetHz);
          }
          if (Math.abs(hz - targetHz) < 1e-4) {
            hz = targetHz;
            freqSmoother.reset(targetHz);
          }
        }

        this.oscA[v]!.setFreq(hz * (1 - detuneRatio));
        this.oscB[v]!.setFreq(Math.min(hz * (1 + detuneRatio), maxOscHz));

        const envApprox = this.voiceEnvCurrent[v]!;
        const cutoffHz = clamp(
          filterBaseCutoff + envApprox * filterEnvRange,
          120,
          maxFilterHz,
        );
        this.filters[v]!.setParams(cutoffHz, filterQ, 0);
      }

      const envCoeff = this.voiceEnvCoeff;
      const g0 = this.voiceArpGate[0]!;
      const g1 = this.voiceArpGate[1]!;
      const g2 = this.voiceArpGate[2]!;
      const g3 = this.voiceArpGate[3]!;
      let e0 = this.voiceEnvCurrent[0]!;
      let e1 = this.voiceEnvCurrent[1]!;
      let e2 = this.voiceEnvCurrent[2]!;
      let e3 = this.voiceEnvCurrent[3]!;
      const oscA0 = this.oscA[0]!;
      const oscB0 = this.oscB[0]!;
      const flt0 = this.filters[0]!;
      const cos0 = this.voicePanCos[0]!;
      const sin0 = this.voicePanSin[0]!;
      const oscA1 = this.oscA[1]!;
      const oscB1 = this.oscB[1]!;
      const flt1 = this.filters[1]!;
      const cos1 = this.voicePanCos[1]!;
      const sin1 = this.voicePanSin[1]!;
      const oscA2 = this.oscA[2]!;
      const oscB2 = this.oscB[2]!;
      const flt2 = this.filters[2]!;
      const cos2 = this.voicePanCos[2]!;
      const sin2 = this.voicePanSin[2]!;
      const oscA3 = this.oscA[3]!;
      const oscB3 = this.oscB[3]!;
      const flt3 = this.filters[3]!;
      const cos3 = this.voicePanCos[3]!;
      const sin3 = this.voicePanSin[3]!;
      const b0 = this.voiceBuf0;
      const b1 = this.voiceBuf1;
      const b2 = this.voiceBuf2;
      const b3 = this.voiceBuf3;
      for (let k = 0; k < subLen; k++) {
        b0[k] = 0.5 * (oscA0.processSample() + oscB0.processSample());
        b1[k] = 0.5 * (oscA1.processSample() + oscB1.processSample());
        b2[k] = 0.5 * (oscA2.processSample() + oscB2.processSample());
        b3[k] = 0.5 * (oscA3.processSample() + oscB3.processSample());
      }
      flt0.processBlock(b0, 0, subLen);
      flt1.processBlock(b1, 0, subLen);
      flt2.processBlock(b2, 0, subLen);
      flt3.processBlock(b3, 0, subLen);

      const dcCoeff = this.dcCoeff;
      let dcX1L = this.dcX1L;
      let dcY1L = this.dcY1L;
      let dcX1R = this.dcX1R;
      let dcY1R = this.dcY1R;

      for (let k = 0; k < subLen; k++) {
        const i = start + k;
        e0 = g0 + envCoeff * (e0 - g0);
        if (e0 > -1e-20 && e0 < 1e-20) e0 = 0;
        const s0 = b0[k]! * e0 * 0.36;

        e1 = g1 + envCoeff * (e1 - g1);
        if (e1 > -1e-20 && e1 < 1e-20) e1 = 0;
        const s1 = b1[k]! * e1 * 0.36;

        e2 = g2 + envCoeff * (e2 - g2);
        if (e2 > -1e-20 && e2 < 1e-20) e2 = 0;
        const s2 = b2[k]! * e2 * 0.36;

        e3 = g3 + envCoeff * (e3 - g3);
        if (e3 > -1e-20 && e3 < 1e-20) e3 = 0;
        const s3 = b3[k]! * e3 * 0.36;

        const sumL = s0 * cos0 + s1 * cos1 + s2 * cos2 + s3 * cos3;
        const sumR = s0 * sin0 + s1 * sin1 + s2 * sin2 + s3 * sin3;

        const inL = fastTanh(sumL * 0.9);
        const inR = fastTanh(sumR * 0.9);
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
      }

      this.voiceEnvCurrent[0] = e0;
      this.voiceEnvCurrent[1] = e1;
      this.voiceEnvCurrent[2] = e2;
      this.voiceEnvCurrent[3] = e3;
      this.dcX1L = dcX1L;
      this.dcY1L = dcY1L;
      this.dcX1R = dcX1R;
      this.dcY1R = dcY1R;
    }
  }
}

export const chordArpVoiceModule: VoiceModule = {
  id: 'chord-arp',
  version: 1,
  category: 'harmony',
  displayName: 'Akkord & Arpeggio',
  description: 'Vierstimmiger Synth für schwebende Akkordflächen und hypnotische Arpeggios.',
  parameters: [
    CHORD_ARP_MORPH_PARAM,
    ARP_SPEED_PARAM,
    ARP_PATTERN_PARAM,
    OCTAVE_SPREAD_PARAM,
    TIMBRE_SHAPE_PARAM,
    DETUNE_SHIMMER_PARAM,
    SOFTNESS_PARAM,
  ],
  createInstance(sampleRate: number): VoiceInstance {
    return new ChordArpVoice(sampleRate);
  },
};
