import {
  Musical3BandEQ,
  sanitizeSampleRate,
  StereoOrbit,
} from '../../dsp';
import {
  type ParameterSchema,
  type ProcessorContext,
  type ProcessorInstance,
  type ProcessorModule,
} from '../../registry/types';

const LOW_DB_PARAM: ParameterSchema = {
  id: 'lowDb',
  label: 'Tiefen',
  description: 'Hebt das Fundament im Bassbereich an oder räumt es sanft auf.',
  domain: 'timbre',
  min: -12,
  max: 12,
  defaultValue: 0,
  curve: 'bipolar',
  modulatable: true,
  unitLabel: 'dB',
};

const MID_DB_PARAM: ParameterSchema = {
  id: 'midDb',
  label: 'Mitten',
  description: 'Betont Wärme und Präsenz oder schafft Platz im Mix.',
  domain: 'timbre',
  min: -12,
  max: 12,
  defaultValue: 0,
  curve: 'bipolar',
  modulatable: true,
  unitLabel: 'dB',
};

const HIGH_DB_PARAM: ParameterSchema = {
  id: 'highDb',
  label: 'Höhen',
  description: 'Regelt Brillanz, Luftigkeit und Strahlkraft obenherum.',
  domain: 'timbre',
  min: -12,
  max: 12,
  defaultValue: 0,
  curve: 'bipolar',
  modulatable: true,
  unitLabel: 'dB',
};

const STEREO_ORBIT_PARAM: ParameterSchema = {
  id: 'stereoOrbit',
  label: 'Raumbreite',
  description: 'Macht die Spur von eng-fokussiertem Mono bis weit im Stereo-Panorama breit (Subbass bleibt mono).',
  domain: 'space',
  min: 0,
  max: 1.8,
  defaultValue: 1.0,
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

class EqOrbitInstance implements ProcessorInstance {
  private readonly eqL: Musical3BandEQ;
  private readonly eqR: Musical3BandEQ;
  private readonly orbit: StereoOrbit;

  constructor(sampleRate: number) {
    const sr = sanitizeSampleRate(sampleRate);
    this.eqL = new Musical3BandEQ(sr);
    this.eqR = new Musical3BandEQ(sr);
    this.orbit = new StereoOrbit(sr, STEREO_ORBIT_PARAM.defaultValue);
  }

  public reset(): void {
    this.eqL.reset();
    this.eqR.reset();
    this.orbit.reset();
  }

  public process(
    bufL: Float32Array,
    bufR: Float32Array,
    params: Record<string, number>,
    ctx: ProcessorContext,
  ): void {
    const count = Math.min(ctx.numSamples | 0, bufL.length, bufR.length);
    if (count <= 0) return;

    const lowDb = readParam(LOW_DB_PARAM, params);
    const midDb = readParam(MID_DB_PARAM, params);
    const highDb = readParam(HIGH_DB_PARAM, params);
    const width = readParam(STEREO_ORBIT_PARAM, params);

    this.eqL.setGains(lowDb, midDb, highDb);
    this.eqR.setGains(lowDb, midDb, highDb);
    this.orbit.setWidth(width);

    this.eqL.processBlock(bufL, 0, count);
    this.eqR.processBlock(bufR, 0, count);
    this.orbit.processStereoBlock(bufL, bufR, 0, count);
  }
}

export const eqOrbitCard: ProcessorModule = {
  id: 'card-eq-orbit',
  version: 1,
  stage: 'effect',
  displayName: 'Musical EQ & Raumbreite',
  description: 'Musikalische 3-Band-Klangregelung mit sauberem Stereo-Raum über dem Subbass.',
  parameters: [LOW_DB_PARAM, MID_DB_PARAM, HIGH_DB_PARAM, STEREO_ORBIT_PARAM],
  createInstance(sampleRate: number): ProcessorInstance {
    return new EqOrbitInstance(sampleRate);
  },
};
