import { describe, expect, it } from 'vitest';
import { defaultRegistry } from '../../src/core/defaultRegistry';
import { NEUTRAL_HARMONY } from '../../src/core/arrangement/FxChain';
import type { ProcessorContext } from '../../src/core/registry/types';

const SR = 48000;
const ctx = (n: number): ProcessorContext => ({
  sampleRate: SR,
  numSamples: n,
  bpm: 120,
  harmony: NEUTRAL_HARMONY,
  layerPulseEnergy: 0,
  layerTrigger: 0,
});

function sine(n: number, f = 220, amp = 0.8, offset = 0): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * f * (i + offset)) / SR);
  return out;
}

function run(id: string, params: Record<string, number>, seconds = 0.5, blocks = 32) {
  const mod = defaultRegistry.getProcessor(id)!;
  const inst = mod.createInstance(SR);
  const total = Math.round(seconds * SR);
  const outL = new Float32Array(total);
  for (let o = 0; o < total; o += blocks) {
    const n = Math.min(blocks, total - o);
    const l = sine(n, 220, 0.8, o);
    const r = sine(n, 220, 0.8, o);
    inst.process(l, r, params, ctx(n));
    outL.set(l, o);
  }
  return outL;
}

const peakOf = (a: Float32Array, from = 0) => {
  let p = 0;
  for (let i = from; i < a.length; i++) p = Math.max(p, Math.abs(a[i]!));
  return p;
};

describe('New timeline cards', () => {
  it('are registered', () => {
    for (const id of ['card-tape-stop', 'card-beat-repeat', 'card-evenness']) {
      expect(defaultRegistry.getProcessor(id)).toBeDefined();
    }
  });

  it('tape stop: neutral at 0, silent when fully stopped', () => {
    const dry = sine(SR / 2);
    const out = run('card-tape-stop', { stop: 0, curve: 0.5 });
    let diff = 0;
    for (let i = 0; i < out.length; i++) diff = Math.max(diff, Math.abs(out[i]! - dry[i]!));
    expect(diff).toBeLessThan(1e-6);
    expect(peakOf(run('card-tape-stop', { stop: 1, curve: 0.5 }))).toBeLessThan(1e-6);
  });

  it('evenness reduces loud peaks (without output make-up)', () => {
    const out = run('card-evenness', { amount: 1, speed: 1, output: 0.2 });
    expect(peakOf(out, SR / 4)).toBeLessThan(0.8 * 0.6);
  });

  it('beat repeat loops a slice and is neutral when off', () => {
    const off = run('card-beat-repeat', { repeat: 0, division: 2, decay: 0, mix: 1 });
    const dry = sine(SR / 2);
    let diff = 0;
    for (let i = 0; i < off.length; i++) diff = Math.max(diff, Math.abs(off[i]! - dry[i]!));
    expect(diff).toBeLessThan(1e-6);
    const on = run('card-beat-repeat', { repeat: 1, division: 2, decay: 0, mix: 1 });
    expect(peakOf(on, 2000)).toBeGreaterThan(0.1);
    // 1/16 at 120 BPM = 6000 samples: the second pass repeats the first.
    const len = 6000;
    let d = 0;
    for (let i = 200; i < len - 200; i++) d = Math.max(d, Math.abs(on[len + i]! - on[i]!));
    expect(d).toBeLessThan(1e-6);
  });
});
