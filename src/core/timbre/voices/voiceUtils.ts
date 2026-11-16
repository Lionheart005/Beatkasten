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
