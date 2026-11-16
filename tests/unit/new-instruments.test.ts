import { describe, expect, it } from 'vitest';
import { renderOfflineLoop } from '../../src/core/engine';
import {
  createDefaultLayer,
  insertTimeOperator,
  createSwingOperatorConfig,
  type BeatSnapshot,
  type LayerConfig,
} from '../../src/core/state';
import { swingWarpSteps } from '../../src/core/time';
import {
  computeMelodyStep,
  extendedMelodyDegree,
  type MelodyStepInfo,
} from '../../src/core/theory/melody';

function snapshotWith(layers: LayerConfig[]): BeatSnapshot {
  return {
    id: 'snap_test',
    tempoBpm: 128,
    timeSignature: { numerator: 4, denominator: 4 },
    masterGain: 0.9,
    masterGlue: 0.2,
    harmony: { rootNote: 9, scaleId: 'natural_minor', chordPreset: 'minor7', progressionId: 'static' },
    curves: [],
    layers,
  };
}

function stats(l: Float32Array, r: Float32Array) {
  let peak = 0;
  let sum = 0;
  let finite = true;
  for (let i = 0; i < l.length; i++) {
    const a = l[i]!;
    const b = r[i]!;
    if (!Number.isFinite(a) || !Number.isFinite(b)) finite = false;
    peak = Math.max(peak, Math.abs(a), Math.abs(b));
    sum += a * a + b * b;
  }
  return { peak, rms: Math.sqrt(sum / (2 * l.length)), finite };
}

describe('neue Instrumente', () => {
  for (const voiceId of ['metal-hat', 'clap-snare', 'acid-line', 'noise-riser', 'hard-kick', 'reese-bass', 'fm-bass']) {
    it(`${voiceId} klingt, bleibt endlich und übersteuert nicht`, () => {
      const layer = createDefaultLayer(`Test ${voiceId}`, voiceId, 4, 'beats');
      const out = renderOfflineLoop(snapshotWith([layer]), { bars: 2, sampleRate: 44100 });
      const s = stats(out.left, out.right);
      expect(s.finite).toBe(true);
      expect(s.rms).toBeGreaterThan(0.0008);
      expect(s.peak).toBeLessThan(1.05);
    });
  }

  it('Glocke & Orgel funktionieren mit allen neuen Melodie-Modi', () => {
    for (const voiceId of ['modal-bell', 'pipe-organ']) {
      for (const mode of [5, 7, 10, 11, 12, 13]) {
        const base = createDefaultLayer('M', voiceId, 4, 'beats');
        const layer: LayerConfig = {
          ...base,
          voice: {
            ...base.voice,
            params: { ...base.voice.params, melodyPattern: mode, melodyRate: 2, melodyLeap: 0.4, melodyRest: 0.3 },
          },
        };
        const out = renderOfflineLoop(snapshotWith([layer]), { bars: 1, sampleRate: 22050 });
        const s = stats(out.left, out.right);
        expect(s.finite).toBe(true);
        expect(s.rms).toBeGreaterThan(0.001);
      }
    }
  });
});

describe('Swing & Melodie-Mathe', () => {
  it('Swing verzögert nur jeden zweiten Schritt', () => {
    expect(swingWarpSteps(0, 0.3)).toBeCloseTo(0);
    expect(swingWarpSteps(2, 0.3)).toBeCloseTo(2);
    // Der 2. Schritt beginnt erst bei 1.3 Eingangs-Schritten
    expect(swingWarpSteps(1.3, 0.3)).toBeCloseTo(1);
    expect(swingWarpSteps(1, 0.3)).toBeLessThan(1);
    expect(swingWarpSteps(1, 0)).toBeCloseTo(1);
  });

  it('Swing-Operator landet vor der Puls-Interferenz', () => {
    const base = createDefaultLayer('S', 'metal-hat');
    const withoutSwing = base.timeOperators.filter((o) => o.moduleId !== 'time-swing');
    const ops = insertTimeOperator(withoutSwing, createSwingOperatorConfig('x'));
    const swingIdx = ops.findIndex((o) => o.moduleId === 'time-swing');
    const pulseIdx = ops.findIndex((o) => o.moduleId === 'time-pulse-interference');
    expect(swingIdx).toBeGreaterThanOrEqual(0);
    expect(swingIdx).toBeLessThan(pulseIdx);
  });

  it('Melodie ist deterministisch und wiederholt sich nach der Phrasen-Länge', () => {
    const info: MelodyStepInfo = { step: 0, phrase: 0, isNewNote: true };
    const chord = [0, 2, 4, 7, 9, 11, 14, 16, 18];
    const seq = (seed: number) => {
      const out: number[] = [];
      for (let c = 0; c < 16; c++) {
        computeMelodyStep(c, 1, 8, 10, info);
        out.push(extendedMelodyDegree(10, info.step, info.phrase, 0.6, 21, chord, chord.length, seed));
      }
      return out;
    };
    const a = seq(7);
    expect(seq(7)).toEqual(a);
    expect(a.slice(0, 8)).toEqual(a.slice(8, 16));
    expect(seq(8)).not.toEqual(a);
    // Melodie-Tempo 2: jeder Ton wird einmal wiederholt
    computeMelodyStep(5, 2, 0, 2, info);
    expect(info.step).toBe(2);
    expect(info.isNewNote).toBe(false);
  });
});

describe('Song-Kette & Demo-Song', () => {
  it('rendert alle Abschnitte nahtlos hintereinander (richtige Länge, kein Clipping)', async () => {
    const { renderSongChain } = await import('../../src/core/engine');
    const { createNachtschichtSections } = await import('../../src/core/state');
    const sections = createNachtschichtSections();
    expect(sections).toHaveLength(6);
    const sr = 16000;
    const parts = sections.slice(2, 4).map((s) => ({ snapshot: s.snapshot, bars: 1 }));
    const out = renderSongChain(parts, { sampleRate: sr, preRollBars: 1, tailBars: 1 });
    const barSamples = (60 / 128) * 4 * sr;
    expect(out.numSamples).toBe(Math.round(barSamples) * 2 + Math.round(barSamples));
    expect(out.partStartSamples).toEqual([0, Math.round(barSamples)]);
    const s = stats(out.left, out.right);
    expect(s.finite).toBe(true);
    expect(s.rms).toBeGreaterThan(0.01);
    expect(s.peak).toBeLessThan(1);
    // Gleiche Layer-IDs in allen Abschnitten (Engine-Instanzen werden weiterverwendet)
    const ids = sections.map((sec) => sec.snapshot.layers.map((l) => l.id).join(','));
    expect(new Set(ids).size).toBe(1);
  }, 60000);
});

describe('harte Bässe', () => {
  it('alle Verzerrungs-Arten bleiben endlich und unter 0 dBFS', () => {
    for (const voiceId of ['hard-kick', 'fm-bass', 'reese-bass']) {
      for (const distMode of [0, 1, 2, 3, 4]) {
        const b = createDefaultLayer('D', voiceId, 4, 'beats');
        const layer: LayerConfig = {
          ...b,
          voice: { ...b.voice, params: { ...b.voice.params, distMode, drive: 1, distortion: 1, wobbleRate: 4 } },
        };
        const out = renderOfflineLoop(snapshotWith([layer]), { bars: 1, sampleRate: 22050 });
        const s = stats(out.left, out.right);
        expect(s.finite).toBe(true);
        expect(s.peak).toBeLessThan(1.05);
        expect(s.rms).toBeGreaterThan(0.005);
      }
    }
  });

  it('Sub-Bewegung: Verzerrung & Ton-Wahl funktionieren', () => {
    const b = createDefaultLayer('S', 'sub-motion', 4, 'beats');
    for (const bassLine of [0, 1, 2, 3]) {
      const layer: LayerConfig = { ...b, voice: { ...b.voice, params: { ...b.voice.params, drive: 0.8, bassLine } } };
      const out = renderOfflineLoop(snapshotWith([layer]), { bars: 1, sampleRate: 22050 });
      const s = stats(out.left, out.right);
      expect(s.finite).toBe(true);
      expect(s.rms).toBeGreaterThan(0.005);
    }
  });

  it('Hardtechno-Demo hat 4 Abschnitte à 16 Takte mit 150 BPM', async () => {
    const { createHardtechnoSections } = await import('../../src/core/state');
    const secs = createHardtechnoSections();
    expect(secs.map((x) => x.exportBars)).toEqual([16, 16, 16, 16]);
    expect(secs.every((x) => x.snapshot.tempoBpm === 150)).toBe(true);
  });
});
