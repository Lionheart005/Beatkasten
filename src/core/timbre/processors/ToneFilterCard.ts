import {
  clamp,
  OnePoleSmoother,
  sanitizeSampleRate,
  TiltEQ,
  ZdfSvfFilter,
} from '../../dsp';
import {
  type ParameterSchema,
  type ProcessorContext,
  type ProcessorInstance,
  type ProcessorModule,
} from '../../registry/types';

const BRIGHTNESS_PARAM: ParameterSchema = {
  id: 'brightness',
  label: 'Helligkeit',
  description: 'Öffnet oder schließt den Klang von dumpfem Sub bis zu offener Klarheit.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.65,
  curve: 'linear',
  modulatable: true,
};

const FOCUS_PARAM: ParameterSchema = {
  id: 'focus',
  label: 'Fokus (Resonanz)',
  description: 'Betont die Filterkante für prägnante Akzente und sägende Bewegungen.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.25,
  curve: 'linear',
  modulatable: true,
};

const FILTER_MODE_PARAM: ParameterSchema = {
  id: 'filterMode',
  label: 'Filter-Charakter',
  description: 'Blendet stufenlos von Tiefpass über Bandpass zu Hochpass.',
  domain: 'timbre',
  min: 0,
  max: 2,
  defaultValue: 0,
  curve: 'linear',
  modulatable: true,
};

const TILT_PARAM: ParameterSchema = {
  id: 'tilt',
  label: 'Klangwaage (Tilt)',
  description: 'Kippt die Balance sanft in Richtung warmen Bass oder schlanke Höhen.',
  domain: 'timbre',
  min: -1,
  max: 1,
  defaultValue: 0,
  curve: 'bipolar',
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

function brightnessToHz(brightness: number, sampleRate: number): number {
  const maxHz = Math.min(16000, sampleRate * 0.44);
  const hz = 90 * Math.pow(maxHz / 90, clamp(brightness, 0, 1));
  return clamp(hz, 22, sampleRate * 0.44);
}

class ToneFilterInstance implements ProcessorInstance {
  private readonly sampleRate: number;
  private readonly svfL: ZdfSvfFilter;
  private readonly svfR: ZdfSvfFilter;
  private readonly tiltL: TiltEQ;
  private readonly tiltR: TiltEQ;
  private readonly cutoffSmoother: OnePoleSmoother;
  private readonly qSmoother: OnePoleSmoother;
  private lastBrightness = -1;
  private cachedTargetHz = 1000;

  constructor(sampleRate: number) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    const initHz = brightnessToHz(BRIGHTNESS_PARAM.defaultValue, this.sampleRate);
    const initQ = 0.65 + FOCUS_PARAM.defaultValue * FOCUS_PARAM.defaultValue * 4.4;
    this.lastBrightness = BRIGHTNESS_PARAM.defaultValue;
    this.cachedTargetHz = initHz;

    this.svfL = new ZdfSvfFilter(this.sampleRate, initHz, initQ, 0);
    this.svfR = new ZdfSvfFilter(this.sampleRate, initHz, initQ, 0);
    this.tiltL = new TiltEQ(this.sampleRate, 650);
    this.tiltR = new TiltEQ(this.sampleRate, 650);
    this.cutoffSmoother = new OnePoleSmoother(this.sampleRate, 12, initHz);
    this.qSmoother = new OnePoleSmoother(this.sampleRate, 12, initQ);
  }

  public reset(): void {
    this.svfL.reset();
    this.svfR.reset();
    this.tiltL.reset();
    this.tiltR.reset();
    const initHz = brightnessToHz(BRIGHTNESS_PARAM.defaultValue, this.sampleRate);
    const initQ = 0.65 + FOCUS_PARAM.defaultValue * FOCUS_PARAM.defaultValue * 4.4;
    this.lastBrightness = BRIGHTNESS_PARAM.defaultValue;
    this.cachedTargetHz = initHz;
    this.cutoffSmoother.reset(initHz);
    this.qSmoother.reset(initQ);
  }

  public process(
    bufL: Float32Array,
    bufR: Float32Array,
    params: Record<string, number>,
    ctx: ProcessorContext,
  ): void {
    const count = Math.min(ctx.numSamples | 0, bufL.length, bufR.length);
    if (count <= 0) return;

    const brightness = readParam(BRIGHTNESS_PARAM, params);
    const focus = readParam(FOCUS_PARAM, params);
    const filterMode = readParam(FILTER_MODE_PARAM, params);
    const tilt = readParam(TILT_PARAM, params);

    if (Math.abs(brightness - this.lastBrightness) > 1e-6) {
      this.lastBrightness = brightness;
      this.cachedTargetHz = brightnessToHz(brightness, this.sampleRate);
    }
    const targetHz = this.cachedTargetHz;
    const targetQ = 0.65 + focus * focus * 4.4;

    this.tiltL.setTilt(tilt);
    this.tiltR.setTilt(tilt);

    if (this.cutoffSmoother.current === targetHz && this.qSmoother.current === targetQ) {
      this.svfL.setParams(targetHz, targetQ, filterMode);
      this.svfR.setParams(targetHz, targetQ, filterMode);
      this.svfL.processBlock(bufL, 0, count);
      this.svfR.processBlock(bufR, 0, count);
      this.tiltL.processBlock(bufL, 0, count);
      this.tiltR.processBlock(bufR, 0, count);
      return;
    }

    for (let start = 0; start < count; start += 8) {
      const end = Math.min(start + 8, count);
      const subLen = end - start;

      let hz = targetHz;
      if (this.cutoffSmoother.current !== hz) {
        for (let k = 0; k < subLen; k++) {
          hz = this.cutoffSmoother.process(targetHz);
        }
        if (Math.abs(hz - targetHz) < 1e-3) {
          hz = targetHz;
          this.cutoffSmoother.reset(targetHz);
        }
      }
      let q = targetQ;
      if (this.qSmoother.current !== q) {
        for (let k = 0; k < subLen; k++) {
          q = this.qSmoother.process(targetQ);
        }
        if (Math.abs(q - targetQ) < 1e-6) {
          q = targetQ;
          this.qSmoother.reset(targetQ);
        }
      }
      this.svfL.setParams(hz, q, filterMode);
      this.svfR.setParams(hz, q, filterMode);

      this.svfL.processBlock(bufL, start, end);
      this.svfR.processBlock(bufR, start, end);
      this.tiltL.processBlock(bufL, start, end);
      this.tiltR.processBlock(bufR, start, end);
    }
  }
}

export const toneFilterCard: ProcessorModule = {
  id: 'card-tone-filter',
  version: 1,
  stage: 'shaper',
  displayName: 'Helligkeit & Fokus',
  description: 'Formt mit einem musikalischen Filter und einer Klangwaage den Charakter der Spur.',
  parameters: [BRIGHTNESS_PARAM, FOCUS_PARAM, FILTER_MODE_PARAM, TILT_PARAM],
  createInstance(sampleRate: number): ProcessorInstance {
    return new ToneFilterInstance(sampleRate);
  },
};
