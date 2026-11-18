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
  createBellsAndOrganPreset,
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
  it('enforces zero NaN/Inf, headroom <= 0.96, and DC offset < 0.01 on all starter presets', () => {
    const hypnotic = createHypnoticAMinorProject();
    const snapshots: Array<{ name: string; snap: BeatSnapshot }> = [
      { name: 'hypnotic-main', snap: hypnotic.activeSnapshot },
      { name: 'hypnotic-intro', snap: hypnotic.sections[0]!.snapshot },
      { name: 'hypnotic-break', snap: hypnotic.sections[2]!.snapshot },
      { name: 'triplet-riddle', snap: createTripletRiddlePreset() },
      { name: 'chord-to-offbeat-arp', snap: createChordToOffbeatArpPreset() },
      { name: 'bells-and-organ', snap: createBellsAndOrganPreset() },
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

  it('supports dual-voice secondaryVoice mix sweep (pipe-organ + modal-bell) with zero NaN/Inf and bounded headroom', () => {
    const baseOrgan = createDefaultLayer('Dual Voice Test', 'pipe-organ', 4, 'beats');
    const mixValues = [0, 0.25, 0.5, 0.75, 1.0];

    for (const mix of mixValues) {
      const layer: LayerConfig = {
        ...baseOrgan,
        id: `dual_mix_${mix}`,
        level: 0.8,
        secondaryVoice: {
          enabled: true,
          moduleId: 'modal-bell',
          version: 1,
          mix,
          params: {
            material: 0.85,
            malletHardness: 0.6,
            decay: 0.8,
            shimmer: 0.4,
            octaveShift: 1,
            melodyPattern: 1,
            melodyRange: 0.5,
          },
        },
        modulations: [
          {
            id: 'mod_sec_shimmer',
            enabled: true,
            sourceType: 'wave-lfo',
            sourceConfig: { waveform: 'sine', cycleValue: 2, cycleUnit: 'beats' },
            targetDomain: 'voice',
            targetCardId: 'secondary-voice',
            targetParamId: 'shimmer',
            combineMode: 'add',
            depth: 0.25,
          },
        ],
      };

      const snap: BeatSnapshot = {
        id: `snap_dual_${mix}`,
        tempoBpm: 126,
        timeSignature: { numerator: 4, denominator: 4 },
        masterGain: 0.9,
        masterGlue: 0.25,
        harmony: {
          rootNote: 9,
          scaleId: 'dorian',
          chordPreset: 'minor7',
          progressionId: 'classic_i_VI_VII_i',
        },
        curves: [],
        layers: [layer],
      };

      const rendered = renderOfflineLoop(snap, {
        sampleRate: 48000,
        bars: 2,
        preRollBars: 0,
      });
      const stats = analyzeStereoBuffer(rendered.left, rendered.right);
      expect(stats.hasNonFinite, `mix=${mix} produced NaN/Inf`).toBe(false);
      expect(stats.peak, `mix=${mix} exceeded headroom`).toBeLessThanOrEqual(0.96);
      expect(stats.rms, `mix=${mix} produced silent output`).toBeGreaterThan(0.005);
      expect(Math.abs(stats.dcL), `mix=${mix} left DC too high`).toBeLessThan(0.01);
      expect(Math.abs(stats.dcR), `mix=${mix} right DC too high`).toBeLessThan(0.01);
    }

    // Verify smooth live mix transition on LayerEngine without clicks or NaNs
    const sampleRate = 48000;
    const engine = new LayerEngine(sampleRate, 512);
    const router = new ModulationRouter();
    const pulses = new Map<string, number>();
    const harmony = computeHarmonyFrame(9, 'dorian', 'minor7', 'static', 0);

    const cfgStart: LayerConfig = {
      ...baseOrgan,
      secondaryVoice: {
        enabled: true,
        moduleId: 'modal-bell',
        version: 1,
        mix: 0.2,
        params: defaultVoiceParamsForTest('modal-bell'),
      },
    };
    const cfgMid: LayerConfig = {
      ...cfgStart,
      secondaryVoice: {
        ...cfgStart.secondaryVoice!,
        mix: 0.8,
      },
    };

    engine.syncConfig(cfgStart, defaultRegistry);
    engine.renderBlock(0, 512, 126, 4, harmony, router, pulses, true);
    const block1Stats = analyzeStereoBuffer(
      engine.bufL.subarray(0, 512),
      engine.bufR.subarray(0, 512),
    );
    expect(block1Stats.hasNonFinite).toBe(false);

    engine.syncConfig(cfgMid, defaultRegistry);
    engine.renderBlock(
      512 / ((60 / 126) * sampleRate),
      512,
      126,
      4,
      harmony,
      router,
      pulses,
      true,
    );
    const block2Stats = analyzeStereoBuffer(
      engine.bufL.subarray(0, 512),
      engine.bufR.subarray(0, 512),
    );
    expect(block2Stats.hasNonFinite).toBe(false);
    expect(block2Stats.peak).toBeLessThan(2.0);
  });

  it('PipeOrganVoice droneHold=1 holds continuous steady audio during pulse troughs and bypassing time-pulse-interference sustains across bars', () => {
    const sampleRate = 48000;
    const baseLayer = createDefaultLayer('Organ Drone', 'pipe-organ', 4, 'beats', { legacyTime: true });

    const droneLayer: LayerConfig = {
      ...baseLayer,
      level: 0.85,
      timeOperators: baseLayer.timeOperators.map((op) =>
        op.moduleId === 'time-pulse-interference'
          ? {
              ...op,
              bypassed: false,
              params: {
                freqA: 2,
                freqB: 2,
                interferenceMix: 0,
                phaseOffset: 0,
                threshold: 0.75, // Deep zero-energy troughs between peaks
                waveShape: 0,
              },
            }
          : op,
      ),
      voice: {
        ...baseLayer.voice,
        params: {
          ...baseLayer.voice.params,
          register: 0.6,
          chiff: 0.2,
          tremolo: 0.0,
          release: 0.08, // Short release so any trough dip would show up clearly without droneHold
          droneHold: 1,
          voiceMode: 2,
          octaveShift: 0,
          melodyPattern: 0,
        },
      },
      processorChain: baseLayer.processorChain.map((c) => ({ ...c, bypassed: true })),
    };

    const makeSnap = (id: string, layer: LayerConfig): BeatSnapshot => ({
      id,
      tempoBpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      masterGain: 0.9,
      masterGlue: 0,
      harmony: {
        rootNote: 9,
        scaleId: 'natural_minor',
        chordPreset: 'minor',
        progressionId: 'static',
      },
      curves: [],
      layers: [layer],
    });

    // 1. droneHold=1 stays steady even during low/zero pulseEnergy troughs
    const droneRendered = renderOfflineLoop(makeSnap('snap_organ_drone', droneLayer), {
      sampleRate,
      bars: 2,
      preRollBars: 0,
    });
    const droneStats = analyzeStereoBuffer(droneRendered.left, droneRendered.right);
    expect(droneStats.hasNonFinite).toBe(false);
    expect(droneStats.rms).toBeGreaterThan(0.05);

    // Sample 100 ms windows across bar 2 (including troughs at beat 1, 3)
    const samplesPerBeat = Math.round((60 / 120) * sampleRate); // 24000
    const windowLen = Math.round(0.1 * sampleRate);
    const troughOffset = samplesPerBeat * 5 - Math.round(windowLen / 2);
    const peakOffset = samplesPerBeat * 4 + Math.round(0.05 * sampleRate);
    const troughStats = analyzeStereoBuffer(
      droneRendered.left.subarray(troughOffset, troughOffset + windowLen),
      droneRendered.right.subarray(troughOffset, troughOffset + windowLen),
    );
    const peakStats = analyzeStereoBuffer(
      droneRendered.left.subarray(peakOffset, peakOffset + windowLen),
      droneRendered.right.subarray(peakOffset, peakOffset + windowLen),
    );
    expect(troughStats.rms).toBeGreaterThan(0.05);
    expect(troughStats.rms / peakStats.rms).toBeGreaterThan(0.8);

    // 1b. droneHold=0 follows pulse troughs and drops significantly in valleys
    const pulsedLayer: LayerConfig = {
      ...droneLayer,
      voice: {
        ...droneLayer.voice,
        params: {
          ...droneLayer.voice.params,
          release: 0.32,
          droneHold: 0,
        },
      },
    };
    const pulsedRendered = renderOfflineLoop(makeSnap('snap_organ_pulsed', pulsedLayer), {
      sampleRate,
      bars: 2,
      preRollBars: 0,
    });
    const pulsedTroughStats = analyzeStereoBuffer(
      pulsedRendered.left.subarray(troughOffset, troughOffset + windowLen),
      pulsedRendered.right.subarray(troughOffset, troughOffset + windowLen),
    );
    const pulsedPeakStats = analyzeStereoBuffer(
      pulsedRendered.left.subarray(peakOffset, peakOffset + windowLen),
      pulsedRendered.right.subarray(peakOffset, peakOffset + windowLen),
    );
    expect(pulsedTroughStats.hasNonFinite).toBe(false);
    expect(pulsedPeakStats.rms).toBeGreaterThan(0.02);
    expect(pulsedTroughStats.rms).toBeLessThan(pulsedPeakStats.rms * 0.35);

    // 2. Bypassing time-pulse-interference produces steady non-zero continuous audio across bars (even at droneHold=0)
    const bypassedLayer: LayerConfig = {
      ...droneLayer,
      timeOperators: droneLayer.timeOperators.map((op) =>
        op.moduleId === 'time-pulse-interference' ? { ...op, bypassed: true } : op,
      ),
      voice: {
        ...droneLayer.voice,
        params: {
          ...droneLayer.voice.params,
          release: 0.7,
          droneHold: 0,
        },
      },
    };
    const bypassedRendered = renderOfflineLoop(
      makeSnap('snap_organ_bypassed', bypassedLayer),
      {
        sampleRate,
        bars: 2,
        preRollBars: 0,
      },
    );
    const bypassedStats = analyzeStereoBuffer(
      bypassedRendered.left,
      bypassedRendered.right,
    );
    expect(bypassedStats.hasNonFinite).toBe(false);
    expect(bypassedStats.rms).toBeGreaterThan(0.05);

    const bar1Mid = samplesPerBeat * 2;
    const bar2End = samplesPerBeat * 7;
    const bar1Stats = analyzeStereoBuffer(
      bypassedRendered.left.subarray(bar1Mid, bar1Mid + windowLen),
      bypassedRendered.right.subarray(bar1Mid, bar1Mid + windowLen),
    );
    const bar2Stats = analyzeStereoBuffer(
      bypassedRendered.left.subarray(bar2End, bar2End + windowLen),
      bypassedRendered.right.subarray(bar2End, bar2End + windowLen),
    );
    expect(bar1Stats.rms).toBeGreaterThan(0.05);
    expect(bar2Stats.rms).toBeGreaterThan(0.05);
    expect(Math.min(bar1Stats.rms, bar2Stats.rms) / Math.max(bar1Stats.rms, bar2Stats.rms)).toBeGreaterThan(0.9);
  });

  it('ChordArpVoice droneHold=1 holds continuous steady audio across peak and trough halves of time-pulse-interference', () => {
    const sampleRate = 48000;
    const baseLayer = createDefaultLayer('Chord Drone', 'chord-arp', 4, 'beats', { legacyTime: true });

    const droneLayer: LayerConfig = {
      ...baseLayer,
      level: 0.85,
      timeOperators: baseLayer.timeOperators.map((op) =>
        op.moduleId === 'time-pulse-interference'
          ? {
              ...op,
              bypassed: false,
              params: {
                freqA: 2,
                freqB: 2,
                interferenceMix: 0,
                phaseOffset: 0,
                threshold: 0.75, // Deep zero-energy troughs between peaks
                waveShape: 0,
              },
            }
          : op,
      ),
      voice: {
        ...baseLayer.voice,
        params: {
          ...baseLayer.voice.params,
          chordArpMorph: 0,
          droneHold: 1,
          softness: 0.05,
        },
      },
      processorChain: baseLayer.processorChain.map((c) => ({ ...c, bypassed: true })),
    };

    const snap: BeatSnapshot = {
      id: 'snap_chord_drone',
      tempoBpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      masterGain: 0.9,
      masterGlue: 0,
      harmony: {
        rootNote: 9,
        scaleId: 'natural_minor',
        chordPreset: 'minor',
        progressionId: 'static',
      },
      curves: [],
      layers: [droneLayer],
    };

    const rendered = renderOfflineLoop(snap, {
      sampleRate,
      bars: 2,
      preRollBars: 0,
    });
    const fullStats = analyzeStereoBuffer(rendered.left, rendered.right);
    expect(fullStats.hasNonFinite).toBe(false);
    expect(fullStats.rms).toBeGreaterThan(0.05);

    // Sample 100 ms windows in peak and trough halves of bar 2
    const samplesPerBeat = Math.round((60 / 120) * sampleRate); // 24000
    const windowLen = Math.round(0.1 * sampleRate);
    const troughOffset = samplesPerBeat * 5 - Math.round(windowLen / 2);
    const peakOffset = samplesPerBeat * 4 + Math.round(0.05 * sampleRate);

    const troughStats = analyzeStereoBuffer(
      rendered.left.subarray(troughOffset, troughOffset + windowLen),
      rendered.right.subarray(troughOffset, troughOffset + windowLen),
    );
    const peakStats = analyzeStereoBuffer(
      rendered.left.subarray(peakOffset, peakOffset + windowLen),
      rendered.right.subarray(peakOffset, peakOffset + windowLen),
    );

    expect(troughStats.hasNonFinite).toBe(false);
    expect(troughStats.rms).toBeGreaterThan(0.05);
    expect(troughStats.rms / peakStats.rms).toBeGreaterThan(0.8);

    // Also verify droneHold=0 drops cleanly in the pulse trough
    const pulsedChordSnap: BeatSnapshot = {
      ...snap,
      id: 'snap_chord_pulsed',
      layers: [
        {
          ...droneLayer,
          voice: {
            ...droneLayer.voice,
            params: {
              ...droneLayer.voice.params,
              droneHold: 0,
            },
          },
        },
      ],
    };
    const pulsedRendered = renderOfflineLoop(pulsedChordSnap, {
      sampleRate,
      bars: 2,
      preRollBars: 0,
    });
    const pulsedTroughStats = analyzeStereoBuffer(
      pulsedRendered.left.subarray(troughOffset, troughOffset + windowLen),
      pulsedRendered.right.subarray(troughOffset, troughOffset + windowLen),
    );
    const pulsedPeakStats = analyzeStereoBuffer(
      pulsedRendered.left.subarray(peakOffset, peakOffset + windowLen),
      pulsedRendered.right.subarray(peakOffset, peakOffset + windowLen),
    );
    expect(pulsedTroughStats.hasNonFinite).toBe(false);
    expect(pulsedPeakStats.rms).toBeGreaterThan(0.02);
    expect(pulsedTroughStats.rms).toBeLessThan(pulsedPeakStats.rms * 0.35);
  });

  it('modulates layer-mix level with drawn-curve and pan from L to R', () => {
    const sampleRate = 48000;
    const base = createDefaultLayer('Mix Mod', 'pipe-organ', 4, 'beats');
    const droneLayer: LayerConfig = {
      ...base,
      level: 0.8,
      pan: 0,
      timeOperators: [],
      voice: {
        ...base.voice,
        params: {
          ...base.voice.params,
          droneHold: 1,
        },
      },
      processorChain: base.processorChain.map((c) => ({ ...c, bypassed: true })),
      modulations: [
        {
          id: 'r_mix_level',
          enabled: true,
          sourceType: 'drawn-curve',
          sourceConfig: { curveId: 'curve_mix_ramp' },
          targetDomain: 'voice',
          targetCardId: 'layer-mix',
          targetParamId: 'level',
          combineMode: 'multiply',
          depth: 1,
        },
      ],
    };

    const levelSnap: BeatSnapshot = {
      id: 'snap_mix_level',
      tempoBpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      masterGain: 1,
      masterGlue: 0,
      harmony: {
        rootNote: 9,
        scaleId: 'natural_minor',
        chordPreset: 'minor',
        progressionId: 'static',
      },
      curves: [
        {
          id: 'curve_mix_ramp',
          name: 'Mix Ramp',
          cycleValue: 1,
          cycleUnit: 'bars',
          snapDivision: 0,
          points: [
            { x: 0, y: 0 },
            { x: 0.25, y: 0 },
            { x: 0.5, y: 1 },
            { x: 0.75, y: 1 },
            { x: 1, y: 0 },
          ],
        },
      ],
      layers: [droneLayer],
    };

    const renderedLevel = renderOfflineLoop(levelSnap, {
      sampleRate,
      bars: 1,
      preRollBars: 0,
    });
    const totalSamples = renderedLevel.left.length;
    const q1End = Math.floor(totalSamples * 0.25);
    const q3Start = Math.floor(totalSamples * 0.5);
    const q3End = Math.floor(totalSamples * 0.75);

    const q1Stats = analyzeStereoBuffer(
      renderedLevel.left.subarray(0, q1End),
      renderedLevel.right.subarray(0, q1End),
    );
    const q3Stats = analyzeStereoBuffer(
      renderedLevel.left.subarray(q3Start, q3End),
      renderedLevel.right.subarray(q3Start, q3End),
    );

    expect(q1Stats.hasNonFinite).toBe(false);
    expect(q3Stats.hasNonFinite).toBe(false);
    expect(q3Stats.rms).toBeGreaterThan(0.05);
    expect(q1Stats.rms).toBeLessThan(q3Stats.rms * 0.25);

    // Pan modulation: drawn-curve 0 -> 1 with add depth=1 from base pan=0 shifts energy from L (-1) to R (+1)
    const panLayer: LayerConfig = {
      ...droneLayer,
      pan: 0,
      modulations: [
        {
          id: 'r_mix_pan',
          enabled: true,
          sourceType: 'drawn-curve',
          sourceConfig: { curveId: 'curve_mix_pan' },
          targetDomain: 'voice',
          targetCardId: 'layer-mix',
          targetParamId: 'pan',
          combineMode: 'add',
          depth: 1,
        },
      ],
    };

    const panSnap: BeatSnapshot = {
      ...levelSnap,
      id: 'snap_mix_pan',
      curves: [
        {
          id: 'curve_mix_pan',
          name: 'Pan Sweep',
          cycleValue: 1,
          cycleUnit: 'bars',
          snapDivision: 0,
          points: [
            { x: 0, y: 0 },
            { x: 0.15, y: 0 },
            { x: 0.3, y: 0 },
            { x: 0.6, y: 1 },
            { x: 0.85, y: 1 },
            { x: 1, y: 0 },
          ],
        },
      ],
      layers: [panLayer],
    };

    const renderedPan = renderOfflineLoop(panSnap, {
      sampleRate,
      bars: 1,
      preRollBars: 0,
    });

    const rmsMono = (buf: Float32Array) => {
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
      return Math.sqrt(sum / Math.max(1, buf.length));
    };

    const panLeftStart = Math.floor(totalSamples * 0.05);
    const panLeftEnd = Math.floor(totalSamples * 0.25);
    const panRightStart = Math.floor(totalSamples * 0.65);
    const panRightEnd = Math.floor(totalSamples * 0.8);

    const leftAtStart = rmsMono(renderedPan.left.subarray(panLeftStart, panLeftEnd));
    const rightAtStart = rmsMono(renderedPan.right.subarray(panLeftStart, panLeftEnd));
    const leftAtRight = rmsMono(renderedPan.left.subarray(panRightStart, panRightEnd));
    const rightAtRight = rmsMono(renderedPan.right.subarray(panRightStart, panRightEnd));

    expect(leftAtStart).toBeGreaterThan(0.05);
    expect(rightAtStart).toBeLessThan(leftAtStart * 0.7);
    expect(rightAtRight).toBeGreaterThan(0.05);
    expect(leftAtRight).toBeLessThan(rightAtRight * 0.7);
  });
});

function defaultVoiceParamsForTest(moduleId: string): Record<string, number> {
  const mod = defaultRegistry.getVoice(moduleId);
  if (!mod) return {};
  const out: Record<string, number> = {};
  for (const p of mod.parameters) {
    out[p.id] = p.defaultValue;
  }
  return out;
}
