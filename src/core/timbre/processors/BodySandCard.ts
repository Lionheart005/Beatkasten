import {
  OnePoleSmoother,
  SandReducer,
  sanitizeSampleRate,
  TunedBodyResonator,
} from '../../dsp';
import {
  type ParameterSchema,
  type ProcessorContext,
  type ProcessorInstance,
  type ProcessorModule,
} from '../../registry/types';
import { midiToFreq } from '../../theory';

const BODY_RESONANCE_PARAM: ParameterSchema = {
  id: 'bodyResonance',
  label: 'Körper-Resonanz',
  description: 'Lässt die Spur in der passenden Tonart wie ein physischer Klangkörper mitschwingen.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.1,
  curve: 'linear',
  modulatable: true,
};

const BODY_CHARACTER_PARAM: ParameterSchema = {
  id: 'bodyCharacter',
  label: 'Körper-Material',
  description: 'Verändert das Resonanzverhalten von dumpf-holzig zu hell-metallisch.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.35,
  curve: 'linear',
  modulatable: true,
};

const SAND_DUST_PARAM: ParameterSchema = {
  id: 'sandDust',
  label: 'Körnung & Staub',
  description: 'Streut feine digitale Textur und angenehmen Lo-Fi-Glanz darüber.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.04,
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

class BodySandInstance implements ProcessorInstance {
  private readonly resonator: TunedBodyResonator;
  private readonly sandL: SandReducer;
  private readonly sandR: SandReducer;
  private readonly resSmoother: OnePoleSmoother;
  private readonly charSmoother: OnePoleSmoother;
  private readonly sandSmoother: OnePoleSmoother;
  private lastRootMidi = Number.NaN;
  private cachedTargetHz = 110;

  constructor(sampleRate: number) {
    const sr = sanitizeSampleRate(sampleRate);
    this.resonator = new TunedBodyResonator(sr);
    this.sandL = new SandReducer(sr, SAND_DUST_PARAM.defaultValue);
    this.sandR = new SandReducer(sr, SAND_DUST_PARAM.defaultValue);
    this.resSmoother = new OnePoleSmoother(sr, 12, BODY_RESONANCE_PARAM.defaultValue);
    this.charSmoother = new OnePoleSmoother(sr, 12, BODY_CHARACTER_PARAM.defaultValue);
    this.sandSmoother = new OnePoleSmoother(sr, 12, SAND_DUST_PARAM.defaultValue);
  }

  public reset(): void {
    this.resonator.reset();
    this.sandL.reset();
    this.sandR.reset();
    this.resSmoother.reset(BODY_RESONANCE_PARAM.defaultValue);
    this.charSmoother.reset(BODY_CHARACTER_PARAM.defaultValue);
    this.sandSmoother.reset(SAND_DUST_PARAM.defaultValue);
    this.lastRootMidi = Number.NaN;
    this.cachedTargetHz = 110;
  }

  public process(
    bufL: Float32Array,
    bufR: Float32Array,
    params: Record<string, number>,
    ctx: ProcessorContext,
  ): void {
    const count = Math.min(ctx.numSamples | 0, bufL.length, bufR.length);
    if (count <= 0) return;

    const targetRes = readParam(BODY_RESONANCE_PARAM, params);
    const targetChar = readParam(BODY_CHARACTER_PARAM, params);
    const targetSand = readParam(SAND_DUST_PARAM, params);

    const rootMidi = Number.isFinite(ctx.harmony.rootMidi) ? ctx.harmony.rootMidi : 36;
    if (rootMidi !== this.lastRootMidi) {
      this.lastRootMidi = rootMidi;
      this.cachedTargetHz = midiToFreq(rootMidi + 12);
    }
    const targetHz = this.cachedTargetHz;

    if (
      this.resSmoother.current === targetRes &&
      this.charSmoother.current === targetChar &&
      this.sandSmoother.current === targetSand
    ) {
      this.resonator.setParams(targetHz, targetRes, targetChar);
      this.sandL.setAmount(targetSand);
      this.sandR.setAmount(targetSand);
      this.resonator.processStereoBlock(bufL, bufR, 0, count);
      this.sandL.processBlock(bufL, 0, count);
      this.sandR.processBlock(bufR, 0, count);
      return;
    }

    for (let start = 0; start < count; start += 8) {
      const end = Math.min(start + 8, count);
      const subLen = end - start;

      let res = targetRes;
      if (this.resSmoother.current !== res) {
        for (let k = 0; k < subLen; k++) {
          res = this.resSmoother.process(targetRes);
        }
        if (Math.abs(res - targetRes) < 1e-6) {
          res = targetRes;
          this.resSmoother.reset(targetRes);
        }
      }
      let char = targetChar;
      if (this.charSmoother.current !== char) {
        for (let k = 0; k < subLen; k++) {
          char = this.charSmoother.process(targetChar);
        }
        if (Math.abs(char - targetChar) < 1e-6) {
          char = targetChar;
          this.charSmoother.reset(targetChar);
        }
      }
      let sand = targetSand;
      if (this.sandSmoother.current !== sand) {
        for (let k = 0; k < subLen; k++) {
          sand = this.sandSmoother.process(targetSand);
        }
        if (Math.abs(sand - targetSand) < 1e-6) {
          sand = targetSand;
          this.sandSmoother.reset(targetSand);
        }
      }

      this.resonator.setParams(targetHz, res, char);
      this.sandL.setAmount(sand);
      this.sandR.setAmount(sand);

      this.resonator.processStereoBlock(bufL, bufR, start, end);
      this.sandL.processBlock(bufL, start, end);
      this.sandR.processBlock(bufR, start, end);
    }
  }
}

export const bodySandCard: ProcessorModule = {
  id: 'card-body-sand',
  version: 1,
  stage: 'shaper',
  displayName: 'Körper & Körnung',
  description: 'Kombiniert harmonische Raumkörper-Resonanz mit feinkörniger Textur.',
  parameters: [BODY_RESONANCE_PARAM, BODY_CHARACTER_PARAM, SAND_DUST_PARAM],
  createInstance(sampleRate: number): ProcessorInstance {
    return new BodySandInstance(sampleRate);
  },
};
