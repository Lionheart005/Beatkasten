import { defaultRegistry } from '../defaultRegistry';
import { MasterBus } from '../dsp/masterBus';
import { clamp, sanitizeSampleRate } from '../dsp/smoothing';
import { ModulationRouter } from '../modulation/ModulationRouter';
import { ModuleRegistry } from '../registry/ModuleRegistry';
import { type HarmonyFrame, type MutableHarmonyFrame } from '../registry/types';
import { type BeatSnapshot } from '../state/types';
import { computeSnapshotCycleBeats } from './cycleMath';
import { buildHarmonyTimeline, type HarmonyTimeline } from '../theory/progression';
import { LayerEngine } from './LayerEngine';
import { MasterClock } from './MasterClock';

const DEFAULT_MAX_BLOCK_SIZE = 4096;
const CROSSFADE_SECONDS = 0.015; // ~15 ms click-free snapshot/section transition
/** Max chunk length while a glide/crossfade chord transition is running. */
const TRANSITION_CHUNK_SAMPLES = 256;

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
  private harmonyTimeline: HarmonyTimeline;
  private harmonyKey = '';
  private harmonyCursor = 0;
  private readonly liveHarmony: MutableHarmonyFrame;
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

    this.harmonyTimeline = buildHarmonyTimeline(
      { rootNote: 9, scaleId: 'natural_minor', chordPreset: 'minor7', progressionId: 'static' },
      4,
    );
    const first = this.harmonyTimeline.steps[0]!.frame;
    this.liveHarmony = {
      rootNote: first.rootNote,
      rootMidi: first.rootMidi,
      scaleId: first.scaleId,
      chordPreset: first.chordPreset,
      scaleNotesMidi: first.scaleNotesMidi,
      chordNotesMidi: first.chordNotesMidi,
      bassMidi: first.rootMidi,
      nextChordNotesMidi: first.chordNotesMidi,
      transitionType: 'cut',
      transitionProgress: 0,
      stepIndex: 0,
    };
  }

  /** Current harmony timeline (for tests / UI previews). */
  public getHarmonyTimeline(): HarmonyTimeline {
    return this.harmonyTimeline;
  }

  /** Jumps the clock to an absolute beat position (used by offline pre-roll). */
  public seekToBeat(beat: number): void {
    this.clock.seekToBeat(beat);
    this.telemetry.currentBeat = this.clock.beatPosition;
    this.telemetry.currentBar = this.clock.barPosition;
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
    this.rebuildHarmonyCache(snapshot);

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
      const chunk = Math.min(
        this.maxBlockSize,
        totalCount - processed,
        this.samplesUntilHarmonyEvent(),
      );
      this.renderChunk(snap, outL, outR, processed, chunk);
      processed += chunk;
    }
  }

  private locateHarmonyStep(pos: number): number {
    const steps = this.harmonyTimeline.steps;
    const n = steps.length;
    let idx = this.harmonyCursor < n ? this.harmonyCursor : 0;
    const cur = steps[idx]!;
    if (pos >= cur.startBeat && pos < cur.endBeat) return idx;
    const next = (idx + 1) % n;
    const nxt = steps[next]!;
    if (pos >= nxt.startBeat && pos < nxt.endBeat) {
      this.harmonyCursor = next;
      return next;
    }
    idx = n - 1;
    for (let i = 0; i < n; i++) {
      if (pos < steps[i]!.endBeat) {
        idx = i;
        break;
      }
    }
    this.harmonyCursor = idx;
    return idx;
  }

  private harmonyPosition(): number {
    const total = this.harmonyTimeline.totalBeats;
    const beat = this.clock.beatPosition;
    return ((beat % total) + total) % total;
  }

  /** Samples until the next chord boundary (chunks never straddle a chord change). */
  private samplesUntilHarmonyEvent(): number {
    const steps = this.harmonyTimeline.steps;
    if (steps.length <= 1) return this.maxBlockSize;
    const pos = this.harmonyPosition();
    const step = steps[this.locateHarmonyStep(pos)]!;
    const beatsLeft = step.endBeat - pos;
    if (
      step.transitionType !== 'cut' &&
      step.transitionBeats > 0 &&
      beatsLeft <= step.transitionBeats
    ) {
      const toBoundary = Math.ceil(beatsLeft * this.clock.samplesPerBeat);
      return Math.max(1, Math.min(TRANSITION_CHUNK_SAMPLES, toBoundary));
    }
    let toWindow = beatsLeft;
    if (step.transitionType !== 'cut' && step.transitionBeats > 0) {
      toWindow = beatsLeft - step.transitionBeats;
    }
    return Math.max(1, Math.ceil(toWindow * this.clock.samplesPerBeat));
  }

  private updateLiveHarmony(): HarmonyFrame {
    const steps = this.harmonyTimeline.steps;
    const pos = this.harmonyPosition();
    const idx = this.locateHarmonyStep(pos);
    const step = steps[idx]!;
    const next = steps[(idx + 1) % steps.length]!;
    const f = step.frame;
    const lh = this.liveHarmony;
    lh.rootNote = f.rootNote;
    lh.rootMidi = f.rootMidi;
    lh.bassMidi = f.rootMidi;
    lh.scaleId = f.scaleId;
    lh.chordPreset = f.chordPreset;
    lh.scaleNotesMidi = f.scaleNotesMidi;
    lh.chordNotesMidi = f.chordNotesMidi;
    lh.nextChordNotesMidi = next.frame.chordNotesMidi;
    lh.transitionType = step.transitionType;
    lh.stepIndex = idx;
    const tb = step.transitionBeats;
    if (step.transitionType !== 'cut' && tb > 0 && steps.length > 1) {
      const p = (pos - (step.endBeat - tb)) / tb;
      lh.transitionProgress = p <= 0 ? 0 : p >= 1 ? 1 : p;
    } else {
      lh.transitionProgress = 0;
    }
    return lh;
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
    const harmony = this.updateLiveHarmony();

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

  private rebuildHarmonyCache(snapshot: BeatSnapshot): void {
    const bpb = this.clock.beatsPerBar;
    // applySnapshot runs on every slider move: only re-solve when harmony changed.
    const key = `${bpb}|${JSON.stringify(snapshot.harmony)}`;
    if (key === this.harmonyKey) return;
    this.harmonyKey = key;
    this.harmonyTimeline = buildHarmonyTimeline(snapshot.harmony, bpb);
    this.harmonyCursor = 0;
  }

  private computeCombinedCycle(snapshot: BeatSnapshot): number {
    return computeSnapshotCycleBeats(
      snapshot,
      this.clock.beatsPerBar,
      this.harmonyTimeline.steps.length > 1 ? this.harmonyTimeline.totalBeats : 0,
    );
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
