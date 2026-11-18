import { sanitizeSampleRate } from '../../dsp';
import type { ParameterSchema, ProcessorContext, ProcessorInstance, ProcessorModule } from '../../registry/types';
import { readCardParam, ringRead } from './cardUtils';

const STOP: ParameterSchema = {
  id: 'stop',
  label: 'Bremse',
  description: 'Bremst das Band ab: 0 = normal, 1 = steht (Tonhöhe und Tempo fallen wie bei einem gestoppten Plattenspieler).',
  domain: 'time',
  min: 0,
  max: 1,
  defaultValue: 0,
  modulatable: true,
};

const CURVE: ParameterSchema = {
  id: 'curve',
  label: 'Bremsverlauf',
  description: 'Weich = langsames Auslaufen, hart = abruptes Stoppen am Ende.',
  domain: 'time',
  min: 0,
  max: 1,
  defaultValue: 0.5,
  modulatable: true,
};

const BUFFER_SECONDS = 6;

class TapeStopInstance implements ProcessorInstance {
  private readonly sr: number;
  private readonly bufL: Float32Array;
  private readonly bufR: Float32Array;
  private write = 0;
  private read = 0;
  private engaged = false;
  /** Crossfade back to the live signal after a stop (samples left). */
  private returnFade = 0;
  private readonly returnLen: number;

  constructor(sampleRate: number) {
    this.sr = sanitizeSampleRate(sampleRate);
    const n = Math.round(this.sr * BUFFER_SECONDS);
    this.bufL = new Float32Array(n);
    this.bufR = new Float32Array(n);
    this.returnLen = Math.max(1, Math.round(0.012 * this.sr));
  }

  public reset(): void {
    this.bufL.fill(0);
    this.bufR.fill(0);
    this.write = 0;
    this.read = 0;
    this.engaged = false;
    this.returnFade = 0;
  }

  public process(bufL: Float32Array, bufR: Float32Array, params: Record<string, number>, ctx: ProcessorContext): void {
    const count = Math.min(ctx.numSamples | 0, bufL.length, bufR.length);
    if (count <= 0) return;
    const stop = readCardParam(STOP, params);
    const curve = readCardParam(CURVE, params);
    const n = this.bufL.length;
    // Speed falls with the stop amount; the curve bends the slope.
    const shaped = Math.pow(stop, 0.4 + curve * 1.6);
    const speed = 1 - shaped;
    const gain = Math.min(1, speed * 4);
    const active = stop > 0.0005;
    if (active && !this.engaged) {
      this.engaged = true;
      this.read = this.write;
    } else if (!active && this.engaged) {
      this.engaged = false;
      this.returnFade = this.returnLen;
    }
    for (let i = 0; i < count; i++) {
      const inL = bufL[i]!;
      const inR = bufR[i]!;
      this.bufL[this.write] = inL;
      this.bufR[this.write] = inR;
      this.write = this.write + 1 >= n ? 0 : this.write + 1;
      if (this.engaged) {
        this.read += speed;
        // Never fall further behind than the buffer holds.
        let lag = this.write - this.read;
        if (lag < 0) lag += n;
        if (lag > n - 8) this.read = this.write - (n - 8);
        bufL[i] = ringRead(this.bufL, this.read) * gain;
        bufR[i] = ringRead(this.bufR, this.read) * gain;
      } else if (this.returnFade > 0) {
        const t = this.returnFade / this.returnLen;
        this.read += 1;
        bufL[i] = inL * (1 - t) + ringRead(this.bufL, this.read) * t * gain;
        bufR[i] = inR * (1 - t) + ringRead(this.bufR, this.read) * t * gain;
        this.returnFade--;
      }
    }
  }
}

export const tapeStopCard: ProcessorModule = {
  id: 'card-tape-stop',
  version: 1,
  stage: 'effect',
  displayName: 'Bremse (Tape-Stop)',
  description: 'Lässt den Klang wie ein abgebremstes Tonband auslaufen – per Keyframes vor einem Drop.',
  parameters: [STOP, CURVE],
  createInstance(sampleRate: number): ProcessorInstance {
    return new TapeStopInstance(sampleRate);
  },
};
