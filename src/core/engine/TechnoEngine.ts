import { defaultRegistry } from '../defaultRegistry';
import { MasterBus } from '../dsp/masterBus';
import { clamp, sanitizeSampleRate } from '../dsp/smoothing';
import { ModulationRouter } from '../modulation/ModulationRouter';
import { ModuleRegistry } from '../registry/ModuleRegistry';
import { type HarmonyFrame } from '../registry/types';
import { type BeatSnapshot } from '../state/types';
import { computeCombinedCycleBeats, cycleToBeats } from '../theory/cycles';
import {
  computeHarmonyFrame,
  PROGRESSION_PRESETS,
  type ProgressionId,
} from '../theory/harmony';
import { LayerEngine } from './LayerEngine';
import { MasterClock } from './MasterClock';

const DEFAULT_MAX_BLOCK_SIZE = 4096;
const CROSSFADE_SECONDS = 0.015; // ~15 ms click-free snapshot/section transition

export interface EngineTelemetry {
  layerPhases: Float32Array;
  layerEnergies: Float32Array;
  combinedCycleBeats: number;
  currentBeat: number;
  currentBar: number;
}

interface ActiveLayerSlot {
  readonly layerId: string;
  readonly voiceModuleId: string;
  readonly engine: LayerEngine;
}

/**
 * Main pure-TypeScript audio engine orchestrating MasterClock, ModulationRouter,
 * all LayerEngines, MasterBus, click-free ~15 ms snapshot transitions, and UI telemetry.
 */
export class TechnoEngine {
  private sampleRate: number;
  private readonly maxBlockSize: number;
  private readonly registry: ModuleRegistry;

  private readonly clock: MasterClock;
  private readonly masterBus: MasterBus;
  private readonly router: ModulationRouter;

  private readonly mixL: Float32Array;
  private readonly mixR: Float32Array;

  private readonly layerEngineCache = new Map<string, LayerEngine>();
  private readonly activeSlots: ActiveLayerSlot[] = [];
  private readonly layerPulsesMap = new Map<string, number>();

  private snapshot: BeatSnapshot | null = null;
  private harmonyFramesByStep: HarmonyFrame[] = [];
  private isolatedLayerId: string | null = null;

  private crossfadeTotalSamples = 720;
  private crossfadeRemaining = 0;
  private xfadeHoldL = 0;
  private xfadeHoldR = 0;
  private lastOutL = 0;
  private lastOutR = 0;

  private readonly telemetry: EngineTelemetry;

  constructor(
    sampleRate = 48000,
    registry: ModuleRegistry = defaultRegistry,
    maxBlockSize = DEFAULT_MAX_BLOCK_SIZE,
  ) {
    this.sampleRate = sanitizeSampleRate(sampleRate);
    this.maxBlockSize = Math.max(64, maxBlockSize | 0);
    this.registry = registry;

    this.clock = new MasterClock(this.sampleRate, 130, 4);
    this.masterBus = new MasterBus(this.sampleRate);
    this.router = new ModulationRouter();

    this.mixL = new Float32Array(this.maxBlockSize);
    this.mixR = new Float32Array(this.maxBlockSize);

    this.crossfadeTotalSamples = Math.max(
      1,
      Math.round(CROSSFADE_SECONDS * this.sampleRate),
    );

    this.telemetry = {
      layerPhases: new Float32Array(0),
      layerEnergies: new Float32Array(0),
      combinedCycleBeats: 4,
      currentBeat: 0,
      currentBar: 0,
    };

    this.rebuildHarmonyCache(9, 'natural_minor', 'minor7', 'static');
  }

  public getSampleRate(): number {
    return this.sampleRate;
  }

  public setSampleRate(sr: number): void {
    const nextSr = sanitizeSampleRate(sr);
    if (nextSr === this.sampleRate) return;
    this.sampleRate = nextSr;
    this.clock.setSampleRate(this.sampleRate);
    this.masterBus.setSampleRate(this.sampleRate);
    for (const engine of this.layerEngineCache.values()) {
      engine.setSampleRate(this.sampleRate);
    }
    this.crossfadeTotalSamples = Math.max(
      1,
      Math.round(CROSSFADE_SECONDS * this.sampleRate),
    );
  }

  public getClock(): MasterClock {
    return this.clock;
  }

  public getSnapshot(): BeatSnapshot | null {
    return this.snapshot;
  }

  public getTelemetry(): EngineTelemetry {
    return this.telemetry;
  }

  /**
   * Isolates a single layer ID for stem rendering while keeping all enabled
   * layers' time frames active so layer-to-layer pulse sidechains stay intact.
   */
  public setIsolatedLayerId(layerId: string | null): void {
    this.isolatedLayerId = layerId;
  }

  /**
   * Resets all DSP states, clock position, telemetry, and crossfade state.
   */
  public reset(): void {
    this.clock.reset();
    this.masterBus.reset();
    this.mixL.fill(0);
    this.mixR.fill(0);
    for (const engine of this.layerEngineCache.values()) {
      engine.reset();
    }
    for (const key of this.layerPulsesMap.keys()) {
      this.layerPulsesMap.set(key, 0);
    }
    this.crossfadeRemaining = 0;
    this.xfadeHoldL = 0;
    this.xfadeHoldR = 0;
    this.lastOutL = 0;
    this.lastOutR = 0;
    this.telemetry.layerPhases.fill(0);
    this.telemetry.layerEnergies.fill(0);
    this.telemetry.currentBeat = 0;
    this.telemetry.currentBar = 0;
  }

  /**
   * Applies a BeatSnapshot, preserving existing LayerEngines, VoiceInstances,
   * and ProcessorInstances by ID for click-free live edits, and triggering a
   * smooth ~15 ms crossfade on section/snapshot/structural switches.
   */
  public applySnapshot(snapshot: BeatSnapshot): void {
    const prevSnapshot = this.snapshot;
    const isStructuralSwitch = this.detectStructuralSwitch(prevSnapshot, snapshot);

    this.snapshot = snapshot;

    this.clock.setTempoBpm(snapshot.tempoBpm);
    this.clock.setTimeSignature(
      snapshot.timeSignature.numerator,
      snapshot.timeSignature.denominator,
    );

    this.router.prepareSnapshot(snapshot);
    this.rebuildHarmonyCache(
      snapshot.harmony.rootNote,
      snapshot.harmony.scaleId,
      snapshot.harmony.chordPreset,
      snapshot.harmony.progressionId,
    );

    // Sync LayerEngines while reusing instances by layer.id
    this.activeSlots.length = 0;
    for (let i = 0; i < snapshot.layers.length; i++) {
      const layer = snapshot.layers[i]!;
      let engine = this.layerEngineCache.get(layer.id);
      if (!engine) {
        engine = new LayerEngine(this.sampleRate, this.maxBlockSize);
        this.layerEngineCache.set(layer.id, engine);
      }
      engine.syncConfig(layer, this.registry);
      this.activeSlots.push({
        layerId: layer.id,
        voiceModuleId: layer.voice.moduleId,
        engine,
      });

      if (!this.layerPulsesMap.has(layer.id)) {
        this.layerPulsesMap.set(layer.id, 0);
      }
    }

    // Prune deleted layers from caches
    for (const cachedId of this.layerEngineCache.keys()) {
      let exists = false;
      for (let i = 0; i < snapshot.layers.length; i++) {
        if (snapshot.layers[i]!.id === cachedId) {
          exists = true;
          break;
        }
      }
      if (!exists) {
        this.layerEngineCache.delete(cachedId);
        this.layerPulsesMap.delete(cachedId);
      }
    }

    // Resize telemetry arrays only when layer count changes (never in processBlock)
    if (this.telemetry.layerPhases.length !== snapshot.layers.length) {
      this.telemetry.layerPhases = new Float32Array(snapshot.layers.length);
      this.telemetry.layerEnergies = new Float32Array(snapshot.layers.length);
    }

    this.telemetry.combinedCycleBeats = this.computeCombinedCycle(snapshot);

    if (isStructuralSwitch && this.clock.totalSamples > 0) {
      this.xfadeHoldL = this.lastOutL;
      this.xfadeHoldR = this.lastOutR;
      this.crossfadeRemaining = this.crossfadeTotalSamples;
    }
  }

  /**
   * Renders `numSamples` of stereo audio into `outL` and `outR` with zero
   * heap allocations in the audio path.
   */
  public processBlock(
    outL: Float32Array,
    outR: Float32Array,
    numSamples: number,
  ): void {
    const totalCount = Math.min(numSamples | 0, outL.length, outR.length);
    if (totalCount <= 0) return;

    const snap = this.snapshot;
    if (!snap) {
      for (let i = 0; i < totalCount; i++) {
        outL[i] = 0;
        outR[i] = 0;
      }
      this.clock.advance(totalCount);
      this.telemetry.currentBeat = this.clock.beatPosition;
      this.telemetry.currentBar = this.clock.barPosition;
      return;
    }

    let processed = 0;
    while (processed < totalCount) {
      const chunk = Math.min(this.maxBlockSize, totalCount - processed);
      this.renderChunk(snap, outL, outR, processed, chunk);
      processed += chunk;
    }
  }

  private renderChunk(
    snap: BeatSnapshot,
    outL: Float32Array,
    outR: Float32Array,
    outOffset: number,
    count: number,
  ): void {
    this.mixL.fill(0, 0, count);
    this.mixR.fill(0, 0, count);

    const startBeat = this.clock.beatPosition;
    const tempoBpm = this.clock.tempoBpm;
    const beatsPerBar = this.clock.beatsPerBar;
    const barIndex = Math.floor(this.clock.barPosition);

    const frameCount = this.harmonyFramesByStep.length;
    const stepIdx =
      frameCount > 0 ? ((barIndex % frameCount) + frameCount) % frameCount : 0;
    const harmony = this.harmonyFramesByStep[stepIdx]!;

    // Determine solo status across enabled, unmuted layers
    let anySolo = false;
    if (this.isolatedLayerId === null) {
      for (let l = 0; l < snap.layers.length; l++) {
        const layer = snap.layers[l]!;
        if (layer.enabled && !layer.muted && layer.solo) {
          anySolo = true;
          break;
        }
      }
    }

    const mixL = this.mixL;
    const mixR = this.mixR;
    for (let l = 0; l < snap.layers.length; l++) {
      const layer = snap.layers[l]!;
      const slot = this.activeSlots[l];
      if (!slot) continue;

      let audible: boolean;
      if (this.isolatedLayerId !== null) {
        audible = layer.enabled && !layer.muted && layer.id === this.isolatedLayerId;
      } else {
        audible = layer.enabled && !layer.muted && (!anySolo || layer.solo);
      }

      slot.engine.renderBlock(
        startBeat,
        count,
        tempoBpm,
        beatsPerBar,
        harmony,
        this.router,
        this.layerPulsesMap,
        audible,
      );

      this.layerPulsesMap.set(layer.id, slot.engine.lastPulseEnergy);
      this.telemetry.layerPhases[l] = slot.engine.lastPhase;
      this.telemetry.layerEnergies[l] = slot.engine.lastPulseEnergy;

      if (!layer.enabled) continue;
      const srcL = slot.engine.bufL;
      const srcR = slot.engine.bufR;
      for (let i = 0; i < count; i++) {
        mixL[i]! += srcL[i]!;
        mixR[i]! += srcR[i]!;
      }
    }

    const masterGain = clamp(snap.masterGain, 0, 2);
    const masterGlue = clamp(snap.masterGlue, 0, 1);
    this.masterBus.processBlock(mixL, mixR, count, masterGain, masterGlue);

    if (this.crossfadeRemaining <= 0) {
      for (let i = 0; i < count; i++) {
        const l = mixL[i]!;
        const r = mixR[i]!;
        outL[outOffset + i] = l * 0 === 0 && (l > 1e-18 || l < -1e-18) ? l : 0;
        outR[outOffset + i] = r * 0 === 0 && (r > 1e-18 || r < -1e-18) ? r : 0;
      }
    } else {
      for (let i = 0; i < count; i++) {
        const l = mixL[i]!;
        const r = mixR[i]!;
        let sL = l * 0 === 0 && (l > 1e-18 || l < -1e-18) ? l : 0;
        let sR = r * 0 === 0 && (r > 1e-18 || r < -1e-18) ? r : 0;

        if (this.crossfadeRemaining > 0) {
          const alpha =
            1 - this.crossfadeRemaining / Math.max(1, this.crossfadeTotalSamples);
          sL = this.xfadeHoldL * (1 - alpha) + sL * alpha;
          sR = this.xfadeHoldR * (1 - alpha) + sR * alpha;
          this.xfadeHoldL *= 0.996;
          this.xfadeHoldR *= 0.996;
          this.crossfadeRemaining -= 1;
        }

        outL[outOffset + i] = sL;
        outR[outOffset + i] = sR;
      }
    }

    this.lastOutL = outL[outOffset + count - 1] ?? 0;
    this.lastOutR = outR[outOffset + count - 1] ?? 0;

    this.clock.advance(count);
    this.telemetry.currentBeat = this.clock.beatPosition;
    this.telemetry.currentBar = this.clock.barPosition;
  }

  private rebuildHarmonyCache(
    rootNote: number,
    scaleId: string,
    chordPreset: string,
    progressionId: string,
  ): void {
    const prog = Object.prototype.hasOwnProperty.call(
      PROGRESSION_PRESETS,
      progressionId,
    )
      ? PROGRESSION_PRESETS[progressionId as ProgressionId]
      : PROGRESSION_PRESETS.static;
    const stepCount = Math.max(1, prog.semitoneOffsets.length);
    const frames: HarmonyFrame[] = [];
    for (let s = 0; s < stepCount; s++) {
      frames.push(
        computeHarmonyFrame(rootNote, scaleId, chordPreset, progressionId, s),
      );
    }
    this.harmonyFramesByStep = frames;
  }

  private computeCombinedCycle(snapshot: BeatSnapshot): number {
    const beatsPerBar = this.clock.beatsPerBar;
    let combined = 4;
    let hasEnabled = false;

    for (let i = 0; i < snapshot.layers.length; i++) {
      const layer = snapshot.layers[i]!;
      if (!layer.enabled) continue;

      const layerBeats = cycleToBeats(
        layer.cycleLength.value,
        layer.cycleLength.unit,
        beatsPerBar,
      );
      combined = hasEnabled
        ? computeCombinedCycleBeats(combined, layerBeats)
        : layerBeats;
      hasEnabled = true;

      for (let m = 0; m < layer.modulations.length; m++) {
        const mod = layer.modulations[m]!;
        if (!mod.enabled) continue;

        if (mod.sourceType === 'wave-lfo' || mod.sourceType === 'macro-arc') {
          const defaultVal = mod.sourceType === 'macro-arc' ? 8 : 4;
          const defaultUnit = mod.sourceType === 'macro-arc' ? 'bars' : 'beats';
          const modBeats = cycleToBeats(
            mod.sourceConfig.cycleValue ?? defaultVal,
            mod.sourceConfig.cycleUnit ?? defaultUnit,
            beatsPerBar,
          );
          combined = computeCombinedCycleBeats(combined, modBeats);
        } else if (mod.sourceType === 'drawn-curve') {
          let cv: number | undefined;
          let cu: typeof mod.sourceConfig.cycleUnit;
          for (let c = 0; c < snapshot.curves.length; c++) {
            const curve = snapshot.curves[c]!;
            if (curve.id === mod.sourceConfig.curveId) {
              cv = curve.cycleValue;
              cu = curve.cycleUnit;
              break;
            }
          }
          cv = cv ?? mod.sourceConfig.cycleValue;
          cu = cu ?? mod.sourceConfig.cycleUnit;
          if (cv !== undefined && cu !== undefined) {
            combined = computeCombinedCycleBeats(
              combined,
              cycleToBeats(cv, cu, beatsPerBar),
            );
          }
        }
      }
    }

    return combined;
  }

  private detectStructuralSwitch(
    prev: BeatSnapshot | null,
    next: BeatSnapshot,
  ): boolean {
    if (!prev) return false;
    if (prev.id !== next.id) return true;
    if (prev.layers.length !== next.layers.length) return true;
    for (let i = 0; i < next.layers.length; i++) {
      const nextLayer = next.layers[i]!;
      const prevLayer = prev.layers[i]!;
      if (
        nextLayer.id !== prevLayer.id ||
        nextLayer.voice.moduleId !== prevLayer.voice.moduleId
      ) {
        return true;
      }
    }
    return false;
  }
}
