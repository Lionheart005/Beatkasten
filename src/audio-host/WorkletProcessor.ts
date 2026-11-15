import { TechnoEngine } from '../core/engine/TechnoEngine';
import type { BeatSnapshot } from '../core/state/types';

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

export const TECHNO_WORKLET_PROCESSOR_NAME = 'techno-wave-processor';
const TELEMETRY_INTERVAL_BLOCKS = 6; // ~62.5 Hz at 48 kHz / 128-sample quantum
const DEFAULT_QUANTUM_SIZE = 128;

export type WorkletInboundMessage =
  | { readonly type: 'snapshot'; readonly snapshot: BeatSnapshot }
  | { readonly type: 'queue-section'; readonly snapshot: BeatSnapshot }
  | { readonly type: 'play' }
  | { readonly type: 'stop' }
  | { readonly type: 'reset' };

export type WorkletOutboundMessage =
  | {
      readonly type: 'telemetry';
      readonly currentBeat: number;
      readonly currentBar: number;
      readonly combinedCycleBeats: number;
      readonly layerPhases: number[];
      readonly layerEnergies: number[];
      readonly scopeL: number[];
      readonly scopeR: number[];
      readonly peakLevel: number;
    }
  | { readonly type: 'section-switched'; readonly snapshotId: string };

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

    constructor(options?: AudioWorkletNodeOptions) {
      super(options);
      const sr =
        typeof sampleRate === 'number' && Number.isFinite(sampleRate)
          ? sampleRate
          : 48000;
      this.engine = new TechnoEngine(sr);
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
          break;
        }
        case 'stop': {
          this.isPlaying = false;
          this.heldPeakLevel = 0;
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

    private emitTelemetry(peakLevel: number): void {
      const t = this.engine.getTelemetry();
      const message: WorkletOutboundMessage = {
        type: 'telemetry',
        currentBeat: t.currentBeat,
        currentBar: t.currentBar,
        combinedCycleBeats: t.combinedCycleBeats,
        layerPhases: Array.from(t.layerPhases),
        layerEnergies: Array.from(t.layerEnergies),
        scopeL: Array.from(t.scopeL),
        scopeR: Array.from(t.scopeR),
        peakLevel,
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

      this.engine.processBlock(this.outL, this.outR, numSamples);

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
