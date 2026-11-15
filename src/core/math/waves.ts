export type WaveformType =
  | 'sine'
  | 'cosine'
  | 'triangle'
  | 'ramp-up'
  | 'ramp-down'
  | 'soft-pulse';

const TWO_PI = Math.PI * 2;
const SOFT_PULSE_NORM = Math.tanh(2.5);

/**
 * Wraps any real phase value into the half-open interval [0, 1).
 */
export function wrapPhase01(p: number): number {
  if (!Number.isFinite(p)) return 0;
  const wrapped = p - Math.floor(p);
  return wrapped >= 1 ? 0 : wrapped;
}

/**
 * Evaluates a periodic waveform at phase01 in [0, 1), returning a bipolar value in [-1, 1].
 */
export function evaluateWaveBipolar(
  waveform: WaveformType,
  phase01: number,
): number {
  const p = wrapPhase01(phase01);

  switch (waveform) {
    case 'sine':
      return Math.sin(p * TWO_PI);
    case 'cosine':
      return Math.cos(p * TWO_PI);
    case 'triangle':
      if (p < 0.25) return p * 4;
      if (p < 0.75) return 2 - p * 4;
      return p * 4 - 4;
    case 'ramp-up':
      return 2 * p - 1;
    case 'ramp-down':
      return 1 - 2 * p;
    case 'soft-pulse':
      return Math.tanh(2.5 * Math.sin(p * TWO_PI)) / SOFT_PULSE_NORM;
  }
}

/**
 * Evaluates a periodic waveform at phase01 in [0, 1), returning a unipolar value in [0, 1].
 */
export function evaluateWaveUnipolar(
  waveform: WaveformType,
  phase01: number,
): number {
  const bipolar = evaluateWaveBipolar(waveform, phase01);
  const unipolar = 0.5 * (bipolar + 1);
  if (unipolar <= 0) return 0;
  if (unipolar >= 1) return 1;
  return unipolar;
}
