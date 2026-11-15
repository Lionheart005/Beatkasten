import {
  OnePoleSmoother,
  sanitizeSampleRate,
  SoftSaturator,
  Wavefolder,
} from '../../dsp';
import {
  type ParameterSchema,
  type ProcessorContext,
  type ProcessorInstance,
  type ProcessorModule,
} from '../../registry/types';

const WARMTH_GRIT_PARAM: ParameterSchema = {
  id: 'warmthGrit',
  label: 'Wärme & Dreck',
  description: 'Sättigt den Klang von samtiger Röhrenwärme bis zu kernigem Druck.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.2,
  curve: 'linear',
  modulatable: true,
};

const WAVEFOLD_PARAM: ParameterSchema = {
  id: 'wavefold',
  label: 'Wellenfaltung',
  description: 'Faltet Wellenformen für metallische, harmonische Obertöne.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.06,
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

class WarmthWavefoldInstance implements ProcessorInstance {
  private readonly satL: SoftSaturator;
  private readonly satR: SoftSaturator;
  private readonly foldL: Wavefolder;
  private readonly foldR: Wavefolder;
  private readonly warmthSmoother: OnePoleSmoother;
  private readonly foldSmoother: OnePoleSmoother;

  constructor(sampleRate: number) {
    const sr = sanitizeSampleRate(sampleRate);
    this.satL = new SoftSaturator(sr, WARMTH_GRIT_PARAM.defaultValue);
    this.satR = new SoftSaturator(sr, WARMTH_GRIT_PARAM.defaultValue);
    this.foldL = new Wavefolder(sr, WAVEFOLD_PARAM.defaultValue);
    this.foldR = new Wavefolder(sr, WAVEFOLD_PARAM.defaultValue);
    this.warmthSmoother = new OnePoleSmoother(sr, 12, WARMTH_GRIT_PARAM.defaultValue);
    this.foldSmoother = new OnePoleSmoother(sr, 12, WAVEFOLD_PARAM.defaultValue);
  }

  public reset(): void {
    this.satL.reset();
    this.satR.reset();
    this.foldL.reset();
    this.foldR.reset();
    this.warmthSmoother.reset(WARMTH_GRIT_PARAM.defaultValue);
    this.foldSmoother.reset(WAVEFOLD_PARAM.defaultValue);
  }

  public process(
    bufL: Float32Array,
    bufR: Float32Array,
    params: Record<string, number>,
    ctx: ProcessorContext,
  ): void {
    const count = Math.min(ctx.numSamples | 0, bufL.length, bufR.length);
    if (count <= 0) return;

    const targetWarmth = readParam(WARMTH_GRIT_PARAM, params);
    const targetFold = readParam(WAVEFOLD_PARAM, params);

    if (this.warmthSmoother.current === targetWarmth && this.foldSmoother.current === targetFold) {
      this.satL.setDrive(targetWarmth);
      this.satR.setDrive(targetWarmth);
      this.foldL.setAmount(targetFold);
      this.foldR.setAmount(targetFold);
      this.satL.processBlock(bufL, 0, count);
      this.satR.processBlock(bufR, 0, count);
      this.foldL.processBlock(bufL, 0, count);
      this.foldR.processBlock(bufR, 0, count);
      return;
    }

    for (let start = 0; start < count; start += 8) {
      const end = Math.min(start + 8, count);
      const subLen = end - start;

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
      let fold = targetFold;
      if (this.foldSmoother.current !== fold) {
        for (let k = 0; k < subLen; k++) {
          fold = this.foldSmoother.process(targetFold);
        }
        if (Math.abs(fold - targetFold) < 1e-6) {
          fold = targetFold;
          this.foldSmoother.reset(targetFold);
        }
      }

      this.satL.setDrive(warmth);
      this.satR.setDrive(warmth);
      this.foldL.setAmount(fold);
      this.foldR.setAmount(fold);

      this.satL.processBlock(bufL, start, end);
      this.satR.processBlock(bufR, start, end);
      this.foldL.processBlock(bufL, start, end);
      this.foldR.processBlock(bufR, start, end);
    }
  }
}

export const warmthWavefoldCard: ProcessorModule = {
  id: 'card-warmth-wavefold',
  version: 1,
  stage: 'shaper',
  displayName: 'Wärme, Dreck & Faltung',
  description: 'Verleiht Signalen analoge Dichte, Charakter und zusätzliche Obertöne.',
  parameters: [WARMTH_GRIT_PARAM, WAVEFOLD_PARAM],
  createInstance(sampleRate: number): ProcessorInstance {
    return new WarmthWavefoldInstance(sampleRate);
  },
};
