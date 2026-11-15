import {
  type DelayDivision,
  sanitizeSampleRate,
  TempoSyncDelay,
} from '../../dsp';
import {
  type ParameterSchema,
  type ProcessorContext,
  type ProcessorInstance,
  type ProcessorModule,
} from '../../registry/types';

const MIX_PARAM: ParameterSchema = {
  id: 'mix',
  label: 'Echo-Anteil',
  description: 'Mischt das rhythmische Echo stufenlos zum Originalsignal.',
  domain: 'space',
  min: 0,
  max: 1,
  defaultValue: 0.15,
  curve: 'linear',
  modulatable: true,
};

const DIVISION_PARAM: ParameterSchema = {
  id: 'division',
  label: 'Takt-Teilung',
  description: 'Rhythmischer Abstand der Wiederholungen passend zum Tempo.',
  domain: 'space',
  min: 0,
  max: 3,
  step: 1,
  defaultValue: 1,
  curve: 'linear',
  modulatable: false,
  options: [
    { value: 0, label: '1/8' },
    { value: 1, label: '3/16 (Punktiert)' },
    { value: 2, label: '1/4' },
    { value: 3, label: '1/3 (Triole)' },
  ],
};

const FEEDBACK_PARAM: ParameterSchema = {
  id: 'feedback',
  label: 'Wiederholungen',
  description: 'Wie oft und wie lange die Echos nachhallen.',
  domain: 'space',
  min: 0,
  max: 0.8,
  defaultValue: 0.38,
  curve: 'linear',
  modulatable: true,
};

const DARKENING_PARAM: ParameterSchema = {
  id: 'darkening',
  label: 'Band-Abdunklung',
  description: 'Macht jede Wiederholung wärmer und weicher wie bei einem analogen Bandecho.',
  domain: 'space',
  min: 0,
  max: 1,
  defaultValue: 0.45,
  curve: 'linear',
  modulatable: true,
};

const PING_PONG_PARAM: ParameterSchema = {
  id: 'pingPong',
  label: 'Ping-Pong-Panorama',
  description: 'Lässt die Echos abwechselnd zwischen links und rechts wandern.',
  domain: 'space',
  min: 0,
  max: 1,
  step: 1,
  defaultValue: 1,
  curve: 'linear',
  modulatable: false,
  options: [
    { value: 0, label: 'Stereo' },
    { value: 1, label: 'Ping-Pong' },
  ],
};

const DIVISION_MAP: readonly DelayDivision[] = ['1/8', '3/16', '1/4', '1/3'];

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

class TempoEchoInstance implements ProcessorInstance {
  private readonly delay: TempoSyncDelay;

  constructor(sampleRate: number) {
    this.delay = new TempoSyncDelay(sanitizeSampleRate(sampleRate));
  }

  public reset(): void {
    this.delay.reset();
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
    const divIndex = Math.round(readParam(DIVISION_PARAM, params));
    const division = DIVISION_MAP[divIndex] ?? '3/16';
    const feedback = readParam(FEEDBACK_PARAM, params);
    const darkening = readParam(DARKENING_PARAM, params);
    const pingPong = readParam(PING_PONG_PARAM, params) >= 0.5;

    this.delay.setBpm(Number.isFinite(ctx.bpm) ? ctx.bpm : 128);
    this.delay.setDivision(division);
    this.delay.setPingPong(pingPong);
    this.delay.setFeedback(feedback);
    this.delay.setDarkening(darkening);
    this.delay.setMix(mix);

    this.delay.processStereoBlock(bufL, bufR, 0, count);
  }
}

export const tempoEchoCard: ProcessorModule = {
  id: 'card-tempo-echo',
  version: 1,
  stage: 'effect',
  displayName: 'Tempo-Echo',
  description: 'Tempo-synchrones Stereo- und Ping-Pong-Echo mit warmer Band-Sättigung.',
  parameters: [MIX_PARAM, DIVISION_PARAM, FEEDBACK_PARAM, DARKENING_PARAM, PING_PONG_PARAM],
  createInstance(sampleRate: number): ProcessorInstance {
    return new TempoEchoInstance(sampleRate);
  },
};
