/// <reference types="vite/client" />
import type { BeatSnapshot } from '../core/state/types';
import {
  TECHNO_WORKLET_PROCESSOR_NAME,
  type WorkletInboundMessage,
  type WorkletOutboundMessage,
} from './WorkletProcessor';
import workletUrl from './WorkletProcessor.ts?worker&url';

const SNAPSHOT_THROTTLE_MS = 16;

export interface LiveTelemetry {
  readonly isPlaying: boolean;
  readonly currentBeat: number;
  readonly currentBar: number;
  readonly combinedCycleBeats: number;
  readonly layerPhases: readonly number[];
  readonly layerEnergies: readonly number[];
  readonly peakLevel: number;
}

interface PendingSectionCallback {
  readonly snapshotId: string;
  readonly callback: (snapshotId: string) => void;
}

function createInitialTelemetry(): LiveTelemetry {
  return {
    isPlaying: false,
    currentBeat: 0,
    currentBar: 0,
    combinedCycleBeats: 4,
    layerPhases: [],
    layerEnergies: [],
    peakLevel: 0,
  };
}

/**
 * Main-thread bridge managing AudioContext, AudioWorkletNode, throttled live
 * parameter snapshots (~16 ms), bar-quantized section switches, and telemetry.
 */
export class AudioBridge {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private moduleLoaded = false;
  private initPromise: Promise<void> | null = null;

  private isPlaying = false;
  private telemetry: LiveTelemetry = createInitialTelemetry();
  private readonly listeners = new Set<(telemetry: LiveTelemetry) => void>();

  private lastSnapshotSentAt = 0;
  private pendingThrottleSnapshot: BeatSnapshot | null = null;
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;

  private pendingSectionCallback: PendingSectionCallback | null = null;

  private async ensureInitialized(): Promise<void> {
    if (this.node && this.ctx) {
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      const AudioCtxCtor =
        globalThis.AudioContext ??
        (globalThis as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtxCtor) {
        throw new Error('Web Audio AudioContext is not supported in this environment.');
      }

      if (!this.ctx || this.ctx.state === 'closed') {
        try {
          this.ctx = new AudioCtxCtor({ sampleRate: 48000 });
        } catch {
          this.ctx = new AudioCtxCtor();
        }
        this.moduleLoaded = false;
      }

      if (!this.moduleLoaded) {
        const bustUrl = workletUrl.includes('?')
          ? `${workletUrl}&v=${Date.now()}`
          : `${workletUrl}?v=${Date.now()}`;
        await this.ctx.audioWorklet.addModule(bustUrl);
        this.moduleLoaded = true;
      }

      if (!this.node) {
        this.node = new AudioWorkletNode(this.ctx, TECHNO_WORKLET_PROCESSOR_NAME, {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        this.node.port.onmessage = (
          event: MessageEvent<WorkletOutboundMessage>,
        ) => {
          this.handleWorkletMessage(event.data);
        };
        this.node.connect(this.ctx.destination);
      }
    })();

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private postToWorklet(msg: WorkletInboundMessage): void {
    this.node?.port.postMessage(msg);
  }

  private clearThrottle(): void {
    if (this.throttleTimer !== null) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.pendingThrottleSnapshot = null;
  }

  private handleWorkletMessage(msg: WorkletOutboundMessage | undefined): void {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'telemetry') {
      this.telemetry = {
        isPlaying: this.isPlaying,
        currentBeat: msg.currentBeat,
        currentBar: msg.currentBar,
        combinedCycleBeats: msg.combinedCycleBeats,
        layerPhases: msg.layerPhases,
        layerEnergies: msg.layerEnergies,
        peakLevel: this.isPlaying ? msg.peakLevel : 0,
      };
      this.notifyListeners();
    } else if (msg.type === 'section-switched') {
      const pending = this.pendingSectionCallback;
      if (pending && pending.snapshotId === msg.snapshotId) {
        this.pendingSectionCallback = null;
        pending.callback(msg.snapshotId);
      }
    }
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.telemetry);
    }
  }

  public async start(initialSnapshot: BeatSnapshot): Promise<void> {
    await this.ensureInitialized();
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    this.clearThrottle();
    this.postToWorklet({ type: 'snapshot', snapshot: initialSnapshot });
    this.lastSnapshotSentAt = performance.now();
    this.postToWorklet({ type: 'play' });

    this.isPlaying = true;
    this.telemetry = {
      ...this.telemetry,
      isPlaying: true,
    };
    this.notifyListeners();
  }

  public async stop(): Promise<void> {
    this.isPlaying = false;
    this.clearThrottle();
    this.postToWorklet({ type: 'stop' });

    if (this.ctx && this.ctx.state === 'running') {
      await this.ctx.suspend();
    }

    this.telemetry = {
      ...this.telemetry,
      isPlaying: false,
      peakLevel: 0,
    };
    this.notifyListeners();
  }

  public async resetAndPlay(snapshot: BeatSnapshot): Promise<void> {
    await this.ensureInitialized();
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    this.clearThrottle();
    this.pendingSectionCallback = null;
    this.postToWorklet({ type: 'reset' });
    this.postToWorklet({ type: 'snapshot', snapshot });
    this.lastSnapshotSentAt = performance.now();
    this.postToWorklet({ type: 'play' });

    this.isPlaying = true;
    this.telemetry = {
      ...createInitialTelemetry(),
      isPlaying: true,
    };
    this.notifyListeners();
  }

  public updateSnapshot(snapshot: BeatSnapshot): void {
    if (!this.node) {
      return;
    }

    const now = performance.now();
    const elapsed = now - this.lastSnapshotSentAt;

    if (elapsed >= SNAPSHOT_THROTTLE_MS && this.throttleTimer === null) {
      this.postToWorklet({ type: 'snapshot', snapshot });
      this.lastSnapshotSentAt = now;
      return;
    }

    this.pendingThrottleSnapshot = snapshot;
    if (this.throttleTimer === null) {
      const delay = Math.max(0, SNAPSHOT_THROTTLE_MS - elapsed);
      this.throttleTimer = setTimeout(() => {
        this.throttleTimer = null;
        const latest = this.pendingThrottleSnapshot;
        this.pendingThrottleSnapshot = null;
        if (latest && this.node) {
          this.postToWorklet({ type: 'snapshot', snapshot: latest });
          this.lastSnapshotSentAt = performance.now();
        }
      }, delay);
    }
  }

  public scheduleSectionSwitchAtNextBar(
    snapshot: BeatSnapshot,
    onSwitched?: (snapshotId: string) => void,
  ): void {
    if (!this.node) {
      return;
    }

    this.pendingSectionCallback = onSwitched
      ? { snapshotId: snapshot.id, callback: onSwitched }
      : null;

    this.postToWorklet({ type: 'queue-section', snapshot });
  }

  public onTelemetry(listener: (telemetry: LiveTelemetry) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getTelemetry(): LiveTelemetry {
    return this.telemetry;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public async dispose(): Promise<void> {
    this.isPlaying = false;
    this.clearThrottle();
    this.pendingSectionCallback = null;
    this.listeners.clear();

    if (this.node) {
      this.postToWorklet({ type: 'stop' });
      this.node.port.onmessage = null;
      this.node.disconnect();
      this.node = null;
    }

    if (this.ctx && this.ctx.state !== 'closed') {
      await this.ctx.close();
    }
    this.ctx = null;
    this.moduleLoaded = false;
    this.telemetry = createInitialTelemetry();
  }
}
