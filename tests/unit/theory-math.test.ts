import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CURVE_PRESETS,
  evaluateDrawnCurve,
  gridGravityPull,
  interferenceEnergy,
  phaseDriftOffset,
  warpPhase,
  wrapPhase01,
} from '../../src/core/math';
import type {
  MutableTimeFrame,
  ParameterSchema,
  TimeEvalContext,
} from '../../src/core/registry/types';
import { ModulationRouter } from '../../src/core/modulation/ModulationRouter';
import type { BeatSnapshot, LayerConfig } from '../../src/core/state/types';
import { timePulseInterferenceOperator } from '../../src/core/time/operators';
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

  it('timePulseInterferenceOperator fires exact on-beat triggers over 2 bars without double-triggers', () => {
    const sampleRate = 48000;
    const bpm = 130;
    const beatsPerBar = 4;
    const cycleBeats = 4;
    const subblockSize = 32;
    const samplesPerBeat = (60 / bpm) * sampleRate;
    const totalSamples = Math.floor(8 * samplesPerBeat);

    const runTwoBars = (params: Record<string, number>) => {
      let prevFrame: MutableTimeFrame = {
        warpedPhase: 0,
        pulseEnergy: 0,
        triggerIntensity: 0,
        accent: 0,
        stepIndex: -1,
        pulseSlope: 0,
      };
      const triggers: Array<{ beat: number; intensity: number }> = [];

      for (let sample = 0; sample < totalSamples; sample += subblockSize) {
        const beatPosition = sample / samplesPerBeat;
        const layerPhase = wrapPhase01(beatPosition / cycleBeats);
        const ctx: TimeEvalContext = {
          beatPosition,
          barPosition: beatPosition / beatsPerBar,
          layerPhase,
          cycleIndex: Math.floor(beatPosition / cycleBeats),
          cycleBeats,
          beatsPerBar,
          sampleRate,
        };
        const inFrame: MutableTimeFrame = {
          warpedPhase: layerPhase,
          pulseEnergy: prevFrame.pulseEnergy,
          triggerIntensity: 0,
          accent: prevFrame.accent,
          stepIndex: prevFrame.stepIndex,
          pulseSlope: prevFrame.pulseSlope,
        };
        const outFrame: MutableTimeFrame = {
          warpedPhase: 0,
          pulseEnergy: 0,
          triggerIntensity: 0,
          accent: 0,
          stepIndex: 0,
          pulseSlope: 0,
        };
        timePulseInterferenceOperator.evaluateTimeInto!(ctx, params, inFrame, outFrame);

        expect(outFrame.pulseEnergy).toBeGreaterThanOrEqual(0);
        expect(outFrame.pulseEnergy).toBeLessThanOrEqual(1);

        if (outFrame.triggerIntensity > 0) {
          triggers.push({ beat: beatPosition, intensity: outFrame.triggerIntensity });
        }
        prevFrame = outFrame;
      }
      return triggers;
    };

    for (const threshold of [0, 0.5]) {
      const triggers = runTwoBars({
        freqA: 4,
        freqB: 4,
        interferenceMix: 0,
        phaseOffset: 0,
        threshold,
      });

      expect(triggers).toHaveLength(8);
      for (let i = 0; i < 8; i += 1) {
        expect(Math.abs(triggers[i]!.beat - i)).toBeLessThan(0.002);
        expect(triggers[i]!.intensity).toBeGreaterThan(0.99);
        expect(triggers[i]!.intensity).toBeLessThanOrEqual(1);
      }
      const intensities = triggers.map((t) => t.intensity);
      expect(Math.max(...intensities) - Math.min(...intensities)).toBeLessThan(0.005);
    }

    const interferenceTriggers = runTwoBars({
      freqA: 4,
      freqB: 3,
      interferenceMix: 0.5,
      phaseOffset: 0.125,
      threshold: 0.2,
    });
    expect(interferenceTriggers.length).toBeGreaterThan(0);
    for (const trig of interferenceTriggers) {
      expect(Number.isFinite(trig.intensity)).toBe(true);
      expect(trig.intensity).toBeGreaterThan(0);
      expect(trig.intensity).toBeLessThanOrEqual(1);
    }
  });

  it('interferenceEnergy shapes waves cleanly for waveShape = -1 (needle) and +1 (rectangular gate) without peak displacement', () => {
    // Needle peaks (waveShape = -1): peak at p = 0 stays 1, mid-slope drops much sharper than waveShape = 0
    expect(interferenceEnergy(0, 4, 4, 0, 0, 0, -1)).toBeCloseTo(1, 6);
    const softMid = interferenceEnergy(0.0625, 4, 4, 0, 0, 0, 0);
    const needleMid = interferenceEnergy(0.0625, 4, 4, 0, 0, 0, -1);
    expect(softMid).toBeCloseTo(0.5, 6);
    expect(needleMid).toBeLessThan(0.01);
    expect(needleMid).toBeLessThan(softMid * 0.05);

    // Rectangular gate (waveShape = +1): outputs strictly 0 or 1, 1 at p = 0, 0 at p = 0.125 for freqA = 4
    expect(interferenceEnergy(0, 4, 4, 0, 0, 0, 1)).toBe(1);
    expect(interferenceEnergy(0.125, 4, 4, 0, 0, 0, 1)).toBe(0);
    for (let i = 0; i < 200; i += 1) {
      const p = i / 200;
      const val = interferenceEnergy(p, 4, 4, 0, 0, 0, 1);
      expect(val === 0 || val === 1).toBe(true);
    }
    // Symmetric around p = 0 (zero peak displacement)
    expect(interferenceEnergy(0.05, 4, 4, 0, 0, 0, 1)).toBe(1);
    expect(interferenceEnergy(0.95, 4, 4, 0, 0, 0, 1)).toBe(1);
  });

  it('timePulseInterferenceOperator triggers cleanly 32 times across [0, 1) when freqA = 32', () => {
    const sampleRate = 48000;
    const bpm = 130;
    const beatsPerBar = 4;
    const cycleBeats = 4;
    const subblockSize = 32;
    const samplesPerBeat = (60 / bpm) * sampleRate;
    const cycleSamples = Math.floor(cycleBeats * samplesPerBeat);

    let prevFrame: MutableTimeFrame = {
      warpedPhase: 0,
      pulseEnergy: 0,
      triggerIntensity: 0,
      accent: 0,
      stepIndex: -1,
      pulseSlope: 0,
    };
    const triggers: number[] = [];
    const params = {
      freqA: 32,
      freqB: 4,
      interferenceMix: 0,
      phaseOffset: 0,
      threshold: 0,
      waveShape: 0,
    };

    for (let sample = 0; sample < cycleSamples; sample += subblockSize) {
      const beatPosition = sample / samplesPerBeat;
      const layerPhase = wrapPhase01(beatPosition / cycleBeats);
      const ctx: TimeEvalContext = {
        beatPosition,
        barPosition: beatPosition / beatsPerBar,
        layerPhase,
        cycleIndex: 0,
        cycleBeats,
        beatsPerBar,
        sampleRate,
      };
      const inFrame: MutableTimeFrame = {
        warpedPhase: layerPhase,
        pulseEnergy: prevFrame.pulseEnergy,
        triggerIntensity: 0,
        accent: prevFrame.accent,
        stepIndex: prevFrame.stepIndex,
        pulseSlope: prevFrame.pulseSlope,
      };
      const outFrame: MutableTimeFrame = {
        warpedPhase: 0,
        pulseEnergy: 0,
        triggerIntensity: 0,
        accent: 0,
        stepIndex: 0,
        pulseSlope: 0,
      };
      timePulseInterferenceOperator.evaluateTimeInto!(ctx, params, inFrame, outFrame);
      if (outFrame.triggerIntensity > 0) {
        triggers.push(layerPhase);
      }
      prevFrame = outFrame;
    }

    expect(triggers).toHaveLength(32);
    for (let i = 0; i < 32; i += 1) {
      expect(Math.abs(triggers[i]! - i / 32)).toBeLessThan(0.002);
    }
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

  it('ModulationRouter uses curve.cycleValue as primary truth over stale route.sourceConfig.cycleValue', () => {
    const router = new ModulationRouter();
    const curveId = 'curve-10-beats';
    const layerId = 'layer-1';
    const targetCardId = 'voice-1';
    const targetParamId = 'cutoff';

    const layer: LayerConfig = {
      id: layerId,
      name: 'Synth',
      color: '#38bdf8',
      enabled: true,
      muted: false,
      solo: false,
      level: 0.8,
      pan: 0,
      cycleLength: { value: 4, unit: 'beats' },
      timeOperators: [],
      voice: {
        moduleId: targetCardId,
        version: 1,
        params: { [targetParamId]: 1 },
      },
      processorChain: [],
      modulations: [
        {
          id: 'mod-1',
          enabled: true,
          sourceType: 'drawn-curve',
          sourceConfig: {
            curveId,
            cycleValue: 4, // stale LFO cycle value
            cycleUnit: 'beats',
          },
          targetDomain: 'voice',
          targetCardId,
          targetParamId,
          combineMode: 'multiply',
          depth: 1,
        },
      ],
    };

    const snapshot: BeatSnapshot = {
      id: 'snap-1',
      tempoBpm: 130,
      timeSignature: { numerator: 4, denominator: 4 },
      masterGain: 0.8,
      masterGlue: 0,
      harmony: {
        rootNote: 9,
        scaleId: 'natural_minor',
        chordPreset: 'minor7',
        progressionId: 'dark_minimal',
      },
      curves: [
        {
          id: curveId,
          name: 'Ten Beat Ramp',
          cycleValue: 10,
          cycleUnit: 'beats',
          snapDivision: 0,
          points: [
            { x: 0, y: 0 },
            { x: 0.25, y: 0.5 },
            { x: 0.5, y: 1 },
            { x: 0.75, y: 0.5 },
          ],
        },
      ],
      layers: [layer],
    };

    router.prepareSnapshot(snapshot);

    const schemas: ParameterSchema[] = [
      {
        id: targetParamId,
        label: 'Cutoff',
        description: 'Filter cutoff',
        domain: 'timbre',
        min: 0,
        max: 1,
        defaultValue: 1,
        modulatable: true,
      },
    ];
    const baseParams: Record<string, number> = { [targetParamId]: 1 };
    const outParams: Record<string, number> = {};
    const layerPulses = new Map<string, number>();

    const evalAtBeat = (beatPosition: number): number => {
      router.beginLayerSubBlock(layer, beatPosition, 4, layerPulses);
      router.applyTargetModulation(
        layer,
        'voice',
        targetCardId,
        undefined,
        schemas,
        baseParams,
        outParams,
      );
      return outParams[targetParamId]!;
    };

    const at0 = evalAtBeat(0);
    const at2_5 = evalAtBeat(2.5);
    const at5 = evalAtBeat(5);
    const at10 = evalAtBeat(10);

    expect(at0).toBeLessThan(0.05);
    expect(at2_5).toBeCloseTo(0.5, 1);
    expect(at5).toBeGreaterThan(0.95);
    expect(at10).toBeCloseTo(at0, 5);
  });
});
