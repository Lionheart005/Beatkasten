import { TechnoEngine } from '../core/engine/TechnoEngine';
import { ArrangementEngine, type AudioAssetData } from '../core/arrangement/ArrangementEngine';
import type { ArrangementDoc } from '../core/arrangement/types';
import type { BeatSnapshot } from '../core/state/types';

export type PlaybackMode = 'beat' | 'arrangement';
/** Live CPU budget: simultaneously playing section clips. */
const LIVE_MAX_PLAYERS = 4;

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;

declare const sampleRate: number;
declare const currentFrame: number;

export const TECHNO_WORKLET_PROCESSOR_NAME = 'techno-wave-processor';
const TELEMETRY_INTERVAL_BLOCKS = 10; // ~37.5 Hz at 48 kHz / 128-sample quantum
const DEFAULT_QUANTUM_SIZE = 128;

export type WorkletInboundMessage =
  | { readonly type: 'snapshot'; readonly snapshot: BeatSnapshot }
  | { readonly type: 'queue-section'; readonly snapshot: BeatSnapshot }
  | { readonly type: 'play' }
  | { readonly type: 'stop' }
  | { readonly type: 'reset' }
  | { readonly type: 'set-mode'; readonly mode: PlaybackMode }
  | { readonly type: 'arrangement'; readonly doc: ArrangementDoc }
  | {
      readonly type: 'sections';
      readonly sections: ReadonlyArray<{ readonly id: string; readonly snapshot: BeatSnapshot }>;
    }
  | { readonly type: 'seek'; readonly beat: number }
  | {
      readonly type: 'asset-add';
      readonly id: string;
      readonly left: Float32Array;
      readonly right: Float32Array;
      readonly sampleRate: number;
    }
  | { readonly type: 'asset-remove'; readonly id: string }
  /** Metronome clicks until this song beat (-1 = off, Infinity not cloneable → 1e9). */
  | { readonly type: 'metronome'; readonly untilBeat: number; readonly level?: number };

export type WorkletOutboundMessage =
  | {
      readonly type: 'telemetry';
      readonly currentBeat: number;
      readonly currentBar: number;
      readonly combinedCycleBeats: number;
      readonly layerPhases: number[];
      readonly layerEnergies: number[];
      readonly peakLevel: number;
      readonly mode: PlaybackMode;
      /** Timeline only: */
      readonly songBeat?: number;
      readonly trackPeaks?: number[];
      readonly activePlayers?: number;
      readonly playerLimitHit?: boolean;
    }
  | { readonly type: 'section-switched'; readonly snapshotId: string }
  /** Audio-clock frame of the first rendered sample after 'play' (recording sync). */
  | { readonly type: 'play-started'; readonly frame: number; readonly songBeat: number; readonly mode: PlaybackMode };

if (
  typeof registerProcessor === 'function' &&
  typeof AudioWorkletProcessor === 'function'
) {
  class TechnoWaveProcessor extends AudioWorkletProcessor {
    private readonly engine: TechnoEngine;
    private outL: Float32Array;
    private outR: Float32Array;
    private isPlaying = false;
    private pendingSnapshot: BeatSnapshot | null = null;
    private blockCounter = 0;
    private heldPeakLevel = 0;
    private phaseScratch: number[] = [];
    private energyScratch: number[] = [];
    private mode: PlaybackMode = 'beat';
    private arrangement: ArrangementEngine | null = null;
    private arrangementDoc: ArrangementDoc | null = null;
    private sectionMap = new Map<string, BeatSnapshot>();
    private readonly assets = new Map<string, AudioAssetData>();
    private trackPeakScratch: number[] = [];
    private sampleRateHz = 48000;
    private reportPlayStart = false;

    constructor(options?: AudioWorkletNodeOptions) {
      super(options);
      const sr =
        typeof sampleRate === 'number' && Number.isFinite(sampleRate)
          ? sampleRate
          : 48000;
      this.engine = new TechnoEngine(sr);
      this.engine.setSampleBank((id) => this.assets.get(id));
      this.sampleRateHz = sr;
      this.outL = new Float32Array(DEFAULT_QUANTUM_SIZE);
      this.outR = new Float32Array(DEFAULT_QUANTUM_SIZE);

      this.port.onmessage = (event: MessageEvent<WorkletInboundMessage>) => {
        this.handleMessage(event.data);
      };
    }

    private handleMessage(msg: WorkletInboundMessage | undefined): void {
      if (!msg || typeof msg !== 'object') return;

      switch (msg.type) {
        case 'snapshot': {
          this.engine.applySnapshot(msg.snapshot);
          break;
        }
        case 'queue-section': {
          this.pendingSnapshot = msg.snapshot;
          break;
        }
        case 'play': {
          this.isPlaying = true;
          this.reportPlayStart = true;
          break;
        }
        case 'stop': {
          this.isPlaying = false;
          this.heldPeakLevel = 0;
          break;
        }
        case 'set-mode': {
          this.mode = msg.mode;
          if (msg.mode === 'arrangement') this.ensureArrangement();
          break;
        }
        case 'arrangement': {
          this.arrangementDoc = msg.doc;
          this.ensureArrangement().setArrangement(msg.doc, this.sectionMap);
          break;
        }
        case 'sections': {
          this.sectionMap = new Map(msg.sections.map((x) => [x.id, x.snapshot]));
          if (this.arrangement && this.arrangementDoc) {
            this.arrangement.setArrangement(this.arrangementDoc, this.sectionMap);
          }
          break;
        }
        case 'seek': {
          this.ensureArrangement().seekToBeat(msg.beat);
          break;
        }
        case 'asset-add': {
          this.assets.set(msg.id, {
            left: msg.left,
            right: msg.right,
            sampleRate: msg.sampleRate,
            length: Math.min(msg.left.length, msg.right.length),
          });
          this.arrangement?.refreshAssets();
          this.engine.refreshSamples();
          break;
        }
        case 'metronome': {
          this.ensureArrangement().setMetronome(msg.untilBeat, msg.level);
          break;
        }
        case 'asset-remove': {
          this.assets.delete(msg.id);
          this.arrangement?.refreshAssets();
          this.engine.refreshSamples();
          break;
        }
        case 'reset': {
          this.engine.reset();
          this.pendingSnapshot = null;
          this.blockCounter = 0;
          this.heldPeakLevel = 0;
          this.emitTelemetry(0);
          break;
        }
      }
    }

    private ensureArrangement(): ArrangementEngine {
      if (!this.arrangement) {
        this.arrangement = new ArrangementEngine(this.sampleRateHz, {
          maxPlayers: LIVE_MAX_PLAYERS,
          maxBlockSize: 1024,
          useLoop: true,
        });
        this.arrangement.setAssetLookup((id) => this.assets.get(id));
        if (this.arrangementDoc) this.arrangement.setArrangement(this.arrangementDoc, this.sectionMap);
      }
      return this.arrangement;
    }

    private emitTelemetry(peakLevel: number): void {
      if (this.mode === 'arrangement' && this.arrangement) {
        const at = this.arrangement.getTelemetry();
        const n = at.trackPeaks.length;
        if (this.trackPeakScratch.length !== n) this.trackPeakScratch.length = n;
        for (let i = 0; i < n; i++) {
          this.trackPeakScratch[i] = at.trackPeaks[i]!;
          at.trackPeaks[i] = 0;
        }
        const tm = this.arrangement.getCompiled().tempoMap;
        const bp = tm.barPosition(at.songBeat);
        const message: WorkletOutboundMessage = {
          type: 'telemetry',
          currentBeat: at.songBeat,
          currentBar: bp.bar + bp.beatInBar / bp.beatsPerBar,
          combinedCycleBeats: 4,
          layerPhases: [],
          layerEnergies: [],
          peakLevel,
          mode: 'arrangement',
          songBeat: at.songBeat,
          trackPeaks: this.trackPeakScratch,
          activePlayers: at.activePlayers,
          playerLimitHit: at.playerLimitHit,
        };
        at.masterPeak = 0;
        at.playerLimitHit = false;
        this.port.postMessage(message);
        return;
      }

      const t = this.engine.getTelemetry();
      const phaseCount = t.layerPhases.length;
      const energyCount = t.layerEnergies.length;

      if (this.phaseScratch.length !== phaseCount) {
        this.phaseScratch.length = phaseCount;
      }
      if (this.energyScratch.length !== energyCount) {
        this.energyScratch.length = energyCount;
      }

      for (let i = 0; i < phaseCount; i++) {
        this.phaseScratch[i] = t.layerPhases[i]!;
      }
      for (let i = 0; i < energyCount; i++) {
        this.energyScratch[i] = t.layerEnergies[i]!;
      }

      const message: WorkletOutboundMessage = {
        type: 'telemetry',
        currentBeat: t.currentBeat,
        currentBar: t.currentBar,
        combinedCycleBeats: t.combinedCycleBeats,
        layerPhases: this.phaseScratch,
        layerEnergies: this.energyScratch,
        peakLevel,
        mode: 'beat',
      };
      this.port.postMessage(message);
    }

    process(
      _inputs: Float32Array[][],
      outputs: Float32Array[][],
      _parameters: Record<string, Float32Array>,
    ): boolean {
      const outputBus = outputs[0];
      if (!outputBus || outputBus.length === 0) {
        return true;
      }

      const chanL = outputBus[0];
      const chanR = outputBus[1];
      if (!chanL) {
        return true;
      }

      const numSamples = chanL.length;

      if (!this.isPlaying) {
        chanL.fill(0);
        if (chanR) {
          chanR.fill(0);
        }
        return true;
      }

      if (this.outL.length < numSamples) {
        this.outL = new Float32Array(numSamples);
        this.outR = new Float32Array(numSamples);
      }

      const clock = this.engine.getClock();
      const currentBarIndex = Math.floor(clock.barPosition);

      if (this.reportPlayStart) {
        this.reportPlayStart = false;
        const frame = typeof currentFrame === 'number' ? currentFrame : 0;
        const songBeat = this.mode === 'arrangement' ? this.ensureArrangement().getSongBeat() : this.engine.getBeatPosition();
        this.port.postMessage({ type: 'play-started', frame, songBeat, mode: this.mode } satisfies WorkletOutboundMessage);
      }
      if (this.mode === 'arrangement') {
        this.ensureArrangement().processBlock(this.outL, this.outR, numSamples);
      } else {
        this.engine.processBlock(this.outL, this.outR, numSamples);
      }

      let blockPeak = 0;
      if (chanR) {
        for (let i = 0; i < numSamples; i++) {
          const l = this.outL[i]!;
          const r = this.outR[i]!;
          chanL[i] = l;
          chanR[i] = r;
          const absL = l < 0 ? -l : l;
          const absR = r < 0 ? -r : r;
          if (absL > blockPeak) blockPeak = absL;
          if (absR > blockPeak) blockPeak = absR;
        }
      } else {
        for (let i = 0; i < numSamples; i++) {
          const mono = 0.5 * (this.outL[i]! + this.outR[i]!);
          chanL[i] = mono;
          const absM = mono < 0 ? -mono : mono;
          if (absM > blockPeak) blockPeak = absM;
        }
      }

      if (blockPeak > this.heldPeakLevel) {
        this.heldPeakLevel = blockPeak;
      }

      const nextBarIndex = Math.floor(clock.barPosition);
      if (this.pendingSnapshot !== null && nextBarIndex !== currentBarIndex) {
        const nextSnap = this.pendingSnapshot;
        this.pendingSnapshot = null;
        this.engine.applySnapshot(nextSnap);
        const switchedMsg: WorkletOutboundMessage = {
          type: 'section-switched',
          snapshotId: nextSnap.id,
        };
        this.port.postMessage(switchedMsg);
      }

      this.blockCounter += 1;
      if (this.blockCounter >= TELEMETRY_INTERVAL_BLOCKS) {
        this.blockCounter = 0;
        const peak = this.heldPeakLevel;
        this.heldPeakLevel = 0;
        this.emitTelemetry(peak);
      }

      return true;
    }
  }

  registerProcessor(TECHNO_WORKLET_PROCESSOR_NAME, TechnoWaveProcessor);
}
