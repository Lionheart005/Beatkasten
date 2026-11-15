import { wrapPhase01 } from './waves';

const TWO_PI = Math.PI * 2;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function clampBipolar(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= -1) return -1;
  if (value >= 1) return 1;
  return value;
}

/**
 * Non-linearly warps phase01 in [0, 1) using warpAmount in [-1, 1],
 * mapped to an exponent gamma in [0.28, 3.2]. Strictly monotonic on [0, 1).
 */
export function warpPhase(phase01: number, warpAmount: number): number {
  const p = wrapPhase01(phase01);
  const w = clampBipolar(warpAmount);
  const gamma = w < 0 ? Math.pow(0.28, -w) : Math.pow(3.2, w);
  return wrapPhase01(Math.pow(p, gamma));
}

/**
 * Computes normalized interference energy in [0, 1] from two phase-locked cosine oscillators
 * with frequencies freqA and freqB, blend mix, phaseOffset, and threshold gate.
 * Cosine alignment places beat 1 (p = 0) and every k / freqA subdivision at peak +1.0.
 */
export function interferenceEnergy(
  phase01: number,
  freqA: number,
  freqB: number,
  mix: number,
  phaseOffset: number,
  threshold: number,
): number {
  const p = wrapPhase01(phase01);
  const fA = Number.isFinite(freqA) ? freqA : 1;
  const fB = Number.isFinite(freqB) ? freqB : 1;
  const offset = Number.isFinite(phaseOffset) ? phaseOffset : 0;
  const m = clamp01(mix);
  const thresh = clamp01(threshold);

  const a = Math.cos(TWO_PI * (p * fA));
  const unipolar =
    m <= 0.0001
      ? clamp01(0.5 * (a + 1))
      : clamp01(
          0.5 * ((1 - m) * a + m * Math.cos(TWO_PI * (p * fB - offset)) + 1),
        );

  if (thresh >= 0.9999) return 0;
  return clamp01((unipolar - thresh) / (1 - thresh));
}

/**
 * Computes the analytical derivative of the unipolar interference wave with respect
 * to phase01 (up to a positive constant PI) for zero-crossing peak detection.
 */
export function interferenceSlope(
  phase01: number,
  freqA: number,
  freqB: number,
  mix: number,
  phaseOffset: number,
): number {
  const p = wrapPhase01(phase01);
  const fA = Number.isFinite(freqA) ? freqA : 1;
  const fB = Number.isFinite(freqB) ? freqB : 1;
  const offset = Number.isFinite(phaseOffset) ? phaseOffset : 0;
  const m = clamp01(mix);

  if (m <= 0.0001) {
    return -fA * Math.sin(TWO_PI * (p * fA));
  }
  return (
    -(1 - m) * fA * Math.sin(TWO_PI * (p * fA)) -
    m * fB * Math.sin(TWO_PI * (p * fB - offset))
  );
}

/**
 * Smoothly pulls phase01 toward a rhythmic grid of `subdivisions` (e.g. downbeat,
 * offbeat, triplet, quintuplet) shifted by `phaseShift` with `strength` in [0, 1].
 */
export function gridGravityPull(
  phase01: number,
  subdivisions: number,
  phaseShift: number,
  strength: number,
): number {
  const p = wrapPhase01(phase01);
  const sub =
    Number.isFinite(subdivisions) && subdivisions >= 1
      ? Math.round(subdivisions)
      : 1;
  const shift = Number.isFinite(phaseShift) ? phaseShift : 0;
  const s = clamp01(strength);

  const shifted = wrapPhase01(p - shift);
  const scaled = shifted * sub;
  const cell = Math.floor(scaled);
  const frac = scaled - cell;

  // Monotonically non-decreasing smooth attraction towards integer grid lines for s in [0, 1].
  const pulledFrac = frac - (s / TWO_PI) * Math.sin(TWO_PI * frac);
  const pulledShifted = (cell + pulledFrac) / sub;
  return wrapPhase01(pulledShifted + shift);
}

/**
 * Computes the cumulative phase/step drift offset for a given cycleIndex,
 * optionally wrapping every `resetCycles` cycles.
 */
export function phaseDriftOffset(
  cycleIndex: number,
  driftStepsPerCycle: number,
  resetCycles: number,
): number {
  if (!Number.isFinite(cycleIndex) || !Number.isFinite(driftStepsPerCycle)) {
    return 0;
  }
  const idx = Math.floor(cycleIndex);
  if (Number.isFinite(resetCycles) && resetCycles >= 1) {
    const period = Math.floor(resetCycles);
    const wrapped = ((idx % period) + period) % period;
    return wrapped * driftStepsPerCycle;
  }
  return idx * driftStepsPerCycle;
}
