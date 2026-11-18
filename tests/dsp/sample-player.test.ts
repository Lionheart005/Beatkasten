import { describe, expect, it } from 'vitest';
import { TechnoEngine } from '../../src/core/engine/TechnoEngine';
import { createDefaultLayer, createHypnoticAMinorProject } from '../../src/core/state';
import type { BeatSnapshot, LayerConfig } from '../../src/core/state/types';
import { defaultRegistry } from '../../src/core/defaultRegistry';
import { detectPitchYin } from '../../src/core/audio/analysis';
import { renderOfflineLoop } from '../../src/core/engine/OfflineRenderer';

const SR = 48000;

function tone(seconds: number, hz: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++) out[i] = 0.6 * Math.sin((2 * Math.PI * hz * i) / SR);
  return out;
}

function sampleSnapshot(mode: number, params: Record<string, number> = {}): BeatSnapshot {
  const base = createHypnoticAMinorProject().activeSnapshot;
  const layer: LayerConfig = {
    ...createDefaultLayer('Sample', 'sample-player', 1, 'beats'),
    processorChain: [],
    sample: { assetId: 'a1', rootMidi: 69, startSec: 0, endSec: 1 },
  };
  return {
    ...base,
    layers: [{ ...layer, voice: { ...layer.voice, params: { ...layer.voice.params, mode, ...params } } }],
  };
}

const sine440 = tone(1, 440);
const bank = (id: string) => (id === 'a1' ? { left: sine440, right: sine440, sampleRate: SR, length: sine440.length } : undefined);

describe('Sample instrument (sample-player)', () => {
  it('is registered', () => {
    expect(defaultRegistry.getVoice('sample-player')).toBeDefined();
  });

  it('is silent without a sample and plays once the bank provides it', () => {
    const snap = sampleSnapshot(0);
    const silent = renderOfflineLoop(snap, { bars: 1, sampleRate: SR });
    let p0 = 0;
    for (let i = 0; i < silent.numSamples; i++) p0 = Math.max(p0, Math.abs(silent.left[i]!));
    expect(p0).toBe(0);
    const r = renderOfflineLoop(snap, { bars: 1, sampleRate: SR, sampleBank: bank });
    let p = 0;
    for (let i = 0; i < r.numSamples; i++) p = Math.max(p, Math.abs(r.left[i]!));
    expect(p).toBeGreaterThan(0.05);
  });

  it('one-shot keeps the pitch, tune shifts it', () => {
    const measure = (params: Record<string, number>) => {
      const r = renderOfflineLoop(sampleSnapshot(0, params), { bars: 1, sampleRate: SR, sampleBank: bank });
      return detectPitchYin(r.left.subarray(2000, 2000 + 8192), SR);
    };
    expect(measure({})!).toBeGreaterThan(430);
    expect(measure({})!).toBeLessThan(450);
    const up = measure({ tune: 12 })!;
    expect(up).toBeGreaterThan(860);
    expect(up).toBeLessThan(900);
  });

  it('bass mode follows the bass note of the harmony', () => {
    const engine = new TechnoEngine(SR, defaultRegistry, 1024);
    engine.setSampleBank(bank);
    engine.applySnapshot(sampleSnapshot(2));
    const L = new Float32Array(1024);
    const R = new Float32Array(1024);
    const out = new Float32Array(16384);
    for (let o = 0; o < out.length; o += 1024) {
      engine.processBlock(L, R, 1024);
      out.set(L, o);
    }
    const hz = detectPitchYin(out.subarray(2000, 2000 + 8192), SR, 20, 800);
    // A minor, bass ~ A1/A2 (55 / 110 Hz): sample root A4 (440) is shifted down.
    expect(hz).not.toBeNull();
    expect(hz!).toBeLessThan(200);
  });
});
