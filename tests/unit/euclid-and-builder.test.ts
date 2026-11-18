import { describe, expect, it } from 'vitest';
import { LayerEngine } from '../../src/core/engine/LayerEngine';
import { ModulationRouter } from '../../src/core/modulation/ModulationRouter';
import { defaultRegistry } from '../../src/core/defaultRegistry';
import { createDefaultLayer } from '../../src/core/state';
import type { BeatSnapshot, LayerConfig } from '../../src/core/state/types';
import { euclidPattern } from '../../src/core/time/operators';
import {
  buildHarmonyTimeline,
  computeHarmonyFrame,
  getDiatonicChordIntervals,
  MAX_CUSTOM_STEPS,
  romanNumeral,
} from '../../src/core/theory';

const pat = (n: number, k: number, r = 0) =>
  euclidPattern(n, k, r)
    .map((h) => (h ? 'x' : '.'))
    .join('');

function euclidLayer(params: Record<string, number>, interferenceOn: boolean): LayerConfig {
  const base = createDefaultLayer('E', 'pulse-texture', 4, 'beats', { legacyTime: true });
  return {
    ...base,
    timeOperators: base.timeOperators.map((op) => {
      if (op.moduleId === 'time-euclid') return { ...op, bypassed: false, params: { ...op.params, ...params } };
      if (op.moduleId === 'time-pulse-interference')
        return { ...op, bypassed: !interferenceOn, params: { ...op.params, freqA: 16 } };
      return op;
    }),
  };
}

/** Counts triggers over `cycles` layer cycles of 4 beats at 120 BPM. */
function countTriggers(layer: LayerConfig, cycles: number): number {
  const sr = 48000;
  const engine = new LayerEngine(sr, 512);
  engine.syncConfig(layer, defaultRegistry);
  const router = new ModulationRouter();
  const snap = { layers: [layer], curves: [] } as unknown as BeatSnapshot;
  router.prepareSnapshot(snap);
  const harmony = computeHarmonyFrame(9, 'natural_minor', 'minor7', 'static', 0);
  const samplesPerBeat = sr / 2;
  const total = Math.round(cycles * 4 * samplesPerBeat);
  let triggers = 0;
  let prev = 0;
  for (let pos = 0; pos < total; pos += 32) {
    engine.renderBlock(pos / samplesPerBeat, 32, 120, 4, harmony, router, new Map(), true);
    const t = engine.lastTriggerIntensity;
    if (t > 0.01 && prev <= 0.01) triggers++;
    prev = t;
  }
  return triggers;
}

describe('Euclidean rhythm operator', () => {
  it('produces the classic euclidean patterns (rotation shifts later)', () => {
    expect(pat(8, 3)).toBe('x..x..x.');
    expect(pat(8, 5)).toBe('x.xx.xx.');
    expect(pat(16, 4)).toBe('x...x...x...x...');
    expect(pat(8, 3, 1)).toBe('.x..x..x');
    expect(pat(4, 0)).toBe('....');
    expect(pat(4, 9)).toBe('xxxx');
  });

  it('fires exactly k triggers per cycle in the engine (own pulse)', () => {
    expect(countTriggers(euclidLayer({ euclidSteps: 8, euclidHits: 3 }, false), 4)).toBe(12);
    expect(countTriggers(euclidLayer({ euclidSteps: 16, euclidHits: 7, euclidRotation: 3 }, true), 2)).toBe(14);
  });

  it('mask mode only lets interference pulses through on hit steps', () => {
    const masked = countTriggers(
      euclidLayer({ euclidSteps: 16, euclidHits: 5, euclidMode: 1 }, true),
      2,
    );
    expect(masked).toBe(10);
  });
});

describe('Cadence builder extensions', () => {
  it('supports augmented chords incl. diatonic III+ in harmonic minor', () => {
    expect(getDiatonicChordIntervals('harmonic_minor', 2, 3)).toEqual([0, 4, 8]);
    expect(romanNumeral(2, 0, [0, 4, 8])).toBe('III+');
    expect(romanNumeral(4, 0, [0, 4, 8, 10])).toBe('V+7');
    const t = buildHarmonyTimeline(
      {
        rootNote: 0,
        scaleId: 'major',
        chordPreset: 'major',
        progressionId: 'static',
        progressionMode: 'custom',
        customSteps: [
          { id: 'a', degree: 0, accidental: 0, chordType: 'aug', durationBeats: 6, transitionType: 'cut', transitionBeats: 0 },
          { id: 'b', degree: 4, accidental: 0, chordType: 'aug7', durationBeats: 10, transitionType: 'cut', transitionBeats: 0 },
          { id: 'c', degree: 0, accidental: 0, chordType: 'augMaj7', durationBeats: 128, transitionType: 'cut', transitionBeats: 0 },
        ],
      },
      4,
    );
    expect(t.steps.map((s) => s.chordName)).toEqual(['C+', 'G7♯5', 'Cmaj7♯5']);
    expect(t.totalBeats).toBe(144);
  });

  it('handles very long chains (128 chords) with arbitrary hold lengths', () => {
    expect(MAX_CUSTOM_STEPS).toBeGreaterThanOrEqual(128);
    const steps = Array.from({ length: 128 }, (_, i) => ({
      id: `s${i}`,
      degree: (i * 3) % 7,
      accidental: 0 as const,
      chordType: 'auto',
      durationBeats: 1 + (i % 5) * 1.5,
      transitionType: 'glide' as const,
      transitionBeats: 0.5,
    }));
    const t = buildHarmonyTimeline(
      { rootNote: 9, scaleId: 'natural_minor', chordPreset: 'minor7', progressionId: 'static', progressionMode: 'custom', customSteps: steps },
      4,
    );
    expect(t.steps).toHaveLength(128);
    const expected = steps.reduce((sum, s) => sum + s.durationBeats, 0);
    expect(t.totalBeats).toBeCloseTo(expected, 6);
  });
});
