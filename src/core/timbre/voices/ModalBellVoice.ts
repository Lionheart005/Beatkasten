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

const TWO_PI = Math.PI * 2;
const NUM_SLOTS = 6;
const NUM_PARTIALS = 4;
const SCALE_BUF_CAP = 24;

// Modal partial frequency ratios: woody (marimba) -> glassy (vibraphone) -> crystalline bell
const WOODY_RATIOS = new Float64Array([1.0, 2.0, 3.98, 5.95]);
const GLASSY_RATIOS = new Float64Array([1.0, 2.756, 5.404, 8.93]);
const BELL_RATIOS = new Float64Array([1.0, 2.0, 2.756, 4.07]);

// Alternating stereo pan positions across slots in [-0.35..+0.35]
const SLOT_PAN_POSITIONS = new Float64Array([-0.35, 0.35, -0.24, 0.24, -0.14, 0.14]);
const SPRUNG_DEGREES = new Int32Array([0, 4, 2, 5, 1, 6, 3, 4]);
const DUET_DEGREES = new Int32Array([0, 2, 4, 2, 0, 3, 4, 1]);

function fastTanh(x: number): number {
  if (x <= -3) return -1;
  if (x >= 3) return 1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

const MATERIAL_PARAM: ParameterSchema = {
  id: 'material',
  label: 'Material (Holz ↔ Metall)',
  description:
    'Blendet den Klangkörper stufenlos von warmer Holz-Marimba über Glas bis zum klaren Metall-Glockenspiel.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.68,
  curve: 'linear',
  modulatable: true,
};

const MALLET_HARDNESS_PARAM: ParameterSchema = {
  id: 'malletHardness',
  label: 'Anschlag-Hammer',
  description:
    'Bestimmt Härte, Transienten-Klick und Oberton-Anregung des Schlägels am Tonbeginn.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.55,
  curve: 'linear',
  modulatable: true,
};

const DECAY_PARAM: ParameterSchema = {
  id: 'decay',
  label: 'Ausklang',
  description: 'Bestimmt die Nachklingdauer der schwingenden Glocke oder Klangplatte.',
  domain: 'timbre',
  min: 0.08,
  max: 2.6,
  defaultValue: 0.85,
  curve: 'exp',
  modulatable: true,
  unitLabel: 's',
};

const SHIMMER_PARAM: ParameterSchema = {
  id: 'shimmer',
  label: 'Glocken-Schimmer',
  description:
    'Fügt feine L/R-Verstimmung und wechselnde Stereo-Verteilung zwischen aufeinanderfolgenden Tönen hinzu.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.3,
  curve: 'linear',
  modulatable: true,
};

const OCTAVE_SHIFT_PARAM: ParameterSchema = {
  id: 'octaveShift',
  label: 'Oktavlage',
  description: 'Verschiebt den Tonbereich der Oberstimme um ganze Oktaven.',
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
  label: 'Oberstimmen-Muster',
  description:
    '0=Einzelton, 1=Pendel 1–5, 2=Skala aufwärts, 3=Sprung-Rätsel, 4=Quinte/Terz-Duett',
  domain: 'harmony',
  min: 0,
  max: 4,
  step: 1,
  defaultValue: 2,
  curve: 'linear',
  modulatable: false,
  options: [
    { value: 0, label: 'Einzelton' },
    { value: 1, label: 'Pendel 1–5' },
    { value: 2, label: 'Skala aufwärts' },
    { value: 3, label: 'Sprung-Rätsel' },
    { value: 4, label: 'Quinte/Terz-Duett' },
  ],
};

const MELODY_RANGE_PARAM: ParameterSchema = {
  id: 'melodyRange',
  label: 'Ton-Bewegung',
  description: 'Steuert die Spannweite und Abwechslung der gespielten Skalen-Stufen.',
  domain: 'harmony',
  min: 0,
  max: 1,
  defaultValue: 0.45,
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

export class ModalBellVoice implements VoiceInstance {
  private readonly sampleRate: number;
  private readonly dcBlocker: StereoDCBlocker;
  private readonly noiseL: WhiteNoiseGenerator;
  private readonly noiseR: WhiteNoiseGenerator;
  private readonly malletFilterL: ZdfSvfFilter;
  private readonly malletFilterR: ZdfSvfFilter;

  private readonly materialSmoother: OnePoleSmoother;
  private readonly hardnessSmoother: OnePoleSmoother;
  private readonly shimmerSmoother: OnePoleSmoother;

  // Per-slot polyphonic modal resonator state (zero heap allocation)
  private readonly slotActive = new Uint8Array(NUM_SLOTS);
  private readonly slotBaseHz = new Float64Array(NUM_SLOTS);
  private readonly slotAttack = new Float64Array(NUM_SLOTS);
  private readonly slotPanCos = new Float64Array(NUM_SLOTS);
  private readonly slotPanSin = new Float64Array(NUM_SLOTS);
  private readonly slotChirpPhase = new Float64Array(NUM_SLOTS);
  private readonly slotChirpEnv = new Float64Array(NUM_SLOTS);

  // Flattened [slot * NUM_PARTIALS + partial] arrays
  private readonly partialPhaseL = new Float64Array(NUM_SLOTS * NUM_PARTIALS);
  private readonly partialPhaseR = new Float64Array(NUM_SLOTS * NUM_PARTIALS);
  private readonly partialEnv = new Float64Array(NUM_SLOTS * NUM_PARTIALS);

  // Pre-allocated scale folding and scratch buffers
  private readonly scaleBuf = new Float64Array(SCALE_BUF_CAP);
  private readonly activeRatios = new Float64Array(NUM_PARTIALS);
  private readonly partialGains = new Float64Array(NUM_PARTIALS);
  private readonly partialDecayCoeffs = new Float64Array(NUM_PARTIALS);
  private readonly malletBufL = new Float32Array(8);
  private readonly malletBufR = new Float32Array(8);

  private readonly attackStep: number;
  private readonly chirpDecayCoeff: number;
  private malletNoiseEnv = 0;
  private malletNoiseCoeff = 0.99;

  private noteCounter = 0;
  private lastMaterial = -1;
  private lastHardness = -1;
  private lastDecay = -1;

  constructor(sampleRate: number) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.dcBlocker = new StereoDCBlocker(this.sampleRate, 18);
    this.noiseL = new WhiteNoiseGenerator(0x41a7c923);
    this.noiseR = new WhiteNoiseGenerator(0x89f31d57);
    this.malletFilterL = new ZdfSvfFilter(this.sampleRate, 2400, 1.5, 1);
    this.malletFilterR = new ZdfSvfFilter(this.sampleRate, 2550, 1.5, 1);

    this.materialSmoother = new OnePoleSmoother(
      this.sampleRate,
      12,
      MATERIAL_PARAM.defaultValue,
    );
    this.hardnessSmoother = new OnePoleSmoother(
      this.sampleRate,
      10,
      MALLET_HARDNESS_PARAM.defaultValue,
    );
    this.shimmerSmoother = new OnePoleSmoother(
      this.sampleRate,
      15,
      SHIMMER_PARAM.defaultValue,
    );

    this.attackStep = 1 / Math.max(1, Math.round(0.001 * this.sampleRate));
    this.chirpDecayCoeff = Math.exp(-1 / (0.0045 * this.sampleRate));

    for (let s = 0; s < NUM_SLOTS; s++) {
      const pan = SLOT_PAN_POSITIONS[s] ?? 0;
      const angle = (pan + 1) * 0.25 * Math.PI;
      this.slotPanCos[s] = Math.cos(angle);
      this.slotPanSin[s] = Math.sin(angle);
    }

    this.updateModalCoeffs(
      MATERIAL_PARAM.defaultValue,
      MALLET_HARDNESS_PARAM.defaultValue,
      DECAY_PARAM.defaultValue,
    );
  }

  public reset(): void {
    this.dcBlocker.reset();
    this.noiseL.reset();
    this.noiseR.reset();
    this.malletFilterL.reset();
    this.malletFilterR.reset();
    this.materialSmoother.reset(MATERIAL_PARAM.defaultValue);
    this.hardnessSmoother.reset(MALLET_HARDNESS_PARAM.defaultValue);
    this.shimmerSmoother.reset(SHIMMER_PARAM.defaultValue);

    this.slotActive.fill(0);
    this.slotBaseHz.fill(0);
    this.slotAttack.fill(1);
    this.slotChirpPhase.fill(0);
    this.slotChirpEnv.fill(0);
    this.partialPhaseL.fill(0);
    this.partialPhaseR.fill(0);
    this.partialEnv.fill(0);

    this.malletNoiseEnv = 0;
    this.noteCounter = 0;
    this.lastMaterial = -1;
    this.lastHardness = -1;
    this.lastDecay = -1;
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
      // Natural minor fallback
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

  private allocateSlot(): number {
    let bestSlot = 0;
    let lowestEnv = Infinity;
    for (let s = 0; s < NUM_SLOTS; s++) {
      if (this.slotActive[s] === 0) {
        return s;
      }
      const env0 = this.partialEnv[s * NUM_PARTIALS]!;
      if (env0 < lowestEnv) {
        lowestEnv = env0;
        bestSlot = s;
      }
    }
    return bestSlot;
  }

  private triggerSlot(
    slot: number,
    midiNote: number,
    velocity: number,
    hardness: number,
  ): void {
    const safeMidi = clamp(midiNote, 24, 108);
    const hz = clamp(midiToFreq(safeMidi), 32, this.sampleRate * 0.42);
    const baseIdx = slot * NUM_PARTIALS;

    this.slotActive[slot] = 1;
    this.slotBaseHz[slot] = hz;
    this.slotAttack[slot] = 0;
    this.slotChirpPhase[slot] = 0;
    this.slotChirpEnv[slot] = velocity * (0.14 + 0.36 * hardness);

    for (let p = 0; p < NUM_PARTIALS; p++) {
      this.partialPhaseL[baseIdx + p] = 0;
      this.partialPhaseR[baseIdx + p] = 0;
      // Higher partials respond more strongly to harder mallet strikes
      const partialVelScale =
        p === 0 ? 1.0 : 0.45 + 0.55 * hardness;
      this.partialEnv[baseIdx + p] = velocity * partialVelScale;
    }
  }

  private updateModalCoeffs(
    material: number,
    hardness: number,
    decay: number,
  ): void {
    // 1. Blend partial frequency ratios: woody (0) -> glassy (0.5) -> crystalline bell (1)
    if (material <= 0.5) {
      const t = material * 2;
      for (let p = 0; p < NUM_PARTIALS; p++) {
        this.activeRatios[p] =
          WOODY_RATIOS[p]! + t * (GLASSY_RATIOS[p]! - WOODY_RATIOS[p]!);
      }
    } else {
      const t = (material - 0.5) * 2;
      for (let p = 0; p < NUM_PARTIALS; p++) {
        this.activeRatios[p] =
          GLASSY_RATIOS[p]! + t * (BELL_RATIOS[p]! - GLASSY_RATIOS[p]!);
      }
    }

    // 2. Partial relative amplitudes
    this.partialGains[0] = 0.58;
    this.partialGains[1] = 0.22 + 0.14 * material;
    this.partialGains[2] = 0.08 + 0.16 * material + 0.08 * hardness;
    this.partialGains[3] = 0.03 + 0.12 * material + 0.09 * hardness;

    // 3. Exponential decay coefficients: higher partials decay progressively faster
    const sr = this.sampleRate;
    const baseTau = clamp(decay * (0.48 + 0.25 * material), 0.025, 2.6);
    const tau1 = Math.max(0.012, baseTau * (0.34 + 0.26 * material));
    const tau2 = Math.max(0.008, baseTau * (0.16 + 0.18 * material));
    const tau3 = Math.max(0.005, baseTau * (0.08 + 0.12 * material));

    this.partialDecayCoeffs[0] = Math.exp(-1 / (baseTau * sr));
    this.partialDecayCoeffs[1] = Math.exp(-1 / (tau1 * sr));
    this.partialDecayCoeffs[2] = Math.exp(-1 / (tau2 * sr));
    this.partialDecayCoeffs[3] = Math.exp(-1 / (tau3 * sr));

    const noiseTau = 0.0018 + (1 - hardness) * 0.0045;
    this.malletNoiseCoeff = Math.exp(-1 / (noiseTau * sr));
  }

  public process(
    outL: Float32Array,
    outR: Float32Array,
    params: Record<string, number>,
    ctx: VoiceRenderContext,
  ): void {
    const count = Math.min(ctx.numSamples | 0, outL.length, outR.length);
    if (count <= 0) return;

    const targetMaterial = readParam(MATERIAL_PARAM, params);
    const targetHardness = readParam(MALLET_HARDNESS_PARAM, params);
    const decay = readParam(DECAY_PARAM, params);
    const targetShimmer = readParam(SHIMMER_PARAM, params);
    const octaveShift = Math.round(readParam(OCTAVE_SHIFT_PARAM, params));
    const melodyPattern = Math.round(readParam(MELODY_PATTERN_PARAM, params));
    const melodyRange = readParam(MELODY_RANGE_PARAM, params);

    const trig = Number.isFinite(ctx.timeFrame.triggerIntensity)
      ? clamp(ctx.timeFrame.triggerIntensity, 0, 1)
      : 0;
    const prevTrig = Number.isFinite(ctx.prevPulseTrigger) ? ctx.prevPulseTrigger : 0;
    const isNewTrigger = trig > 0.01 && prevTrig <= 0.01;

    if (isNewTrigger) {
      const rootMidi = Number.isFinite(ctx.harmony.rootMidi) ? ctx.harmony.rootMidi : 36;
      let targetBaseMidi = rootMidi + (octaveShift + 1) * 12;
      while (targetBaseMidi < 28) targetBaseMidi += 12;
      while (targetBaseMidi > 96) targetBaseMidi -= 12;

      const scaleLen = this.fillFoldedScale(ctx.harmony.scaleNotesMidi, targetBaseMidi);
      const octaveDegs = Math.max(1, Math.floor(scaleLen / 3));
      const span = Math.max(1, Math.min(scaleLen, Math.round(1 + melodyRange * (octaveDegs * 1.6))));
      const step = this.noteCounter++;

      let primaryDeg = 0;
      let upperDeg = -1;

      switch (melodyPattern) {
        case 0: // Einzelton
          primaryDeg = 0;
          break;
        case 1: {
          // Pendel 1–5
          const topDeg =
            melodyRange <= 0.02
              ? 0
              : Math.min(
                  scaleLen - 1,
                  Math.max(1, Math.round(melodyRange * 8.8)),
                );
          primaryDeg = (step & 1) === 0 ? 0 : topDeg;
          break;
        }
        case 2: // Skala aufwärts
          primaryDeg = step % span;
          break;
        case 3: // Sprung-Rätsel
          primaryDeg = (SPRUNG_DEGREES[step & 7] ?? 0) % span;
          break;
        case 4: {
          // Quinte/Terz-Duett
          primaryDeg = (DUET_DEGREES[step & 7] ?? 0) % span;
          const duetInterval = (step & 1) === 0 ? 2 : 4; // Diatonic 3rd or 5th
          upperDeg = Math.min(scaleLen - 1, primaryDeg + duetInterval);
          break;
        }
        default:
          primaryDeg = 0;
          break;
      }

      const accent = Number.isFinite(ctx.timeFrame.accent)
        ? clamp(ctx.timeFrame.accent, 0, 1)
        : 0.5;
      const vel = clamp((0.42 + 0.58 * trig) * (0.82 + 0.18 * accent), 0.2, 1);

      const primaryMidi = this.scaleBuf[primaryDeg] ?? targetBaseMidi;
      const slotA = this.allocateSlot();
      this.triggerSlot(slotA, primaryMidi, vel, targetHardness);

      if (upperDeg >= 0 && upperDeg !== primaryDeg) {
        const upperMidi = this.scaleBuf[upperDeg] ?? primaryMidi + 7;
        const slotB = this.allocateSlot();
        this.triggerSlot(slotB, upperMidi, vel * 0.72, targetHardness * 0.85);
      }

      this.malletNoiseEnv = Math.max(
        this.malletNoiseEnv * 0.25,
        vel * (0.15 + 0.85 * targetHardness),
      );
    }

    const sr = this.sampleRate;
    const nyquistLimit = sr * 0.44;
    const invSr = 1 / sr;
    const attackStep = this.attackStep;
    const chirpDecayCoeff = this.chirpDecayCoeff;

    for (let start = 0; start < count; start += 8) {
      const end = Math.min(start + 8, count);
      const subLen = end - start;

      let material = targetMaterial;
      if (this.materialSmoother.current !== material) {
        for (let k = 0; k < subLen; k++) {
          material = this.materialSmoother.process(targetMaterial);
        }
        if (Math.abs(material - targetMaterial) < 1e-6) {
          material = targetMaterial;
          this.materialSmoother.reset(targetMaterial);
        }
      }

      let hardness = targetHardness;
      if (this.hardnessSmoother.current !== hardness) {
        for (let k = 0; k < subLen; k++) {
          hardness = this.hardnessSmoother.process(targetHardness);
        }
        if (Math.abs(hardness - targetHardness) < 1e-6) {
          hardness = targetHardness;
          this.hardnessSmoother.reset(targetHardness);
        }
      }

      let shimmer = targetShimmer;
      if (this.shimmerSmoother.current !== shimmer) {
        for (let k = 0; k < subLen; k++) {
          shimmer = this.shimmerSmoother.process(targetShimmer);
        }
        if (Math.abs(shimmer - targetShimmer) < 1e-6) {
          shimmer = targetShimmer;
          this.shimmerSmoother.reset(targetShimmer);
        }
      }

      if (
        Math.abs(material - this.lastMaterial) > 1e-5 ||
        Math.abs(hardness - this.lastHardness) > 1e-5 ||
        Math.abs(decay - this.lastDecay) > 1e-5
      ) {
        this.lastMaterial = material;
        this.lastHardness = hardness;
        this.lastDecay = decay;
        this.updateModalCoeffs(material, hardness, decay);
      }

      // Mallet noise filter tracking material & hardness
      const malletFreq = clamp(
        900 + hardness * 2900 + material * 1200,
        400,
        sr * 0.4,
      );
      this.malletFilterL.setParams(malletFreq, 1.35 + hardness * 0.8, 1);
      this.malletFilterR.setParams(
        Math.min(malletFreq * 1.09, sr * 0.41),
        1.35 + hardness * 0.8,
        1,
      );

      for (let k = 0; k < subLen; k++) {
        this.malletBufL[k] = this.noiseL.processSample();
        this.malletBufR[k] = this.noiseR.processSample();
      }
      this.malletFilterL.processBlock(this.malletBufL, 0, subLen);
      this.malletFilterR.processBlock(this.malletBufR, 0, subLen);

      const detuneAmt = shimmer * 0.0038;
      const lrDetuneL = 1 - detuneAmt;
      const lrDetuneR = 1 + detuneAmt;

      const r0 = this.activeRatios[0]!;
      const r1 = this.activeRatios[1]!;
      const r2 = this.activeRatios[2]!;
      const r3 = this.activeRatios[3]!;
      const g0 = this.partialGains[0]!;
      const g1 = this.partialGains[1]!;
      const g2 = this.partialGains[2]!;
      const g3 = this.partialGains[3]!;
      const d0 = this.partialDecayCoeffs[0]!;
      const d1 = this.partialDecayCoeffs[1]!;
      const d2 = this.partialDecayCoeffs[2]!;
      const d3 = this.partialDecayCoeffs[3]!;

      const malletNoiseGain = 0.28 * hardness;
      const malletNoiseCoeff = this.malletNoiseCoeff;
      let malletEnv = this.malletNoiseEnv;

      for (let k = 0; k < subLen; k++) {
        const i = start + k;
        let sumL = 0;
        let sumR = 0;

        for (let s = 0; s < NUM_SLOTS; s++) {
          if (this.slotActive[s] === 0) continue;

          let atk = this.slotAttack[s]!;
          if (atk < 1) {
            atk = Math.min(1, atk + attackStep);
            this.slotAttack[s] = atk;
          }

          const baseHz = this.slotBaseHz[s]!;
          const idx = s * NUM_PARTIALS;

          let e0 = this.partialEnv[idx]!;
          let e1 = this.partialEnv[idx + 1]!;
          let e2 = this.partialEnv[idx + 2]!;
          let e3 = this.partialEnv[idx + 3]!;

          let phL0 = this.partialPhaseL[idx]!;
          let phR0 = this.partialPhaseR[idx]!;
          let phL1 = this.partialPhaseL[idx + 1]!;
          let phR1 = this.partialPhaseR[idx + 1]!;
          let phL2 = this.partialPhaseL[idx + 2]!;
          let phR2 = this.partialPhaseR[idx + 2]!;
          let phL3 = this.partialPhaseL[idx + 3]!;
          let phR3 = this.partialPhaseR[idx + 3]!;

          const f0 = baseHz * r0;
          const f1 = baseHz * r1;
          const f2 = baseHz * r2;
          const f3 = baseHz * r3;

          let sigL = 0;
          let sigR = 0;

          if (f0 < nyquistLimit && e0 > 1e-6) {
            sigL += Math.sin(TWO_PI * phL0) * g0 * e0;
            sigR += Math.sin(TWO_PI * phR0) * g0 * e0;
            phL0 += f0 * invSr;
            phR0 += f0 * invSr;
            if (phL0 >= 1) phL0 -= Math.floor(phL0);
            if (phR0 >= 1) phR0 -= Math.floor(phR0);
          }
          if (f1 < nyquistLimit && e1 > 1e-6) {
            sigL += Math.sin(TWO_PI * phL1) * g1 * e1;
            sigR += Math.sin(TWO_PI * phR1) * g1 * e1;
            phL1 += f1 * lrDetuneL * invSr;
            phR1 += f1 * lrDetuneR * invSr;
            if (phL1 >= 1) phL1 -= Math.floor(phL1);
            if (phR1 >= 1) phR1 -= Math.floor(phR1);
          }
          if (f2 < nyquistLimit && e2 > 1e-6) {
            sigL += Math.sin(TWO_PI * phL2) * g2 * e2;
            sigR += Math.sin(TWO_PI * phR2) * g2 * e2;
            phL2 += f2 * lrDetuneR * invSr;
            phR2 += f2 * lrDetuneL * invSr;
            if (phL2 >= 1) phL2 -= Math.floor(phL2);
            if (phR2 >= 1) phR2 -= Math.floor(phR2);
          }
          if (f3 < nyquistLimit && e3 > 1e-6) {
            sigL += Math.sin(TWO_PI * phL3) * g3 * e3;
            sigR += Math.sin(TWO_PI * phR3) * g3 * e3;
            phL3 += f3 * lrDetuneL * invSr;
            phR3 += f3 * lrDetuneR * invSr;
            if (phL3 >= 1) phL3 -= Math.floor(phL3);
            if (phR3 >= 1) phR3 -= Math.floor(phR3);
          }

          // Fast mallet pitch chirp
          let chirpEnv = this.slotChirpEnv[s]!;
          if (chirpEnv > 1e-5) {
            const chirpHz = Math.min(
              baseHz * (1.8 + 2.8 * chirpEnv),
              nyquistLimit,
            );
            let cPhase = this.slotChirpPhase[s]!;
            const chirpSample = Math.sin(TWO_PI * cPhase) * chirpEnv;
            sigL += chirpSample;
            sigR += chirpSample;
            cPhase += chirpHz * invSr;
            if (cPhase >= 1) cPhase -= Math.floor(cPhase);
            this.slotChirpPhase[s] = cPhase;
            chirpEnv *= chirpDecayCoeff;
            if (chirpEnv < 1e-6) chirpEnv = 0;
            this.slotChirpEnv[s] = chirpEnv;
          }

          e0 *= d0;
          e1 *= d1;
          e2 *= d2;
          e3 *= d3;
          if (e0 < 1e-6) e0 = 0;
          if (e1 < 1e-6) e1 = 0;
          if (e2 < 1e-6) e2 = 0;
          if (e3 < 1e-6) e3 = 0;

          this.partialEnv[idx] = e0;
          this.partialEnv[idx + 1] = e1;
          this.partialEnv[idx + 2] = e2;
          this.partialEnv[idx + 3] = e3;

          this.partialPhaseL[idx] = phL0;
          this.partialPhaseR[idx] = phR0;
          this.partialPhaseL[idx + 1] = phL1;
          this.partialPhaseR[idx + 1] = phR1;
          this.partialPhaseL[idx + 2] = phL2;
          this.partialPhaseR[idx + 2] = phR2;
          this.partialPhaseL[idx + 3] = phL3;
          this.partialPhaseR[idx + 3] = phR3;

          if (e0 === 0 && e1 === 0 && e2 === 0 && e3 === 0 && chirpEnv === 0) {
            this.slotActive[s] = 0;
          }

          // Mix mono/shimmered voice with alternating stereo spread [-0.35..+0.35]
          const panWeight = 0.25 + 0.75 * shimmer;
          const panCos = 0.70710678 + panWeight * (this.slotPanCos[s]! - 0.70710678);
          const panSin = 0.70710678 + panWeight * (this.slotPanSin[s]! - 0.70710678);
          const voiceGain = atk * 0.42;
          sumL += sigL * panCos * voiceGain;
          sumR += sigR * panSin * voiceGain;
        }

        if (malletEnv > 1e-6) {
          sumL += this.malletBufL[k]! * malletEnv * malletNoiseGain;
          sumR += this.malletBufR[k]! * malletEnv * malletNoiseGain;
          malletEnv *= malletNoiseCoeff;
          if (malletEnv < 1e-6) malletEnv = 0;
        }

        const satL = fastTanh(sumL * 0.92);
        const satR = fastTanh(sumR * 0.92);
        this.dcBlocker.process(satL, satR);

        const yL = this.dcBlocker.outL;
        const yR = this.dcBlocker.outR;
        outL[i] = yL * 0 === 0 ? clamp(yL, -1.2, 1.2) : 0;
        outR[i] = yR * 0 === 0 ? clamp(yR, -1.2, 1.2) : 0;
      }

      this.malletNoiseEnv = malletEnv;
    }
  }
}

export const modalBellVoiceModule: VoiceModule = {
  id: 'modal-bell',
  version: 1,
  category: 'harmony',
  displayName: 'Glocke & Mallet',
  description:
    'Kristalline Offbeat-Oberstimmen von Holz-Marimba und Vibraphon bis Glockenspiel.',
  parameters: [
    MATERIAL_PARAM,
    MALLET_HARDNESS_PARAM,
    DECAY_PARAM,
    SHIMMER_PARAM,
    OCTAVE_SHIFT_PARAM,
    MELODY_PATTERN_PARAM,
    MELODY_RANGE_PARAM,
  ],
  createInstance(sampleRate: number): VoiceInstance {
    return new ModalBellVoice(sampleRate);
  },
};
