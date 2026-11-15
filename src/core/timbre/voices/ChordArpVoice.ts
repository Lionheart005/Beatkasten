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

const NUM_VOICES = 6;
const MAX_ARP_NOTES = 16;
const VOICE_PAN_POSITIONS = [-0.72, -0.24, 0.24, 0.72, -0.5, 0.5] as const;

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
  description:
    'Wie oft die Tonfolge pro Zyklus durchläuft (nur bei Arp-Raster „Frei“). Folgt Zeit-Beschleunigungen.',
  domain: 'time',
  min: 1,
  max: 32,
  defaultValue: 2,
  curve: 'linear',
  modulatable: true,
};

const ARP_GRID_PARAM: ParameterSchema = {
  id: 'arpGrid',
  label: 'Arp-Raster',
  description:
    'Frei = Tempo relativ zum Zyklus (mit Beschleunigung). Sonst feste Notenwerte im Takt – bis 1/64 für sehr schnelle Arpeggios.',
  domain: 'time',
  min: 0,
  max: 7,
  step: 1,
  defaultValue: 0,
  curve: 'linear',
  modulatable: false,
  options: [
    { value: 0, label: 'Frei (Zyklus)' },
    { value: 1, label: '1/4' },
    { value: 2, label: '1/8' },
    { value: 3, label: '1/8 Triole' },
    { value: 4, label: '1/16' },
    { value: 5, label: '1/16 Triole' },
    { value: 6, label: '1/32' },
    { value: 7, label: '1/64' },
  ],
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

const DRONE_HOLD_PARAM: ParameterSchema = {
  id: 'droneHold',
  label: 'Dauerton (Durchgehend)',
  description:
    '0 = folgt der Puls-Welle dynamisch, 1 = hält den Akkord/Pegel durchgehend ohne Wellen-Auf-und-Ab.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0,
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

const ARP_GRID_NOTES_PER_BEAT = [0, 1, 2, 3, 4, 6, 8, 16] as const;

function smoothstep01(x: number): number {
  const t = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

export class ChordArpVoice implements VoiceInstance {
  private readonly sampleRate: number;
  private readonly oscA: PolyBlepOscillator[] = [];
  private readonly oscB: PolyBlepOscillator[] = [];
  private readonly filters: ZdfSvfFilter[] = [];
  private readonly voiceFreq: OnePoleSmoother[] = [];
  private readonly voiceBufs: Float32Array[] = [];
  private readonly voiceTargetMidi = new Float64Array(NUM_VOICES);
  private readonly voiceCachedMidi = new Float64Array(NUM_VOICES);
  private readonly voiceTargetHz = new Float64Array(NUM_VOICES);
  private readonly voiceEnvCurrent = new Float64Array(NUM_VOICES);
  private readonly voiceArpGate = new Float64Array(NUM_VOICES);
  private readonly voicePanCos = new Float64Array(NUM_VOICES);
  private readonly voicePanSin = new Float64Array(NUM_VOICES);
  private readonly voiceSnapFreq = new Uint8Array(NUM_VOICES);
  private readonly arpNotesBuf = new Float64Array(MAX_ARP_NOTES);

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
  private samplesSinceArpStep = 0;
  private lastArpStepSamples = 1e9;

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
      this.voiceBufs.push(new Float32Array(8));
      this.voiceTargetMidi[v] = 60;
      this.voiceCachedMidi[v] = Number.NaN;
      this.voiceTargetHz[v] = 220;
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
      this.voiceSnapFreq[v] = 0;
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
    this.samplesSinceArpStep = 0;
    this.lastArpStepSamples = 1e9;
  }

  /** Chord note for voice `v` (octave-doubled when the chord has fewer notes). */
  private static chordVoiceMidi(
    v: number,
    src: readonly number[],
    rootMidi: number,
  ): number {
    const len = src.length;
    if (len === 0) {
      return rootMidi + 12 + (v === 0 ? 0 : v === 1 ? 3 : v === 2 ? 7 : 12) + 12 * Math.floor(v / 4);
    }
    return src[v % len]! + 12 * Math.floor(v / len);
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
    const arpGrid = Math.round(readParam(ARP_GRID_PARAM, params));
    const arpPattern = Math.round(readParam(ARP_PATTERN_PARAM, params));
    const octaveSpread = readParam(OCTAVE_SPREAD_PARAM, params);
    const targetTimbre = readParam(TIMBRE_SHAPE_PARAM, params);
    const targetDetune = readParam(DETUNE_SHIMMER_PARAM, params);
    const softness = readParam(SOFTNESS_PARAM, params);
    const droneHold = readParam(DRONE_HOLD_PARAM, params);

    const harmony = ctx.harmony;
    const rootMidi = Number.isFinite(harmony.rootMidi) ? harmony.rootMidi : 36;
    const chordSrc = harmony.chordNotesMidi;
    const nextSrc =
      harmony.nextChordNotesMidi && harmony.nextChordNotesMidi.length > 0
        ? harmony.nextChordNotesMidi
        : chordSrc;
    const transitionType = harmony.transitionType ?? 'cut';
    const transitionProgress =
      transitionType === 'cut' ? 0 : clamp(harmony.transitionProgress ?? 0, 0, 1);
    const baseChordLen = chordSrc.length > 0 ? chordSrc.length : 3;
    // Triads use 4 voices (root doubled an octave up) as before; 5-6 note chords use all.
    const activeVoices = Math.min(NUM_VOICES, Math.max(4, baseChordLen));
    const voiceGain = 0.36 * Math.sqrt(4 / activeVoices);

    // Arp notes: in the second half of a soft transition the arp anticipates the next chord.
    const arpSrc = transitionProgress > 0.5 ? nextSrc : chordSrc;
    const arpLen = arpSrc.length;
    const octaves = Math.max(1, Math.min(3, Math.ceil(octaveSpread)));
    let arpCount = 0;
    for (let oct = 0; oct < octaves && arpCount < MAX_ARP_NOTES; oct++) {
      for (let c = 0; c < Math.max(1, arpLen) && arpCount < MAX_ARP_NOTES; c++) {
        const baseNote =
          arpLen > 0 ? arpSrc[c]! : rootMidi + 12 + (c === 0 ? 0 : c === 1 ? 3 : 7);
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
    const shapedPulse = pulseEnergy * (0.35 + 0.65 * pulseEnergy);
    const effectivePulse = shapedPulse + droneHold * (1 - shapedPulse);
    const warpedPhase = wrapPhase01(ctx.timeFrame.warpedPhase);

    const envMs = clamp(softness * 450, 4, 400);
    if (Math.abs(envMs - this.lastEnvMs) > 0.1) {
      this.lastEnvMs = envMs;
      this.voiceEnvCoeff = Math.exp(-1 / (envMs * 0.001 * this.sampleRate));
    }

    // Arp step position: free (cycle-relative, follows time warping) or beat grid.
    const notesPerBeat = ARP_GRID_NOTES_PER_BEAT[arpGrid] ?? 0;
    let currentArpStep: number;
    let stepFrac: number;
    let absStep: number;
    if (notesPerBeat > 0) {
      const beat = Number.isFinite(ctx.beatPosition) ? Math.max(0, ctx.beatPosition) : 0;
      const pos = beat * notesPerBeat;
      currentArpStep = Math.floor(pos);
      stepFrac = pos - currentArpStep;
      absStep = currentArpStep;
    } else {
      const divisions = Math.max(2, baseChordLen);
      const arpCyclePos = wrapPhase01(warpedPhase * arpSpeed);
      currentArpStep = Math.floor(arpCyclePos * divisions);
      stepFrac = arpCyclePos * divisions - currentArpStep;
      absStep = Math.max(0, ctx.timeFrame.stepIndex) + currentArpStep;
    }

    // Transition shaping per voice.
    const glideT = transitionType === 'glide' ? smoothstep01(transitionProgress) : 0;
    const fadeT = transitionType === 'crossfade' ? transitionProgress : 0;

    this.samplesSinceArpStep += count;

    if (targetMorph <= 0.02) {
      // Pure chord mode
      for (let v = 0; v < NUM_VOICES; v++) {
        if (v >= activeVoices) {
          this.voiceArpGate[v] = 0;
          continue;
        }
        const cur = ChordArpVoice.chordVoiceMidi(v, chordSrc, rootMidi);
        const nxt = ChordArpVoice.chordVoiceMidi(v, nextSrc, rootMidi);
        this.voiceTargetMidi[v] = cur + (nxt - cur) * glideT;
        const changing = nxt !== cur;
        this.voiceArpGate[v] = effectivePulse * (changing ? 1 - fadeT : 1);
      }
      this.lastArpStep = currentArpStep;
    } else {
      if (currentArpStep !== this.lastArpStep) {
        this.lastArpStep = currentArpStep;
        this.lastArpStepSamples = this.samplesSinceArpStep;
        this.samplesSinceArpStep = 0;
        this.roundRobinIdx = (this.roundRobinIdx + 1) % NUM_VOICES;

        const noteIdx = selectPatternIndex(arpPattern, absStep, arpCount);
        const pickedMidi = this.arpNotesBuf[noteIdx] ?? rootMidi + 12;
        this.voiceTargetMidi[this.roundRobinIdx] = pickedMidi;
        // Fast arps: jump straight to the pitch instead of a 14 ms slide.
        this.voiceSnapFreq[this.roundRobinIdx] =
          this.lastArpStepSamples < this.sampleRate * 0.09 ? 1 : 0;
      }

      const activeGate =
        Math.exp(-stepFrac * (1.0 + (1 - clamp(softness / 0.8, 0, 1)) * 3.8)) *
        effectivePulse;
      const chordPadGate = effectivePulse;

      for (let v = 0; v < NUM_VOICES; v++) {
        const padWeight = v < activeVoices ? 1 : 0;
        if (v === this.roundRobinIdx) {
          this.voiceArpGate[v] =
            (1 - targetMorph) * chordPadGate * padWeight + targetMorph * activeGate;
        } else {
          // Non-active voices sustain gently in chord mode and decay smoothly in arp mode
          const cur = ChordArpVoice.chordVoiceMidi(v, chordSrc, rootMidi);
          const nxt = ChordArpVoice.chordVoiceMidi(v, nextSrc, rootMidi);
          const fade = nxt !== cur ? 1 - fadeT : 1;
          this.voiceArpGate[v] =
            ((1 - targetMorph) * chordPadGate * padWeight +
              targetMorph * 0.14 * effectivePulse) *
            fade;
          if (targetMorph < 0.35) {
            this.voiceTargetMidi[v] = cur + (nxt - cur) * glideT;
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
        if (this.voiceSnapFreq[v] === 1) {
          this.voiceFreq[v]!.reset(this.voiceTargetHz[v]!);
          this.voiceSnapFreq[v] = 0;
        }
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
      const envCoeff = this.voiceEnvCoeff;

      for (let k = 0; k < subLen; k++) {
        outL[start + k] = 0;
        outR[start + k] = 0;
      }

      for (let v = 0; v < NUM_VOICES; v++) {
        const gate = this.voiceArpGate[v]!;
        let env = this.voiceEnvCurrent[v]!;
        // Skip silent voices entirely (saves CPU for triads / pure chords).
        if (gate === 0 && env < 1e-5) {
          this.voiceEnvCurrent[v] = 0;
          continue;
        }

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

        const oscA = this.oscA[v]!;
        const oscB = this.oscB[v]!;
        oscA.setFreq(hz * (1 - detuneRatio));
        oscB.setFreq(Math.min(hz * (1 + detuneRatio), maxOscHz));
        const flt = this.filters[v]!;
        flt.setParams(clamp(filterBaseCutoff + env * filterEnvRange, 120, maxFilterHz), filterQ, 0);

        const buf = this.voiceBufs[v]!;
        for (let k = 0; k < subLen; k++) {
          buf[k] = 0.5 * (oscA.processSample() + oscB.processSample());
        }
        flt.processBlock(buf, 0, subLen);

        const cosG = this.voicePanCos[v]! * voiceGain;
        const sinG = this.voicePanSin[v]! * voiceGain;
        for (let k = 0; k < subLen; k++) {
          env = gate + envCoeff * (env - gate);
          if (env > -1e-20 && env < 1e-20) env = 0;
          const sv = buf[k]! * env;
          outL[start + k]! += sv * cosG;
          outR[start + k]! += sv * sinG;
        }
        this.voiceEnvCurrent[v] = env;
      }

      const dcCoeff = this.dcCoeff;
      let dcX1L = this.dcX1L;
      let dcY1L = this.dcY1L;
      let dcX1R = this.dcX1R;
      let dcY1R = this.dcY1R;
      for (let k = 0; k < subLen; k++) {
        const i = start + k;
        const inL = fastTanh(outL[i]! * 0.9);
        const inR = fastTanh(outR[i]! * 0.9);
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
  description: 'Bis zu sechsstimmiger Synth für schwebende Akkordflächen (inkl. 9/11/13) und hypnotische Arpeggios.',
  parameters: [
    CHORD_ARP_MORPH_PARAM,
    ARP_SPEED_PARAM,
    ARP_GRID_PARAM,
    ARP_PATTERN_PARAM,
    OCTAVE_SPREAD_PARAM,
    TIMBRE_SHAPE_PARAM,
    DETUNE_SHIMMER_PARAM,
    SOFTNESS_PARAM,
    DRONE_HOLD_PARAM,
  ],
  createInstance(sampleRate: number): VoiceInstance {
    return new ChordArpVoice(sampleRate);
  },
};
