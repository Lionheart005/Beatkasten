import { sanitizeSampleRate } from '../../dsp';
import type { ParameterSchema, ProcessorContext, ProcessorInstance, ProcessorModule } from '../../registry/types';
import { readCardParam } from './cardUtils';

const AMOUNT: ParameterSchema = {
  id: 'amount',
  label: 'Gleichmäßig',
  description: 'Gleicht laute und leise Stellen an (Kompressor) – wichtig für Gesang.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.4,
  modulatable: true,
};

const SPEED: ParameterSchema = {
  id: 'speed',
  label: 'Reaktion',
  description: 'Langsam = natürlich und weich, schnell = dicht und nach vorne.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.5,
  modulatable: true,
};

const OUTPUT: ParameterSchema = {
  id: 'output',
  label: 'Lautstärke danach',
  description: 'Gleicht den Pegel nach dem Verdichten aus.',
  domain: 'timbre',
  min: 0,
  max: 2,
  defaultValue: 1,
  modulatable: true,
};

const dbToGain = (db: number) => Math.pow(10, db / 20);

class EvennessInstance implements ProcessorInstance {
  private readonly sr: number;
  private env = 0;
  private gainDb = 0;

  constructor(sampleRate: number) {
    this.sr = sanitizeSampleRate(sampleRate);
  }

  public reset(): void {
    this.env = 0;
    this.gainDb = 0;
  }

  public process(bufL: Float32Array, bufR: Float32Array, params: Record<string, number>, ctx: ProcessorContext): void {
    const count = Math.min(ctx.numSamples | 0, bufL.length, bufR.length);
    if (count <= 0) return;
    const amount = readCardParam(AMOUNT, params);
    const speed = readCardParam(SPEED, params);
    const out = readCardParam(OUTPUT, params);
    if (amount <= 0.001 && out === 1) return;
    const threshDb = -4 - amount * 26;
    const ratio = 1 + amount * 6;
    const knee = 6;
    const attackMs = 30 - speed * 27;
    const releaseMs = 320 - speed * 260;
    const aAtt = Math.exp(-1 / (0.001 * attackMs * this.sr));
    const aRel = Math.exp(-1 / (0.001 * releaseMs * this.sr));
    const aEnv = Math.exp(-1 / (0.002 * this.sr));
    // Auto make-up: half of the reduction a full-scale signal would get.
    const makeupDb = -threshDb * (1 - 1 / ratio) * 0.5;
    const outGain = out * dbToGain(makeupDb);
    for (let i = 0; i < count; i++) {
      const l = bufL[i]!;
      const r = bufR[i]!;
      const peak = Math.max(l < 0 ? -l : l, r < 0 ? -r : r);
      this.env = peak > this.env ? peak : aEnv * this.env + (1 - aEnv) * peak;
      const levelDb = this.env > 1e-6 ? 20 * Math.log10(this.env) : -120;
      const over = levelDb - threshDb;
      let targetDb = 0;
      if (over > knee / 2) targetDb = -over * (1 - 1 / ratio);
      else if (over > -knee / 2) {
        const x = over + knee / 2;
        targetDb = -((1 - 1 / ratio) * x * x) / (2 * knee);
      }
      const a = targetDb < this.gainDb ? aAtt : aRel;
      this.gainDb = a * this.gainDb + (1 - a) * targetDb;
      const g = dbToGain(this.gainDb) * outGain;
      bufL[i] = l * g;
      bufR[i] = r * g;
    }
  }
}

export const evennessCard: ProcessorModule = {
  id: 'card-evenness',
  version: 1,
  stage: 'shaper',
  displayName: 'Gleichmäßig machen',
  description: 'Sanfter Kompressor: hält Gesang und Aufnahmen gleich laut und präsent.',
  parameters: [AMOUNT, SPEED, OUTPUT],
  createInstance(sampleRate: number): ProcessorInstance {
    return new EvennessInstance(sampleRate);
  },
};
