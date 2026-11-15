import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CURVE_PRESETS,
  evaluateDrawnCurve,
  gridGravityPull,
  interferenceEnergy,
  phaseDriftOffset,
  warpPhase,
} from '../../src/core/math';
import {
  computeCombinedCycleBeats,
  computeHarmonyFrame,
  cycleToBeats,
  gcd,
  lcm,
  normalizePitchClass,
  PROGRESSION_PRESETS,
  quantizeToScale,
  SCALE_DEFINITIONS,
  type ScaleId,
} from '../../src/core/theory';

describe('Theory & Scales', () => {
  it('quantizeToScale always maps arbitrary MIDI floats into the exact target scale', () => {
    const scaleIds = Object.keys(SCALE_DEFINITIONS) as ScaleId[];
    const roots = [0, 4, 9, 11];

    for (const scaleId of scaleIds) {
      const intervals = new Set(SCALE_DEFINITIONS[scaleId].intervals);
      for (const root of roots) {
        for (let midi = 24; midi <= 96; midi += 0.37) {
          const quantized = quantizeToScale(midi, root, scaleId);
          expect(Number.isInteger(quantized)).toBe(true);
          const pitchClass = (((quantized - root) % 12) + 12) % 12;
          expect(intervals.has(pitchClass)).toBe(true);
        }
      }
    }

    // Non-finite input falls back cleanly to a scale note
    const fallback = quantizeToScale(Number.NaN, 9, 'natural_minor');
    expect(Number.isFinite(fallback)).toBe(true);
    expect(normalizePitchClass(fallback - 9)).toBe(0);
  });

  it('computeHarmonyFrame produces scale-locked notes across all bars and progressions', () => {
    const scaleIds = Object.keys(SCALE_DEFINITIONS) as ScaleId[];
    const progressions = Object.keys(PROGRESSION_PRESETS);

    for (const scaleId of scaleIds) {
      const intervals = new Set(SCALE_DEFINITIONS[scaleId].intervals);
      for (const progId of progressions) {
        for (let bar = 0; bar < 8; bar += 1) {
          const frame = computeHarmonyFrame(9, scaleId, 'minor7', progId, bar);
          expect(frame.scaleNotesMidi.length).toBeGreaterThan(0);
          expect(frame.chordNotesMidi.length).toBeGreaterThan(0);

          for (const note of frame.scaleNotesMidi) {
            const pc = (((note - frame.rootNote) % 12) + 12) % 12;
            expect(intervals.has(pc)).toBe(true);
          }
        }
      }
    }
  });
});

describe('Polymetric Cycles (GCD / LCM)', () => {
  it('computes gcd and lcm accurately including 3 vs 4 vs 5 vs 7', () => {
    expect(gcd(12, 8)).toBe(4);
    expect(gcd(5, 7)).toBe(1);
    expect(lcm(3, 4)).toBe(12);
    expect(lcm(4, 6)).toBe(12);
    expect(lcm(lcm(3, 4), 5)).toBe(60);
    expect(lcm(lcm(lcm(3, 4), 5), 7)).toBe(420);
  });

  it('computeCombinedCycleBeats combines integer and fractional polymetric cycles', () => {
    expect(computeCombinedCycleBeats(3, 4)).toBe(12);
    expect(computeCombinedCycleBeats(12, 5)).toBe(60);
    expect(computeCombinedCycleBeats(60, 7)).toBe(420);
    expect(computeCombinedCycleBeats(1.5, 4)).toBe(12);
    expect(computeCombinedCycleBeats(5)).toBe(5);
    expect(cycleToBeats(8, 'bars', 4)).toBe(32);
    expect(cycleToBeats(5, 'beats', 4)).toBe(5);
  });
});

describe('Phase & Time Math', () => {
  it('warpPhase is strictly monotonic on [0, 1) and stays bounded in [0, 1)', () => {
    const warpAmounts = [-1, -0.65, -0.2, 0, 0.25, 0.7, 1];
    const samples = 200;

    for (const warp of warpAmounts) {
      let prev = -1;
      for (let i = 0; i < samples; i += 1) {
        const p = i / samples;
        const warped = warpPhase(p, warp);
        expect(warped).toBeGreaterThanOrEqual(0);
        expect(warped).toBeLessThan(1);
        expect(warped).toBeGreaterThan(prev);
        prev = warped;
      }
    }
  });

  it('interferenceEnergy always stays within [0, 1]', () => {
    const mixes = [0, 0.25, 0.5, 1];
    const thresholds = [0, 0.3, 0.7, 1];

    for (const mix of mixes) {
      for (const thresh of thresholds) {
        for (let i = 0; i < 120; i += 1) {
          const p = i / 120;
          const e = interferenceEnergy(p, 5, 3, mix, 0.125, thresh);
          expect(Number.isFinite(e)).toBe(true);
          expect(e).toBeGreaterThanOrEqual(0);
          expect(e).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(interferenceEnergy(Number.NaN, 4, 3, 0.5, 0, 0.4)).toBeGreaterThanOrEqual(0);
  });

  it('gridGravityPull stays in [0, 1), is non-decreasing, and attracts toward grid lines', () => {
    const subdivisions = [3, 4, 5];
    const strengths = [0, 0.5, 1];

    for (const sub of subdivisions) {
      for (const strength of strengths) {
        let prev = -1;
        for (let i = 0; i < 200; i += 1) {
          const p = i / 200;
          const pulled = gridGravityPull(p, sub, 0, strength);
          expect(pulled).toBeGreaterThanOrEqual(0);
          expect(pulled).toBeLessThan(1);
          expect(pulled).toBeGreaterThanOrEqual(prev - 1e-12);
          prev = pulled;
        }
      }
    }

    // With phaseShift=0, strength=0 is identity, strength=1 pulls points closer to grid 0 or 0.25
    expect(gridGravityPull(0.1, 4, 0, 0)).toBeCloseTo(0.1, 6);
    const pulled = gridGravityPull(0.06, 4, 0, 1);
    expect(pulled).toBeLessThan(0.06);

    expect(phaseDriftOffset(10, 0.25, 4)).toBeCloseTo(0.5, 6);
  });
});

describe('Drawn Curves', () => {
  it('evaluateDrawnCurve wraps periodically at x=0/x=1 and enforces [0, 1] bounds', () => {
    const periodicPoints = [
      { x: 0, y: 0.2 },
      { x: 0.25, y: 0.98 },
      { x: 0.5, y: 0.02 },
      { x: 0.75, y: 0.99 },
    ];

    const atZero = evaluateDrawnCurve(periodicPoints, 0);
    const atOne = evaluateDrawnCurve(periodicPoints, 1);
    const nearOne = evaluateDrawnCurve(periodicPoints, 0.9999);

    expect(atZero).toBeCloseTo(atOne, 6);
    expect(Math.abs(atZero - nearOne)).toBeLessThan(0.02);

    // Check strict [0, 1] clamping even on steep Catmull-Rom overshoot shapes
    for (let i = 0; i <= 500; i += 1) {
      const val = evaluateDrawnCurve(periodicPoints, i / 500);
      expect(Number.isFinite(val)).toBe(true);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }

    // All built-in curve presets evaluate cleanly in [0, 1]
    for (const preset of DEFAULT_CURVE_PRESETS) {
      for (let i = 0; i <= 100; i += 1) {
        const val = evaluateDrawnCurve(preset.points, i / 100);
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(1);
      }
    }

    expect(evaluateDrawnCurve([], 0.5)).toBe(0.5);
    expect(evaluateDrawnCurve([{ x: 0.5, y: 0.8 }], 0.2)).toBe(0.8);
  });
});
