import type { CycleUnit } from '../theory/cycles';
import { wrapPhase01 } from './waves';

export interface CurvePoint {
  readonly x: number;
  readonly y: number;
}

export interface DrawnCurveData {
  readonly id: string;
  readonly name: string;
  readonly points: readonly CurvePoint[];
  readonly cycleValue: number;
  readonly cycleUnit: CycleUnit;
  readonly snapDivision: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/**
 * Evaluates a user-drawn periodic curve at phase01 in [0, 1), using smooth
 * Catmull-Rom interpolation across sorted points with seamless wrap-around at 0/1.
 * Result is guaranteed to be in [0, 1].
 */
export function evaluateDrawnCurve(
  points: readonly CurvePoint[],
  phase01: number,
): number {
  if (points.length === 0) return 0.5;
  if (points.length === 1) {
    const only = points[0];
    return only ? clamp01(only.y) : 0.5;
  }

  const sorted = points
    .map((pt) => ({ x: clamp01(pt.x), y: clamp01(pt.y) }))
    .sort((a, b) => a.x - b.x);

  // Deduplicate points that share virtually identical x coordinates.
  const clean: { x: number; y: number }[] = [];
  for (const pt of sorted) {
    const prev = clean[clean.length - 1];
    if (!prev || pt.x - prev.x > 1e-5) {
      clean.push(pt);
    } else {
      clean[clean.length - 1] = pt;
    }
  }

  if (clean.length === 1) {
    const only = clean[0];
    return only ? only.y : 0.5;
  }

  const first = clean[0]!;
  const last = clean[clean.length - 1]!;
  const n = clean.length;

  // Build periodic extension around [0, 1] so boundary tangents wrap seamlessly.
  const extended: { x: number; y: number }[] = [];
  const prevWrap = clean[n - 2]!;
  if (first.x > 1e-5 || last.x < 0.99999) {
    extended.push({ x: prevWrap.x - 1, y: prevWrap.y });
    extended.push({ x: last.x - 1, y: last.y });
  } else {
    // When points sit at both x=0 and x=1, wrap from earlier points to avoid x=0 collisions.
    if (n >= 3) {
      extended.push({ x: clean[n - 3]!.x - 1, y: clean[n - 3]!.y });
    }
    extended.push({ x: prevWrap.x - 1, y: prevWrap.y });
  }

  for (const pt of clean) {
    extended.push(pt);
  }

  const second = clean[1]!;
  if (last.x < 0.99999) {
    extended.push({ x: first.x + 1, y: first.y });
    extended.push({ x: second.x + 1, y: second.y });
  } else {
    if (first.x > 1e-5) {
      extended.push({ x: first.x + 1, y: first.y });
    }
    extended.push({ x: second.x + 1, y: second.y });
    const third = clean[2] ?? second;
    extended.push({ x: third.x + 1, y: third.y });
  }

  // Re-sort & deduplicate extended array to guarantee strictly increasing x.
  extended.sort((a, b) => a.x - b.x);
  const ext: { x: number; y: number }[] = [];
  for (const pt of extended) {
    const prev = ext[ext.length - 1];
    if (!prev || pt.x - prev.x > 1e-5) {
      ext.push(pt);
    }
  }

  const p = wrapPhase01(phase01);

  for (let i = 0; i < ext.length - 1; i++) {
    const p1 = ext[i]!;
    const p2 = ext[i + 1]!;
    if (p >= p1.x && p <= p2.x) {
      const span = p2.x - p1.x;
      const t = span > 1e-6 ? (p - p1.x) / span : 0;
      const p0 = ext[Math.max(0, i - 1)]!;
      const p3 = ext[Math.min(ext.length - 1, i + 2)]!;
      return clamp01(catmullRom(p0.y, p1.y, p2.y, p3.y, t));
    }
  }

  return clamp01(last.y);
}

export const DEFAULT_CURVE_PRESETS: readonly DrawnCurveData[] = [
  {
    id: 'gentle_rise',
    name: 'Sanfter Aufstieg',
    points: [
      { x: 0, y: 0.1 },
      { x: 0.35, y: 0.25 },
      { x: 0.7, y: 0.65 },
      { x: 0.95, y: 0.9 },
    ],
    cycleValue: 4,
    cycleUnit: 'bars',
    snapDivision: 8,
  },
  {
    id: 'offbeat_pump',
    name: 'Offbeat-Pump',
    points: [
      { x: 0, y: 0.05 },
      { x: 0.25, y: 0.45 },
      { x: 0.5, y: 0.95 },
      { x: 0.75, y: 0.55 },
    ],
    cycleValue: 1,
    cycleUnit: 'beats',
    snapDivision: 16,
  },
  {
    id: 'peak_drop',
    name: 'Spannungs-Peak & Drop',
    points: [
      { x: 0, y: 0.2 },
      { x: 0.5, y: 0.45 },
      { x: 0.75, y: 0.98 },
      { x: 0.85, y: 0.12 },
    ],
    cycleValue: 8,
    cycleUnit: 'bars',
    snapDivision: 8,
  },
  {
    id: 'triplet_wave',
    name: 'Triolen-Welle',
    points: [
      { x: 0, y: 0.15 },
      { x: 0.167, y: 0.85 },
      { x: 0.333, y: 0.2 },
      { x: 0.5, y: 0.9 },
      { x: 0.667, y: 0.25 },
      { x: 0.833, y: 0.8 },
    ],
    cycleValue: 2,
    cycleUnit: 'beats',
    snapDivision: 12,
  },
  {
    id: 'fast_to_slow_arc',
    name: 'Schnell-zu-Langsam-Bogen',
    points: [
      { x: 0, y: 0.15 },
      { x: 0.15, y: 0.88 },
      { x: 0.45, y: 0.72 },
      { x: 0.8, y: 0.32 },
    ],
    cycleValue: 2,
    cycleUnit: 'bars',
    snapDivision: 8,
  },
];
