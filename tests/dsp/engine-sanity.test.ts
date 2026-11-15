import { describe, expect, it } from 'vitest';
import { defaultRegistry } from '../../src/core/defaultRegistry';
import { ZdfSvfFilter } from '../../src/core/dsp/filters';
import {
  LayerEngine,
  renderOfflineLoop,
  TechnoEngine,
} from '../../src/core/engine';
import { ModulationRouter } from '../../src/core/modulation/ModulationRouter';
import { clampParam, type HarmonyFrame } from '../../src/core/registry/types';
import {
  createChordToOffbeatArpPreset,
  createDefaultLayer,
  createHypnoticAMinorProject,
  createTripletRiddlePreset,
  type BeatSnapshot,
  type LayerConfig,
} from '../../src/core/state';
import { computeHarmonyFrame } from '../../src/core/theory';

interface AudioStats {
  peak: number;
  rms: number;
  dcL: number;
  dcR: number;
  hasNonFinite: boolean;
}

function analyzeStereoBuffer(left: Float32Array, right: Float32Array): AudioStats {
  let peak = 0;
  let sumSq = 0;
  let sumL = 0;
  let sumR = 0;
  let hasNonFinite = false;
  const n = Math.min(left.length, right.length);

  for (let i = 0; i < n; i += 1) {
    const l = left[i]!;
    const r = right[i]!;
    if (!Number.isFinite(l) || !Number.isFinite(r)) {
      hasNonFinite = true;
      continue;
    }
    const absL = Math.abs(l);
    const absR = Math.abs(r);
    if (absL > peak) peak = absL;
    if (absR > peak) peak = absR;
    sumSq += 0.5 * (l * l + r * r);
    sumL += l;
    sumR += r;
  }

  return {
    peak,
    rms: n > 0 ? Math.sqrt(sumSq / n) : 0,
    dcL: n > 0 ? sumL / n : 0,
    dcR: n > 0 ? sumR / n : 0,
    hasNonFinite,
  };
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('DSP Engine Sanity & Contracts', () => {
  it('enforces zero NaN/Inf, headroom <= 0.96, and DC offset < 0.01 on all 3 starter presets', () => {
    const hypnotic = createHypnoticAMinorProject();
    const snapshots: Array<{ name: string; snap: BeatSnapshot }> = [
      { name: 'hypnotic-main', snap: hypnotic.activeSnapshot },
      { name: 'hypnotic-intro', snap: hypnotic.sections[0]!.snapshot },
      { name: 'hypnotic-break', snap: hypnotic.sections[2]!.snapshot },
      { name: 'triplet-riddle', snap: createTripletRiddlePreset() },
      { name: 'chord-to-offbeat-arp', snap: createChordToOffbeatArpPreset() },
    ];

    for (const { name, snap } of snapshots) {
      const rendered = renderOfflineLoop(snap, {
        sampleRate: 48000,
        bars: 2,
        preRollBars: 0,
      });
      const stats = analyzeStereoBuffer(rendered.left, rendered.right);
      expect(stats.hasNonFinite, `${name} produced NaN/Inf`).toBe(false);
      expect(stats.peak, `${name} exceeded headroom`).toBeLessThanOrEqual(0.96);
      expect(stats.rms, `${name} produced silent output`).toBeGreaterThan(0.005);
      expect(Math.abs(stats.dcL), `${name} left DC offset too high`).toBeLessThan(0.01);
      expect(Math.abs(stats.dcR), `${name} right DC offset too high`).toBeLessThan(0.01);
    }
  });

  it('is strictly deterministic across repeated renderOfflineLoop invocations', () => {
    const snap = createHypnoticAMinorProject().activeSnapshot;
    const run1 = renderOfflineLoop(snap, {
      sampleRate: 48000,
      bars: 2,
      preRollBars: 1,
    });
    const run2 = renderOfflineLoop(snap, {
      sampleRate: 48000,
      bars: 2,
      preRollBars: 1,
    });

    expect(run1.numSamples).toBe(run2.numSamples);
    for (let i = 0; i < run1.numSamples; i += 1) {
      expect(run1.left[i]).toBe(run2.left[i]);
      expect(run1.right[i]).toBe(run2.right[i]);
    }
  });

  it('renders pre-roll loops (preRollBars: 2) cleanly without silence or clicks', () => {
    const snap = createChordToOffbeatArpPreset();
    const rendered = renderOfflineLoop(snap, {
      sampleRate: 48000,
      bars: 2,
      preRollBars: 2,
    });

    const stats = analyzeStereoBuffer(rendered.left, rendered.right);
    expect(stats.hasNonFinite).toBe(false);
    expect(stats.peak).toBeLessThanOrEqual(0.96);
    expect(stats.rms).toBeGreaterThan(0.005);

    // Check max sample-to-sample jump to detect hard digital pops/clicks
    let maxStepDelta = 0;
    for (let i = 1; i < rendered.numSamples; i += 1) {
      const dL = Math.abs(rendered.left[i]! - rendered.left[i - 1]!);
      const dR = Math.abs(rendered.right[i]! - rendered.right[i - 1]!);
      if (dL > maxStepDelta) maxStepDelta = dL;
      if (dR > maxStepDelta) maxStepDelta = dR;
    }
    expect(maxStepDelta).toBeLessThan(0.9);
  });

  it('keeps sub-bass (< 110 Hz) strictly mono even at stereoOrbit: 1.8', () => {
    const subLayer = createDefaultLayer('Sub Only', 'sub-motion', 4, 'beats');
    const wideSubLayer: LayerConfig = {
      ...subLayer,
      level: 0.9,
      pan: 0.35, // Even with off-center pan, MasterBus LR4 crossover forces <110 Hz mono
      voice: {
        ...subLayer.voice,
        params: {
          ...subLayer.voice.params,
          subWarmth: 0.9,
          phaseBite: 0.1,
          octaveShift: -2,
          autoDuck: 0,
          sustainHold: 0.95,
        },
      },
      processorChain: subLayer.processorChain.map((c) =>
        c.moduleId === 'card-eq-orbit'
          ? { ...c, bypassed: false, params: { ...c.params, stereoOrbit: 1.8 } }
          : { ...c, bypassed: true },
      ),
    };

    const snap: BeatSnapshot = {
      id: 'snap_sub_mono_test',
      tempoBpm: 130,
      timeSignature: { numerator: 4, denominator: 4 },
      masterGain: 1.0,
      masterGlue: 0.15,
      harmony: {
        rootNote: 9,
        scaleId: 'natural_minor',
        chordPreset: 'minor',
        progressionId: 'static',
      },
      curves: [],
      layers: [wideSubLayer],
    };

    const sampleRate = 48000;
    const rendered = renderOfflineLoop(snap, {
      sampleRate,
      bars: 2,
      preRollBars: 1,
    });

    // Low-pass filter both L and R at 95 Hz (well inside <110 Hz sub band)
    const lpL = new ZdfSvfFilter(sampleRate, 95, Math.SQRT1_2, 0);
    const lpR = new ZdfSvfFilter(sampleRate, 95, Math.SQRT1_2, 0);

    let sumEnergy = 0;
    let diffEnergy = 0;
    // Skip initial 100 ms filter settle
    const skip = Math.round(0.1 * sampleRate);
    for (let i = 0; i < rendered.numSamples; i += 1) {
      const subL = lpL.processSample(rendered.left[i]!);
      const subR = lpR.processSample(rendered.right[i]!);
      if (i >= skip) {
        const mid = 0.5 * (subL + subR);
        const side = 0.5 * (subL - subR);
        sumEnergy += mid * mid;
        diffEnergy += side * side;
      }
    }

    expect(sumEnergy).toBeGreaterThan(1e-3);
    const sideRatio = diffEnergy / sumEnergy;
    expect(sideRatio).toBeLessThan(0.01);
  });

  it('ModulationRouter respects static depth=0 vs modulated depth!=0, pulse coupling, and 1-pass mod-on-mod within schema bounds', () => {
    const toneCard = defaultRegistry.getProcessor('card-tone-filter')!;
    const router = new ModulationRouter();

    const baseLayer = createDefaultLayer('Mod Test', 'pulse-texture', 4, 'beats');
    const toneCardId = baseLayer.processorChain.find(
      (c) => c.moduleId === 'card-tone-filter',
    )!.id;

    // 1. Static route (depth = 0) vs Modulated route (depth = 0.45)
    const staticLayer: LayerConfig = {
      ...baseLayer,
      id: 'layer_mod_target',
      modulations: [
        {
          id: 'r_main',
          enabled: true,
          sourceType: 'wave-lfo',
          sourceConfig: { waveform: 'sine', cycleValue: 4, cycleUnit: 'beats' },
          targetDomain: 'processor',
          targetCardId: toneCardId,
          targetParamId: 'brightness',
          combineMode: 'add',
          depth: 0,
        },
      ],
    };

    const snapStatic: BeatSnapshot = {
      id: 'snap_mod_static',
      tempoBpm: 130,
      timeSignature: { numerator: 4, denominator: 4 },
      masterGain: 1,
      masterGlue: 0.2,
      harmony: {
        rootNote: 9,
        scaleId: 'natural_minor',
        chordPreset: 'minor',
        progressionId: 'static',
      },
      curves: [],
      layers: [staticLayer],
    };

    router.prepareSnapshot(snapStatic);
    const outStatic: Record<string, number> = {};
    const pulses = new Map<string, number>([['layer_pulse_src', 0.85]]);

    const staticValues: number[] = [];
    for (let beat = 0; beat < 4; beat += 0.5) {
      router.beginLayerSubBlock(staticLayer, beat, 4, pulses);
      router.applyTargetModulation(
        staticLayer,
        'processor',
        toneCardId,
        'card-tone-filter',
        toneCard.parameters,
        baseLayer.processorChain[0]!.params,
        outStatic,
      );
      staticValues.push(outStatic['brightness']!);
    }
    for (const val of staticValues) {
      expect(val).toBeCloseTo(staticValues[0]!, 6);
    }

    // 2. Modulated + Layer-Pulse + 1-Pass Modulation-on-Modulation
    const modLayer: LayerConfig = {
      ...staticLayer,
      modulations: [
        {
          id: 'r_main',
          enabled: true,
          sourceType: 'wave-lfo',
          sourceConfig: { waveform: 'sine', cycleValue: 4, cycleUnit: 'beats' },
          targetDomain: 'processor',
          targetCardId: toneCardId,
          targetParamId: 'brightness',
          combineMode: 'add',
          depth: 0.5,
        },
        {
          id: 'r_pulse_focus',
          enabled: true,
          sourceType: 'layer-pulse',
          sourceConfig: { sourceLayerId: 'layer_pulse_src' },
          targetDomain: 'processor',
          targetCardId: toneCardId,
          targetParamId: 'focus',
          combineMode: 'add',
          depth: 0.9,
        },
        {
          id: 'r_mod_on_mod_depth',
          enabled: true,
          sourceType: 'macro-arc',
          sourceConfig: { waveform: 'triangle', cycleValue: 2, cycleUnit: 'beats' },
          targetDomain: 'modulation',
          targetCardId: 'r_main',
          targetParamId: 'depth',
          combineMode: 'add',
          depth: 0.8,
        },
      ],
    };

    router.prepareLayer(modLayer);
    const brightSchema = toneCard.parameters.find((p) => p.id === 'brightness')!;
    const focusSchema = toneCard.parameters.find((p) => p.id === 'focus')!;

    const modValues: number[] = [];
    for (let beat = 0; beat < 4; beat += 0.5) {
      pulses.set('layer_pulse_src', (beat * 0.25) % 1);
      router.beginLayerSubBlock(modLayer, beat, 4, pulses);
      router.applyTargetModulation(
        modLayer,
        'processor',
        toneCardId,
        'card-tone-filter',
        toneCard.parameters,
        baseLayer.processorChain[0]!.params,
        outStatic,
      );
      const b = outStatic['brightness']!;
      const f = outStatic['focus']!;
      expect(b).toBeGreaterThanOrEqual(brightSchema.min);
      expect(b).toBeLessThanOrEqual(brightSchema.max);
      expect(f).toBeGreaterThanOrEqual(focusSchema.min);
      expect(f).toBeLessThanOrEqual(focusSchema.max);
      modValues.push(b);
    }

    const minB = Math.min(...modValues);
    const maxB = Math.max(...modValues);
    expect(maxB - minB).toBeGreaterThan(0.1);
  });

  it('maintains loudness stability (auto-gain) when cranking warmthGrit and wavefold', () => {
    const base = createDefaultLayer('Warmth Test', 'sub-motion', 4, 'beats');
    const makeSnap = (warmthGrit: number, wavefold: number): BeatSnapshot => ({
      id: `snap_wg_${warmthGrit}_${wavefold}`,
      tempoBpm: 130,
      timeSignature: { numerator: 4, denominator: 4 },
      masterGain: 0.85,
      masterGlue: 0.2,
      harmony: {
        rootNote: 9,
        scaleId: 'natural_minor',
        chordPreset: 'minor',
        progressionId: 'static',
      },
      curves: [],
      layers: [
        {
          ...base,
          processorChain: base.processorChain.map((c) =>
            c.moduleId === 'card-warmth-wavefold'
              ? { ...c, bypassed: false, params: { warmthGrit, wavefold } }
              : c,
          ),
        },
      ],
    });

    const clean = renderOfflineLoop(makeSnap(0, 0), {
      sampleRate: 48000,
      bars: 2,
      preRollBars: 0,
    });
    const driven = renderOfflineLoop(makeSnap(0.95, 0.9), {
      sampleRate: 48000,
      bars: 2,
      preRollBars: 0,
    });

    const cleanStats = analyzeStereoBuffer(clean.left, clean.right);
    const drivenStats = analyzeStereoBuffer(driven.left, driven.right);

    expect(drivenStats.hasNonFinite).toBe(false);
    expect(drivenStats.peak).toBeLessThanOrEqual(0.96);
    expect(drivenStats.rms).toBeGreaterThan(0.01);
    expect(drivenStats.rms).toBeLessThan(0.5);
    // preGain rises 10x at warmthGrit=0.95; auto-gain keeps RMS ratio well below preGain explosion
    expect(drivenStats.rms / Math.max(1e-4, cleanStats.rms)).toBeLessThan(4.5);
  });

  it('handles Drag-&-Drop processorChain reordering in LayerEngine without resets or NaNs', () => {
    const sampleRate = 48000;
    const layerA = createDefaultLayer('Reorder', 'chord-arp', 4, 'beats');
    const enabledChain = layerA.processorChain.map((c) => ({
      ...c,
      bypassed: false,
    }));
    const configA: LayerConfig = {
      ...layerA,
      processorChain: enabledChain,
    };
    const configReordered: LayerConfig = {
      ...configA,
      processorChain: [...enabledChain].reverse(),
    };

    const harmony: HarmonyFrame = computeHarmonyFrame(
      9,
      'natural_minor',
      'minor7',
      'static',
      0,
    );
    const router = new ModulationRouter();
    const pulses = new Map<string, number>();

    const engine = new LayerEngine(sampleRate, 512);
    engine.syncConfig(configA, defaultRegistry);
    engine.renderBlock(0, 512, 130, 4, harmony, router, pulses, true);
    const preReorderStats = analyzeStereoBuffer(
      engine.bufL.subarray(0, 512),
      engine.bufR.subarray(0, 512),
    );
    expect(preReorderStats.hasNonFinite).toBe(false);

    // Reorder chain live
    engine.syncConfig(configReordered, defaultRegistry);
    engine.renderBlock(512 / ((60 / 130) * sampleRate), 512, 130, 4, harmony, router, pulses, true);
    const postReorderStats = analyzeStereoBuffer(
      engine.bufL.subarray(0, 512),
      engine.bufR.subarray(0, 512),
    );
    expect(postReorderStats.hasNonFinite).toBe(false);
    expect(postReorderStats.peak).toBeLessThan(2.0);

    // Verify reversed processor order yields distinct audio compared to original order
    const controlEngine = new LayerEngine(sampleRate, 512);
    controlEngine.syncConfig(configA, defaultRegistry);
    controlEngine.renderBlock(0, 512, 130, 4, harmony, router, pulses, true);
    controlEngine.renderBlock(
      512 / ((60 / 130) * sampleRate),
      512,
      130,
      4,
      harmony,
      router,
      pulses,
      true,
    );

    let maxDiff = 0;
    for (let i = 0; i < 512; i += 1) {
      const diff = Math.abs(engine.bufL[i]! - controlEngine.bufL[i]!);
      if (diff > maxDiff) maxDiff = diff;
    }
    expect(maxDiff).toBeGreaterThan(1e-4);
  });

  it('passes Registry Contract Fuzzing across every TimeOperator, Voice, and ProcessorCard', () => {
    const rand = mulberry32(133742);
    const sampleRate = 48000;
    const harmony = computeHarmonyFrame(9, 'natural_minor', 'minor7', 'static', 0);

    // 1. Fuzz TimeOperators
    for (const op of defaultRegistry.listTimeOperators()) {
      let prevFrame = {
        warpedPhase: 0,
        pulseEnergy: 0,
        triggerIntensity: 0,
        accent: 0,
        stepIndex: 0,
      };
      for (let iter = 0; iter < 30; iter += 1) {
        const params: Record<string, number> = {};
        for (const p of op.parameters) {
          const r = iter === 0 ? 0 : iter === 1 ? 1 : rand();
          params[p.id] = clampParam(p, p.min + r * (p.max - p.min));
        }
        prevFrame = op.evaluateTime(
          {
            beatPosition: iter * 0.37,
            barPosition: (iter * 0.37) / 4,
            layerPhase: (iter * 0.13) % 1,
            cycleIndex: iter,
            cycleBeats: 4,
            beatsPerBar: 4,
            sampleRate,
          },
          params,
          prevFrame,
        );
        expect(Number.isFinite(prevFrame.warpedPhase)).toBe(true);
        expect(Number.isFinite(prevFrame.pulseEnergy)).toBe(true);
        expect(Number.isFinite(prevFrame.triggerIntensity)).toBe(true);
        expect(Number.isFinite(prevFrame.accent)).toBe(true);
      }
    }

    // 2. Fuzz Voices
    const bufL = new Float32Array(256);
    const bufR = new Float32Array(256);
    for (const voice of defaultRegistry.listVoices()) {
      const inst = voice.createInstance(sampleRate);
      for (let iter = 0; iter < 25; iter += 1) {
        const params: Record<string, number> = {};
        for (const p of voice.parameters) {
          const r = iter === 0 ? 0 : iter === 1 ? 1 : rand();
          params[p.id] = clampParam(p, p.min + r * (p.max - p.min));
        }
        bufL.fill(0);
        bufR.fill(0);
        inst.process(bufL, bufR, params, {
          sampleRate,
          numSamples: 256,
          beatPosition: iter * 0.5,
          beatsPerBar: 4,
          timeFrame: {
            warpedPhase: (iter * 0.17) % 1,
            pulseEnergy: 0.85,
            triggerIntensity: iter % 2 === 0 ? 0.9 : 0,
            accent: 0.7,
            stepIndex: iter,
          },
          harmony,
          prevPulseTrigger: 0,
        });
        const stats = analyzeStereoBuffer(bufL, bufR);
        expect(stats.hasNonFinite, `Voice ${voice.id} produced NaN/Inf`).toBe(false);
      }
    }

    // 3. Fuzz ProcessorCards
    for (const proc of defaultRegistry.listProcessors()) {
      const inst = proc.createInstance(sampleRate);
      for (let iter = 0; iter < 25; iter += 1) {
        const params: Record<string, number> = {};
        for (const p of proc.parameters) {
          const r = iter === 0 ? 0 : iter === 1 ? 1 : rand();
          params[p.id] = clampParam(p, p.min + r * (p.max - p.min));
        }
        for (let i = 0; i < 256; i += 1) {
          const s = Math.sin((2 * Math.PI * 180 * i) / sampleRate) * 0.7;
          bufL[i] = s;
          bufR[i] = s * 0.8;
        }
        inst.process(bufL, bufR, params, {
          sampleRate,
          numSamples: 256,
          bpm: 132,
          harmony,
          layerPulseEnergy: 0.75,
          layerTrigger: iter % 2 === 0 ? 0.8 : 0,
        });
        const stats = analyzeStereoBuffer(bufL, bufR);
        expect(stats.hasNonFinite, `Processor ${proc.id} produced NaN/Inf`).toBe(false);
      }
    }
  });

  it('meets performance budget: 10s of 48 kHz 4-layer stereo renders in < 1000 ms (>10x realtime)', () => {
    const snap = createHypnoticAMinorProject().activeSnapshot;
    const sampleRate = 48000;
    const totalSamples = 10 * sampleRate; // 480,000 stereo frames
    const blockSize = 128;

    const engine = new TechnoEngine(sampleRate);
    engine.applySnapshot(snap);
    const outL = new Float32Array(blockSize);
    const outR = new Float32Array(blockSize);

    // Warm up JIT slightly
    engine.processBlock(outL, outR, blockSize);
    engine.reset();

    const t0 = performance.now();
    let rendered = 0;
    while (rendered < totalSamples) {
      const chunk = Math.min(blockSize, totalSamples - rendered);
      engine.processBlock(outL, outR, chunk);
      rendered += chunk;
    }
    const elapsedMs = performance.now() - t0;

    expect(elapsedMs).toBeLessThan(1000);
  });
});
