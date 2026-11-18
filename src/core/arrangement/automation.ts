/**
 * Keyframe automation in song time (absolute values, never repeating).
 * Curve of a point = interpolation from that point to the next:
 *  - linear
 *  - smooth: monotone cubic (Fritsch–Carlson, no overshoot)
 *  - hold:   step (value stays until the next point)
 *  - exp:    geometric (for frequency-like controls; falls back to linear
 *            when the values have different signs or touch zero)
 * Before the first point its value applies, after the last point the last value.
 */
import type { Keyframe, KeyframeCurve } from './types';

const CURVE_CODE: Readonly<Record<KeyframeCurve, number>> = {
  linear: 0,
  smooth: 1,
  hold: 2,
  exp: 3,
};

export const KEYFRAME_CURVE_LABELS: Readonly<Record<KeyframeCurve, string>> = {
  linear: 'Linear',
  smooth: 'Weich',
  hold: 'Halten (Stufe)',
  exp: 'Exponentiell',
};

/** Pre-compiled, allocation-free evaluator with a moving cursor. */
export class LaneEvaluator {
  private readonly beats: Float64Array;
  private readonly values: Float64Array;
  private readonly curves: Uint8Array;
  private readonly tangents: Float64Array;
  private readonly min: number;
  private readonly max: number;
  private cursor = 0;

  constructor(points: readonly Keyframe[], min = -Infinity, max = Infinity) {
    const sorted = points
      .filter((p) => Number.isFinite(p.beat) && Number.isFinite(p.value))
      .slice()
      .sort((a, b) => a.beat - b.beat);
    const n = sorted.length;
    this.beats = new Float64Array(n);
    this.values = new Float64Array(n);
    this.curves = new Uint8Array(n);
    this.tangents = new Float64Array(n);
    this.min = min;
    this.max = max;
    for (let i = 0; i < n; i++) {
      const p = sorted[i]!;
      this.beats[i] = p.beat;
      this.values[i] = Math.min(max, Math.max(min, p.value));
      this.curves[i] = CURVE_CODE[p.curve] ?? 0;
    }
    computeMonotoneTangents(this.beats, this.values, this.tangents);
  }

  public get pointCount(): number {
    return this.beats.length;
  }

  public value(beat: number): number {
    const b = this.beats;
    const n = b.length;
    if (n === 0) return NaN;
    if (beat <= b[0]!) return this.values[0]!;
    if (beat >= b[n - 1]!) return this.values[n - 1]!;
    // Moving cursor: usually the same or the next segment.
    let i = this.cursor;
    if (i >= n - 1 || beat < b[i]! || beat >= b[i + 1]!) {
      if (i + 2 < n && beat >= b[i + 1]! && beat < b[i + 2]!) {
        i += 1;
      } else {
        let lo = 0;
        let hi = n - 2;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (b[mid]! <= beat) lo = mid;
          else hi = mid - 1;
        }
        i = lo;
      }
      this.cursor = i;
    }
    return interpolate(
      this.curves[i]!,
      b[i]!,
      b[i + 1]!,
      this.values[i]!,
      this.values[i + 1]!,
      this.tangents[i]!,
      this.tangents[i + 1]!,
      beat,
      this.min,
      this.max,
    );
  }
}

function interpolate(
  curve: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  m0: number,
  m1: number,
  x: number,
  min: number,
  max: number,
): number {
  const h = x1 - x0;
  if (h <= 0) return y1;
  const t = (x - x0) / h;
  let v: number;
  switch (curve) {
    case 2:
      v = y0;
      break;
    case 3:
      if (y0 > 0 && y1 > 0) v = y0 * Math.pow(y1 / y0, t);
      else if (y0 < 0 && y1 < 0) v = -(-y0 * Math.pow(y1 / y0, t));
      else v = y0 + (y1 - y0) * t;
      break;
    case 1: {
      const t2 = t * t;
      const t3 = t2 * t;
      v =
        (2 * t3 - 3 * t2 + 1) * y0 +
        (t3 - 2 * t2 + t) * h * m0 +
        (-2 * t3 + 3 * t2) * y1 +
        (t3 - t2) * h * m1;
      break;
    }
    default:
      v = y0 + (y1 - y0) * t;
  }
  return v < min ? min : v > max ? max : v;
}

/** Fritsch–Carlson tangents: the cubic never overshoots between two points. */
function computeMonotoneTangents(x: Float64Array, y: Float64Array, out: Float64Array): void {
  const n = x.length;
  if (n < 2) {
    if (n === 1) out[0] = 0;
    return;
  }
  const d = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const h = x[i + 1]! - x[i]!;
    d[i] = h > 0 ? (y[i + 1]! - y[i]!) / h : 0;
  }
  out[0] = d[0]!;
  out[n - 1] = d[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    out[i] = d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      out[i] = 0;
      out[i + 1] = 0;
      continue;
    }
    const a = out[i]! / d[i]!;
    const b = out[i + 1]! / d[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      out[i] = tau * a * d[i]!;
      out[i + 1] = tau * b * d[i]!;
    }
  }
}

/** Convenience (allocates an evaluator): value of a keyframe list at `beat`. */
export function evaluateKeyframes(
  points: readonly Keyframe[],
  beat: number,
  min = -Infinity,
  max = Infinity,
): number {
  return new LaneEvaluator(points, min, max).value(beat);
}

/** Inserts or replaces a keyframe (sorted, one point per beat). */
export function upsertKeyframe(points: readonly Keyframe[], kf: Keyframe): Keyframe[] {
  const out = points.filter((p) => Math.abs(p.beat - kf.beat) > 1e-9);
  out.push(kf);
  return out.sort((a, b) => a.beat - b.beat);
}
