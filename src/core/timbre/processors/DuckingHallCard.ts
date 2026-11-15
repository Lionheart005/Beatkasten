import {
  clamp,
  DuckingReverb,
  sanitizeSampleRate,
} from '../../dsp';
import {
  type ParameterSchema,
  type ProcessorContext,
  type ProcessorInstance,
  type ProcessorModule,
} from '../../registry/types';

const MIX_PARAM: ParameterSchema = {
  id: 'mix',
  label: 'Hall-Anteil',
  description: 'Mischt den atmosphärischen Raumklang zum Signal.',
  domain: 'space',
  min: 0,
  max: 1,
  defaultValue: 0.18,
  curve: 'linear',
  modulatable: true,
};

const SIZE_PARAM: ParameterSchema = {
  id: 'size',
  label: 'Raumgröße',
  description: 'Von engem Club-Raum bis zu weiter Industriehalle.',
  domain: 'space',
  min: 0,
  max: 1,
  defaultValue: 0.55,
  curve: 'linear',
  modulatable: true,
};

const DECAY_PARAM: ParameterSchema = {
  id: 'decay',
  label: 'Hallfahne',
  description: 'Bestimmt, wie lange der Raum nachklingt.',
  domain: 'space',
  min: 0,
  max: 1,
  defaultValue: 0.6,
  curve: 'linear',
  modulatable: true,
};

const BRIGHTNESS_PARAM: ParameterSchema = {
  id: 'brightness',
  label: 'Raum-Helligkeit',
  description: 'Steuert, ob der Hall dunkel-samtig oder klar und schimmernd klingt.',
  domain: 'space',
  min: 0,
  max: 1,
  defaultValue: 0.45,
  curve: 'linear',
  modulatable: true,
};

const DUCK_AMOUNT_PARAM: ParameterSchema = {
  id: 'duckAmount',
  label: 'Puls-Ducking',
  description: 'Drückt den Hall beim Impuls kurz weg, damit der Groove knackig und sauber bleibt.',
  domain: 'space',
  min: 0,
  max: 1,
  defaultValue: 0.5,
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

class DuckingHallInstance implements ProcessorInstance {
  private readonly reverb: DuckingReverb;

  constructor(sampleRate: number) {
    this.reverb = new DuckingReverb(sanitizeSampleRate(sampleRate));
  }

  public reset(): void {
    this.reverb.reset();
  }

  public process(
    bufL: Float32Array,
    bufR: Float32Array,
    params: Record<string, number>,
    ctx: ProcessorContext,
  ): void {
    const count = Math.min(ctx.numSamples | 0, bufL.length, bufR.length);
    if (count <= 0) return;

    const mix = readParam(MIX_PARAM, params);
    const size = readParam(SIZE_PARAM, params);
    const decay = readParam(DECAY_PARAM, params);
    const brightness = readParam(BRIGHTNESS_PARAM, params);
    const duckAmount = readParam(DUCK_AMOUNT_PARAM, params);

    const pulseEnergy = Number.isFinite(ctx.layerPulseEnergy)
      ? clamp(ctx.layerPulseEnergy, 0, 1)
      : 0;

    this.reverb.setParams(size, decay, brightness, mix, duckAmount);
    this.reverb.setPulseEnergy(pulseEnergy);

    for (let start = 0; start < count; start += 128) {
      this.reverb.processStereoBlock(bufL, bufR, start, Math.min(start + 128, count), pulseEnergy);
    }
  }
}

export const duckingHallCard: ProcessorModule = {
  id: 'card-ducking-hall',
  version: 1,
  stage: 'effect',
  displayName: 'Rhythmischer Hall',
  description: 'Dichter Raumhall, der im Takt atmet und den Rhythmus nicht verwischt.',
  parameters: [MIX_PARAM, SIZE_PARAM, DECAY_PARAM, BRIGHTNESS_PARAM, DUCK_AMOUNT_PARAM],
  createInstance(sampleRate: number): ProcessorInstance {
    return new DuckingHallInstance(sampleRate);
  },
};
