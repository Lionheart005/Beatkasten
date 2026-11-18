/**
 * "Sample-Instrument": plays a sound of the audio pool (recording or file).
 * Modes: one-shot (fixed pitch), pitch follows the harmony (root / chord
 * tones / whole chord), bass (follows the bass note) and slices.
 * 8 voices, Hermite interpolation, attack / decay / sustain, low-pass,
 * reverse and loop. Gets its PCM through `attachSample` (no storage / UI).
 */
import type {
  ParameterSchema,
  SampleRegion,
  SampleSource,
  VoiceInstance,
  VoiceModule,
  VoiceRenderContext,
} from '../../registry/types';
import { clamp01, decayCoeff, detectNewTrigger, readParam, SUSTAIN_PARAM } from './voiceUtils';

const MAX_VOICES = 8;

const MODE: ParameterSchema = {
  id: 'mode',
  label: 'Spielweise',
  description: 'Einzelschlag = feste Tonhöhe (Drums), Tonhöhe folgt Harmonie, Bass = folgt dem Basston, Slices = Stücke reihum.',
  domain: 'timbre',
  min: 0,
  max: 3,
  step: 1,
  defaultValue: 0,
  modulatable: false,
  group: 'pitch',
  options: [
    { value: 0, label: 'Einzelschlag' },
    { value: 1, label: 'Tonhöhe folgt Harmonie' },
    { value: 2, label: 'Bass' },
    { value: 3, label: 'Slices' },
  ],
};

const PITCH_SOURCE: ParameterSchema = {
  id: 'pitchSource',
  label: 'Töne',
  description: 'Bei „Tonhöhe folgt Harmonie“: Grundton, Akkordtöne nacheinander oder der ganze Akkord auf einmal.',
  domain: 'harmony',
  min: 0,
  max: 2,
  step: 1,
  defaultValue: 0,
  modulatable: false,
  group: 'pitch',
  options: [
    { value: 0, label: 'Grundton' },
    { value: 1, label: 'Akkordtöne reihum' },
    { value: 2, label: 'Ganzer Akkord' },
  ],
};

const OCTAVE: ParameterSchema = {
  id: 'octave',
  label: 'Oktavlage',
  description: 'Verschiebt die gespielten Töne um ganze Oktaven.',
  domain: 'harmony',
  min: -2,
  max: 2,
  step: 1,
  defaultValue: 0,
  modulatable: true,
  group: 'pitch',
};

const TUNE: ParameterSchema = {
  id: 'tune',
  label: 'Stimmung (Halbtöne)',
  description: 'Transponiert das Sample in Halbtönen.',
  domain: 'harmony',
  min: -24,
  max: 24,
  step: 1,
  defaultValue: 0,
  modulatable: true,
  group: 'pitch',
};

const FINE: ParameterSchema = {
  id: 'fine',
  label: 'Feinstimmung (Cent)',
  description: 'Feine Verstimmung in Cent (100 Cent = 1 Halbton).',
  domain: 'harmony',
  min: -100,
  max: 100,
  defaultValue: 0,
  modulatable: true,
  group: 'pitch',
  unitLabel: 'ct',
};

const START: ParameterSchema = {
  id: 'start',
  label: 'Startpunkt',
  description: 'Verschiebt den Start innerhalb des gewählten Bereichs. Mit einer Welle bewegt entsteht eine körnige Textur.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0,
  modulatable: true,
  group: 'tone',
};

const LENGTH: ParameterSchema = {
  id: 'length',
  label: 'Länge (Bereich)',
  description: 'Wie viel des gewählten Bereichs gespielt wird.',
  domain: 'timbre',
  min: 0.02,
  max: 1,
  defaultValue: 1,
  modulatable: true,
  group: 'tone',
};

const BRIGHTNESS: ParameterSchema = {
  id: 'brightness',
  label: 'Helligkeit',
  description: 'Tiefpass: dunkler nach links.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 1,
  modulatable: true,
  group: 'tone',
};

const ATTACK: ParameterSchema = {
  id: 'attack',
  label: 'Anschlag (Einblenden)',
  description: 'Wie weich der Ton beginnt.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.02,
  modulatable: true,
  group: 'envelope',
};

const DECAY: ParameterSchema = {
  id: 'decay',
  label: 'Länge (Ausklang)',
  description: 'Wie schnell der Ton ausklingt (rechts = das Sample spielt ganz).',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 1,
  modulatable: true,
  group: 'envelope',
};

const ACCENT: ParameterSchema = {
  id: 'accentDepth',
  label: 'Akzent → Lautstärke',
  description: 'Wie stark betonte Schläge lauter klingen.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0.5,
  modulatable: true,
  group: 'envelope',
};

const REVERSE: ParameterSchema = {
  id: 'reverse',
  label: 'Rückwärts',
  description: 'Spielt das Sample rückwärts.',
  domain: 'timbre',
  min: 0,
  max: 1,
  step: 1,
  defaultValue: 0,
  modulatable: false,
  group: 'tone',
  options: [
    { value: 0, label: 'Aus' },
    { value: 1, label: 'An' },
  ],
};

const LOOP: ParameterSchema = {
  id: 'loop',
  label: 'Schleife',
  description: 'Wiederholt den Loop-Bereich, solange der Ton gehalten wird.',
  domain: 'timbre',
  min: 0,
  max: 1,
  step: 1,
  defaultValue: 0,
  modulatable: false,
  group: 'tone',
  options: [
    { value: 0, label: 'Aus' },
    { value: 1, label: 'An' },
  ],
};

const SLICES: ParameterSchema = {
  id: 'sliceCount',
  label: 'Slices (Anzahl)',
  description: 'Bei „Slices“: in wie viele gleiche Stücke geteilt wird (falls keine Slice-Marker gesetzt sind).',
  domain: 'time',
  min: 1,
  max: 32,
  step: 1,
  defaultValue: 8,
  modulatable: true,
  group: 'melody',
};

const SLICE_ORDER: ParameterSchema = {
  id: 'sliceOrder',
  label: 'Slice-Reihenfolge',
  description: 'Der Reihe nach (Schritt im Rhythmus) oder zufällig.',
  domain: 'time',
  min: 0,
  max: 1,
  step: 1,
  defaultValue: 0,
  modulatable: false,
  group: 'melody',
  options: [
    { value: 0, label: 'Der Reihe nach' },
    { value: 1, label: 'Zufällig' },
  ],
};

const GAIN: ParameterSchema = {
  id: 'gain',
  label: 'Lautstärke',
  description: 'Pegel des Samples.',
  domain: 'timbre',
  min: 0,
  max: 2,
  defaultValue: 1,
  modulatable: true,
  group: 'tone',
};

const PARAMS: readonly ParameterSchema[] = [
  MODE,
  PITCH_SOURCE,
  OCTAVE,
  TUNE,
  FINE,
  START,
  LENGTH,
  BRIGHTNESS,
  REVERSE,
  LOOP,
  GAIN,
  ATTACK,
  DECAY,
  SUSTAIN_PARAM,
  ACCENT,
  SLICES,
  SLICE_ORDER,
];

interface SampleVoice {
  active: boolean;
  pos: number;
  rate: number;
  /** Region in source samples. */
  regionStart: number;
  regionEnd: number;
  loopStart: number;
  loopEnd: number;
  looping: boolean;
  reversed: boolean;
  env: number;
  attackInc: number;
  attacking: boolean;
  decayMul: number;
  amp: number;
  /** Short release fade when the voice is stolen / ends. */
  releasing: number;
  age: number;
}

function hermite(buf: Float32Array, pos: number): number {
  const i = pos | 0;
  const f = pos - i;
  const n = buf.length;
  const xm1 = buf[i > 0 ? i - 1 : 0]!;
  const x0 = buf[i]!;
  const x1 = buf[i + 1 < n ? i + 1 : n - 1]!;
  const x2 = buf[i + 2 < n ? i + 2 : n - 1]!;
  const c = (x1 - xm1) * 0.5;
  const v = x0 - x1;
  const w = c + v;
  const a = w + v + (x2 - x0) * 0.5;
  const b = w + a;
  return ((a * f - b) * f + c) * f + x0;
}

export class SamplePlayerVoice implements VoiceInstance {
  private readonly sr: number;
  private source: SampleSource | null = null;
  private region: SampleRegion | null = null;
  private readonly voices: SampleVoice[] = [];
  private noteCounter = 0;
  private lpL1 = 0;
  private lpL2 = 0;
  private lpR1 = 0;
  private lpR2 = 0;
  private holdActive = false;

  constructor(sampleRate: number) {
    this.sr = sampleRate > 0 ? sampleRate : 48000;
    for (let i = 0; i < MAX_VOICES; i++) {
      this.voices.push({
        active: false,
        pos: 0,
        rate: 1,
        regionStart: 0,
        regionEnd: 0,
        loopStart: 0,
        loopEnd: 0,
        looping: false,
        reversed: false,
        env: 0,
        attackInc: 1,
        attacking: false,
        decayMul: 1,
        amp: 0,
        releasing: 0,
        age: 0,
      });
    }
  }

  public attachSample(source: SampleSource | null, region: SampleRegion | null): void {
    this.source = source;
    this.region = region;
    for (const v of this.voices) v.active = false;
  }

  public reset(): void {
    for (const v of this.voices) v.active = false;
    this.noteCounter = 0;
    this.lpL1 = this.lpL2 = this.lpR1 = this.lpR2 = 0;
    this.holdActive = false;
  }

  private allocVoice(): SampleVoice {
    let best = this.voices[0]!;
    for (const v of this.voices) {
      if (!v.active) return v;
      if (v.age > best.age) best = v;
    }
    return best;
  }

  private trigger(
    note: number,
    params: Record<string, number>,
    velocity: number,
    sliceIndex: number,
    sliceCount: number,
  ): void {
    const src = this.source;
    const reg = this.region;
    if (!src || src.length < 4) return;
    const srcSr = src.sampleRate;
    const total = src.length;
    let rs = reg ? Math.max(0, Math.floor(reg.startSec * srcSr)) : 0;
    let re = reg ? Math.min(total - 2, Math.floor(reg.endSec * srcSr)) : total - 2;
    if (re <= rs + 4) {
      rs = 0;
      re = total - 2;
    }
    // Slices: explicit markers or equal parts of the region.
    if (sliceIndex >= 0) {
      const marks = reg?.slices && reg.slices.length > 0 ? reg.slices : null;
      if (marks) {
        const idx = sliceIndex % marks.length;
        const a = Math.max(rs, Math.floor(marks[idx]! * srcSr));
        const b = idx + 1 < marks.length ? Math.floor(marks[idx + 1]! * srcSr) : re;
        rs = a;
        re = Math.max(a + 4, Math.min(re, b));
      } else {
        const n = Math.max(1, sliceCount);
        const len = (re - rs) / n;
        const idx = sliceIndex % n;
        const a = rs + Math.floor(idx * len);
        re = Math.max(a + 4, rs + Math.floor((idx + 1) * len));
        rs = a;
      }
    }
    // Start / length controls inside the region.
    const span = re - rs;
    const startOff = Math.floor(readParam(START, params) * span * 0.98);
    const len = Math.max(4, Math.floor(readParam(LENGTH, params) * (span - startOff)));
    const a = rs + startOff;
    const b = Math.min(re, a + len);

    const root = reg ? reg.rootMidi : 60;
    const semis = note - root + readParam(TUNE, params) + readParam(FINE, params) / 100;
    const rate = Math.pow(2, semis / 12) * (srcSr / this.sr);

    const v = this.allocVoice();
    const reversed = readParam(REVERSE, params) >= 0.5;
    v.active = true;
    v.regionStart = a;
    v.regionEnd = b;
    v.reversed = reversed;
    v.pos = reversed ? b - 1 : a;
    v.rate = rate;
    v.looping = readParam(LOOP, params) >= 0.5;
    const lp = reg?.loop;
    v.loopStart = lp ? Math.max(a, Math.floor(lp.startSec * srcSr)) : a;
    v.loopEnd = lp ? Math.min(b, Math.floor(lp.endSec * srcSr)) : b;
    if (v.loopEnd - v.loopStart < 64) {
      v.loopStart = a;
      v.loopEnd = b;
    }
    const attackSec = Math.pow(readParam(ATTACK, params), 2) * 1.5;
    v.attackInc = attackSec > 0.0005 ? 1 / (attackSec * this.sr) : 1;
    v.attacking = true;
    v.env = v.attackInc >= 1 ? 1 : 0;
    const decay = readParam(DECAY, params);
    v.decayMul = decay >= 0.999 ? 1 : decayCoeff(0.02 + Math.pow(decay, 2) * 4, this.sr);
    v.amp = velocity;
    v.releasing = 0;
    v.age = 0;
    for (const o of this.voices) if (o !== v && o.active) o.age++;
  }

  public process(outL: Float32Array, outR: Float32Array, params: Record<string, number>, ctx: VoiceRenderContext): void {
    const n = Math.min(ctx.numSamples | 0, outL.length, outR.length);
    if (n <= 0) return;
    const src = this.source;
    const newTrig = detectNewTrigger(ctx);
    const mode = Math.round(readParam(MODE, params));
    const gain = readParam(GAIN, params);
    if (newTrig > 0 && src) {
      const accent = clamp01(ctx.timeFrame.accent ?? 0);
      const vel = (1 - readParam(ACCENT, params) * 0.6 + readParam(ACCENT, params) * 0.6 * accent) * (0.4 + 0.6 * newTrig);
      const octave = Math.round(readParam(OCTAVE, params)) * 12;
      const h = ctx.harmony;
      const root = this.region ? this.region.rootMidi : 60;
      if (mode === 0) {
        this.trigger(root + octave, params, vel, -1, 0);
      } else if (mode === 2) {
        if (!h.bassRest) {
          const bass = Number.isFinite(h.bassMidi) ? h.bassMidi! : h.rootMidi;
          this.trigger(bass + octave, params, vel, -1, 0);
        }
      } else if (mode === 3) {
        const count = Math.round(readParam(SLICES, params));
        const order = Math.round(readParam(SLICE_ORDER, params));
        const step = Number.isFinite(ctx.timeFrame.stepIndex) ? (ctx.timeFrame.stepIndex as number) : this.noteCounter;
        const idx = order === 1 ? Math.floor(((Math.sin(this.noteCounter * 12.9898) * 43758.5453) % 1 + 1) % 1 * 997) : step;
        this.trigger(root + octave, params, vel, Math.max(0, idx), count);
      } else {
        const source = Math.round(readParam(PITCH_SOURCE, params));
        const chord = h.chordNotesMidi;
        if (source === 2 && chord.length > 0) {
          for (let k = 0; k < chord.length && k < 6; k++) this.trigger(chord[k]! + octave, params, vel * 0.7, -1, 0);
        } else if (source === 1 && chord.length > 0) {
          this.trigger(chord[this.noteCounter % chord.length]! + octave, params, vel, -1, 0);
        } else {
          this.trigger(h.rootMidi + 24 + octave, params, vel, -1, 0);
        }
      }
      this.noteCounter++;
    }

    // Hold (sustain) while the note is held in the rhythm grid.
    const sustain = readParam(SUSTAIN_PARAM, params);
    const gate = ctx.timeFrame.gate;
    const open = gate !== undefined && gate > 0.5;
    if (newTrig > 0 && open) this.holdActive = true;
    if (!open) this.holdActive = false;
    const holdFloor = this.holdActive && sustain > 1e-4 ? sustain : 0;

    // Low-pass (2-pole) coefficient
    const bright = readParam(BRIGHTNESS, params);
    const cutoff = 60 * Math.pow(20000 / 60, bright);
    const g = Math.min(0.99, 1 - Math.exp((-2 * Math.PI * cutoff) / this.sr));
    const filterOn = bright < 0.995;

    if (!src) {
      return;
    }
    const L = src.left;
    const R = src.right;
    const releaseStep = 1 / Math.max(1, 0.004 * this.sr);
    for (let vi = 0; vi < MAX_VOICES; vi++) {
      const v = this.voices[vi]!;
      if (!v.active) continue;
      for (let i = 0; i < n; i++) {
        // envelope
        if (v.attacking) {
          v.env += v.attackInc;
          if (v.env >= 1) {
            v.env = 1;
            v.attacking = false;
          }
        } else if (v.decayMul < 1) {
          const floor = holdFloor;
          v.env = floor + (v.env - floor) * v.decayMul;
        }
        let pos = v.pos;
        // end / loop handling
        if (!v.reversed) {
          if (pos >= v.regionEnd - 1) {
            if (v.looping && holdFloor > 0) pos = v.loopStart + (pos - v.loopEnd);
            else if (v.looping && v.decayMul < 1) pos = v.loopStart + (pos - v.loopEnd);
            else v.releasing = v.releasing > 0 ? v.releasing : 1;
          } else if (v.looping && pos >= v.loopEnd) {
            pos = v.loopStart + (pos - v.loopEnd);
          }
        } else if (pos <= v.regionStart + 1) {
          if (v.looping) pos = v.loopEnd - 1 - (v.regionStart - pos);
          else v.releasing = v.releasing > 0 ? v.releasing : 1;
        }
        if (pos < 0 || pos >= src.length - 2) {
          v.active = false;
          break;
        }
        let e = v.env * v.amp;
        if (v.releasing > 0) {
          e *= v.releasing;
          v.releasing -= releaseStep;
          if (v.releasing <= 0) {
            v.active = false;
            break;
          }
        }
        if (e < 1e-5 && !v.attacking) {
          v.active = false;
          break;
        }
        outL[i]! += hermite(L, pos) * e;
        outR[i]! += hermite(R, pos) * e;
        v.pos = pos + (v.reversed ? -v.rate : v.rate);
      }
    }

    for (let i = 0; i < n; i++) {
      let l = outL[i]! * gain;
      let r = outR[i]! * gain;
      if (filterOn) {
        this.lpL1 += g * (l - this.lpL1);
        this.lpL2 += g * (this.lpL1 - this.lpL2);
        this.lpR1 += g * (r - this.lpR1);
        this.lpR2 += g * (this.lpR1 - this.lpR2);
        l = this.lpL2;
        r = this.lpR2;
      }
      outL[i] = l;
      outR[i] = r;
    }
  }
}

export const samplePlayerVoiceModule: VoiceModule = {
  id: 'sample-player',
  version: 1,
  category: 'harmony',
  displayName: 'Sample-Instrument',
  description: 'Spielt eigene Aufnahmen oder Dateien – als Drum-Hit, in der Tonart, als Bass oder in Stücken (Slices).',
  parameters: PARAMS,
  createInstance(sampleRate: number): VoiceInstance {
    return new SamplePlayerVoice(sampleRate);
  },
};
