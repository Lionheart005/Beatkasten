import { sanitizeSampleRate } from '../../dsp';
import type { ParameterSchema, ProcessorContext, ProcessorInstance, ProcessorModule } from '../../registry/types';
import { readCardParam } from './cardUtils';

const REPEAT: ParameterSchema = {
  id: 'repeat',
  label: 'Stottern',
  description: 'Ab 50 % wird das gerade gehörte Stück endlos wiederholt (Stutter / Beat-Repeat).',
  domain: 'time',
  min: 0,
  max: 1,
  defaultValue: 0,
  modulatable: true,
};

const DIVISION: ParameterSchema = {
  id: 'division',
  label: 'Stück-Länge',
  description: 'Wie lang das wiederholte Stück ist.',
  domain: 'time',
  min: 0,
  max: 4,
  step: 1,
  defaultValue: 2,
  modulatable: true,
  options: [
    { value: 0, label: '1 Beat' },
    { value: 1, label: '1/8' },
    { value: 2, label: '1/16' },
    { value: 3, label: '1/32' },
    { value: 4, label: '1/64' },
  ],
};

const DECAY: ParameterSchema = {
  id: 'decay',
  label: 'Abklingen',
  description: 'Jede Wiederholung wird etwas leiser (0 = gleich laut).',
  domain: 'time',
  min: 0,
  max: 1,
  defaultValue: 0.1,
  modulatable: true,
};

const MIX: ParameterSchema = {
  id: 'mix',
  label: 'Anteil',
  description: 'Mischung aus Wiederholung und Original während des Stotterns.',
  domain: 'space',
  min: 0,
  max: 1,
  defaultValue: 1,
  modulatable: true,
};

const BUFFER_SECONDS = 4;
const DIVISION_BEATS = [1, 0.5, 0.25, 0.125, 0.0625];

class BeatRepeatInstance implements ProcessorInstance {
  private readonly sr: number;
  private readonly bufL: Float32Array;
  private readonly bufR: Float32Array;
  private write = 0;
  private engaged = false;
  private loopStart = 0;
  private loopLen = 1;
  private phase = 0;
  private repeatGain = 1;
  /** The slice is recorded from the engage point; the first pass plays it live. */
  private firstPass = true;
  private wet = 0;
  private readonly edge: number;

  constructor(sampleRate: number) {
    this.sr = sanitizeSampleRate(sampleRate);
    const n = Math.round(this.sr * BUFFER_SECONDS);
    this.bufL = new Float32Array(n);
    this.bufR = new Float32Array(n);
    this.edge = Math.max(1, Math.round(0.002 * this.sr));
  }

  public reset(): void {
    this.bufL.fill(0);
    this.bufR.fill(0);
    this.write = 0;
    this.engaged = false;
    this.phase = 0;
    this.wet = 0;
  }

  public process(bufL: Float32Array, bufR: Float32Array, params: Record<string, number>, ctx: ProcessorContext): void {
    const count = Math.min(ctx.numSamples | 0, bufL.length, bufR.length);
    if (count <= 0) return;
    const on = readCardParam(REPEAT, params) >= 0.5;
    const div = DIVISION_BEATS[Math.round(readCardParam(DIVISION, params))] ?? 0.25;
    const decay = readCardParam(DECAY, params);
    const mix = readCardParam(MIX, params);
    const n = this.bufL.length;
    const bpm = Number.isFinite(ctx.bpm) && ctx.bpm > 0 ? ctx.bpm : 128;
    if (on && !this.engaged) {
      this.engaged = true;
      this.loopLen = Math.max(this.edge * 4, Math.min(n - 1, Math.round(div * (60 / bpm) * this.sr)));
      this.loopStart = this.write;
      this.phase = 0;
      this.repeatGain = 1;
      this.firstPass = true;
    } else if (!on && this.engaged) {
      this.engaged = false;
    }
    const wetTarget = this.engaged ? mix : 0;
    const wetStep = 1 / this.edge;
    for (let i = 0; i < count; i++) {
      const inL = bufL[i]!;
      const inR = bufR[i]!;
      this.bufL[this.write] = inL;
      this.bufR[this.write] = inR;
      this.write = this.write + 1 >= n ? 0 : this.write + 1;
      this.wet = wetTarget > this.wet ? Math.min(wetTarget, this.wet + wetStep) : Math.max(wetTarget, this.wet - wetStep);
      if (this.wet <= 0) continue;
      let idx = (this.loopStart + this.phase) % n;
      if (idx < 0) idx += n;
      // Short fades at the slice edges avoid clicks.
      const fromStart = this.phase;
      const toEnd = this.loopLen - this.phase;
      const e = this.firstPass ? 1 : Math.min(1, fromStart / this.edge, toEnd / this.edge) * this.repeatGain;
      const rL = this.bufL[idx]! * e;
      const rR = this.bufR[idx]! * e;
      bufL[i] = inL * (1 - this.wet) + rL * this.wet;
      bufR[i] = inR * (1 - this.wet) + rR * this.wet;
      if (this.engaged) {
        this.phase++;
        if (this.phase >= this.loopLen) {
          this.phase = 0;
          this.firstPass = false;
          this.repeatGain *= 1 - decay * 0.5;
        }
      }
    }
  }
}

export const beatRepeatCard: ProcessorModule = {
  id: 'card-beat-repeat',
  version: 1,
  stage: 'effect',
  displayName: 'Stotter & Wiederholen',
  description: 'Wiederholt ein kurzes Stück im Takt (Beat-Repeat) – ideal für Übergänge per Keyframe.',
  parameters: [REPEAT, DIVISION, DECAY, MIX],
  createInstance(sampleRate: number): ProcessorInstance {
    return new BeatRepeatInstance(sampleRate);
  },
};
