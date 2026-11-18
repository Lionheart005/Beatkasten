import type { ParameterSchema, VoiceRenderContext } from '../../registry/types';

/** Liest einen Parameter, klemmt ihn auf die Schema-Grenzen und rastet `step` ein. */
export function readParam(schema: ParameterSchema, params: Record<string, number>): number {
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

/** Rationale tanh-Näherung (weich, billig). */
export function fastTanh(x: number): number {
  if (x <= -3) return -1;
  if (x >= 3) return 1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Erkennt eine neue Anschlag-Flanke (identisch zu den bestehenden Voices). */
export function detectNewTrigger(ctx: VoiceRenderContext): number {
  const trig = Number.isFinite(ctx.timeFrame.triggerIntensity)
    ? clamp01(ctx.timeFrame.triggerIntensity)
    : 0;
  const prevTrig = Number.isFinite(ctx.prevPulseTrigger) ? ctx.prevPulseTrigger : 0;
  return trig > 0.01 && prevTrig <= 0.01 ? trig : 0;
}

/**
 * Gemeinsamer Regler aller Anschlag-Instrumente: Wie laut der Ton stehen bleibt,
 * solange die Note gehalten wird (Ton-Länge / Haltebögen im Rhythmus-Raster).
 */
export const SUSTAIN_PARAM: ParameterSchema = {
  id: 'sustain',
  label: 'Halten (Sustain)',
  description:
    'Wie laut der Ton stehen bleibt, solange die Note gehalten wird (Ton-Länge / Haltebögen im Rhythmus-Raster). 0 = klingt frei aus wie bisher, 1 = bleibt voll stehen bis zum Loslassen.',
  domain: 'timbre',
  min: 0,
  max: 1,
  defaultValue: 0,
  curve: 'linear',
  modulatable: true,
  group: 'envelope',
};

/**
 * Halte-Logik für Anschlag-Hüllkurven: liefert die Untergrenze der Amplitude,
 * solange die angeschlagene Note gehalten wird (0 = freies Ausklingen).
 */
export class NoteHold {
  private active = false;

  public reset(): void {
    this.active = false;
  }

  /** Einmal pro Block aufrufen (nach der Trigger-Erkennung). */
  public floor(ctx: VoiceRenderContext, newTrig: number, sustain: number, level: number): number {
    const gate = ctx.timeFrame.gate;
    const open = gate !== undefined && gate > 0.5;
    if (newTrig > 0 && open) this.active = true;
    if (!open) this.active = false;
    return this.active && sustain > 1e-4 ? sustain * level : 0;
  }
}

/** Zeitkonstante (Sekunden) → Multiplikator pro Sample. */
export function decayCoeff(tauSeconds: number, sampleRate: number): number {
  return Math.exp(-1 / (Math.max(1e-4, tauSeconds) * sampleRate));
}

/**
 * Faltet die Tonleiter (beliebige MIDI-Noten) in einen 3-Oktaven-Tonvorrat ab `baseMidi`.
 * Gibt die Anzahl der Töne zurück (zero alloc).
 */
export function foldScaleInto(
  scaleNotesMidi: readonly number[],
  baseMidi: number,
  out: Float64Array,
): number {
  let pcMask = 0;
  for (let i = 0; i < scaleNotesMidi.length; i++) {
    const m = scaleNotesMidi[i]!;
    if (!Number.isFinite(m)) continue;
    pcMask |= 1 << ((((Math.round(m) - baseMidi) % 12) + 12) % 12);
  }
  if (pcMask === 0) {
    pcMask = (1 << 0) | (1 << 2) | (1 << 3) | (1 << 5) | (1 << 7) | (1 << 8) | (1 << 10);
  }
  let count = 0;
  for (let oct = 0; oct < 3 && count < out.length; oct++) {
    for (let semi = 0; semi < 12 && count < out.length; semi++) {
      if ((pcMask & (1 << semi)) !== 0) out[count++] = baseMidi + oct * 12 + semi;
    }
  }
  if (count === 0) {
    out[0] = baseMidi;
    return 1;
  }
  return count;
}

/**
 * Schätzt die Tempo-Geschwindigkeit (Beats pro Sample) aus dem Fortschritt von
 * `ctx.beatPosition` zwischen zwei Blöcken – Voices kennen das BPM nicht direkt.
 */
export class BeatTracker {
  private lastBeat = Number.NaN;
  private lastSamples = 0;
  public beatsPerSample: number;

  constructor(sampleRate: number) {
    this.beatsPerSample = 128 / 60 / sampleRate;
  }

  public reset(): void {
    this.lastBeat = Number.NaN;
    this.lastSamples = 0;
  }

  public update(ctx: VoiceRenderContext): number {
    const b = ctx.beatPosition;
    if (Number.isFinite(b) && Number.isFinite(this.lastBeat) && this.lastSamples > 0) {
      const d = (b - this.lastBeat) / this.lastSamples;
      // nur plausible Werte (20–300 BPM) übernehmen – Sprünge (Seek/Loop) ignorieren
      const minBps = 20 / 60 / ctx.sampleRate;
      const maxBps = 300 / 60 / ctx.sampleRate;
      if (d >= minBps && d <= maxBps) this.beatsPerSample += 0.5 * (d - this.beatsPerSample);
    }
    this.lastBeat = b;
    this.lastSamples = Math.max(0, ctx.numSamples | 0);
    return this.beatsPerSample;
  }
}

/** Verzerrungs-Arten für harte Bässe & Kicks. */
export const DIST_MODE_OPTIONS = [
  { value: 0, label: 'Weich (Sättigung)' },
  { value: 1, label: 'Hart (Clipping)' },
  { value: 2, label: 'Gebrochen (Wavefold)' },
  { value: 3, label: 'Röhre (asymmetrisch)' },
  { value: 4, label: 'Digital (Bitcrusher)' },
] as const;

/**
 * Formt ein Sample nach Verzerrungs-Art (Eingang schon verstärkt). Modus 4 (Bitcrusher)
 * quantisiert nur die Amplitude; das Sample-Halten passiert in der Voice.
 */
export function distort(x: number, mode: number): number {
  switch (mode) {
    case 1:
      return x > 1 ? 1 : x < -1 ? -1 : x;
    case 2: {
      // sinusförmiges Zurückfalten: lauter = mehr Obertöne statt mehr Pegel
      return Math.sin(x * 1.5707963);
    }
    case 3:
      return fastTanh(x + 0.4) - 0.3799;
    case 4: {
      const c = x > 1 ? 1 : x < -1 ? -1 : x;
      return Math.round(c * 12) / 12;
    }
    default:
      return fastTanh(x);
  }
}
