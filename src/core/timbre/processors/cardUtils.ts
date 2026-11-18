import type { ParameterSchema } from '../../registry/types';

/** Reads + clamps (+ step-snaps) a card parameter. */
export function readCardParam(schema: ParameterSchema, params: Record<string, number>): number {
  const raw = params[schema.id];
  const v = raw !== undefined && Number.isFinite(raw) ? raw : schema.defaultValue;
  const c = v < schema.min ? schema.min : v > schema.max ? schema.max : v;
  const step = schema.step;
  if (step === undefined || step <= 0) return c;
  const s = schema.min + Math.round((c - schema.min) / step) * step;
  return s < schema.min ? schema.min : s > schema.max ? schema.max : s;
}

/** Linear interpolation read from a ring buffer at a fractional position. */
export function ringRead(buf: Float32Array, pos: number): number {
  const n = buf.length;
  let p = pos % n;
  if (p < 0) p += n;
  const i0 = p | 0;
  const i1 = i0 + 1 >= n ? 0 : i0 + 1;
  const f = p - i0;
  return buf[i0]! + (buf[i1]! - buf[i0]!) * f;
}
