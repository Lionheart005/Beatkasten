export type CycleUnit = 'beats' | 'bars';

const MAX_CYCLE_LCM = 1_000_000;
const BEAT_LCM_PRECISION = 1200;

/**
 * Computes the greatest common divisor of two integers (always >= 1).
 */
export function gcd(a: number, b: number): number {
  let x = Number.isFinite(a) ? Math.abs(Math.round(a)) : 0;
  let y = Number.isFinite(b) ? Math.abs(Math.round(b)) : 0;

  if (x === 0 && y === 0) return 1;
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return Math.max(1, x);
}

/**
 * Computes the least common multiple of two positive integers (always >= 1),
 * using BigInt internally and capping at MAX_CYCLE_LCM for safety.
 */
export function lcm(a: number, b: number): number {
  const x = Number.isFinite(a) ? Math.abs(Math.round(a)) : 0;
  const y = Number.isFinite(b) ? Math.abs(Math.round(b)) : 0;
  if (x === 0 || y === 0) return 1;

  const divisor = BigInt(gcd(x, y));
  const product = (BigInt(x) / divisor) * BigInt(y);
  const capped = product > BigInt(MAX_CYCLE_LCM) ? BigInt(MAX_CYCLE_LCM) : product;
  return Math.max(1, Number(capped));
}

/**
 * Converts a cycle duration in beats or bars into beats.
 */
export function cycleToBeats(
  value: number,
  unit: CycleUnit,
  beatsPerBar: number,
): number {
  const safeValue = Number.isFinite(value) && value > 0 ? value : 1;
  const safeBeatsPerBar =
    Number.isFinite(beatsPerBar) && beatsPerBar > 0 ? beatsPerBar : 4;
  return unit === 'bars' ? safeValue * safeBeatsPerBar : safeValue;
}

/**
 * Computes the combined polymetric cycle length in beats for a layer and an
 * optional modulation cycle, supporting fractional beat durations cleanly.
 */
export function computeCombinedCycleBeats(
  layerCycleBeats: number,
  modulationCycleBeats?: number,
): number {
  const safeLayer =
    Number.isFinite(layerCycleBeats) && layerCycleBeats > 0 ? layerCycleBeats : 4;

  if (
    modulationCycleBeats === undefined ||
    !Number.isFinite(modulationCycleBeats) ||
    modulationCycleBeats <= 0
  ) {
    return safeLayer;
  }

  const scaledA = Math.max(1, Math.round(safeLayer * BEAT_LCM_PRECISION));
  const scaledB = Math.max(1, Math.round(modulationCycleBeats * BEAT_LCM_PRECISION));
  const combinedScaled = lcm(scaledA, scaledB);
  return combinedScaled / BEAT_LCM_PRECISION;
}
