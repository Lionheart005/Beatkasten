/// <reference types="vite/client" />
import type { ArrangementDoc } from '../core/arrangement/types';
import type { BeatSnapshot } from '../core/state/types';
import {
  TECHNO_WORKLET_PROCESSOR_NAME,
  type PlaybackMode,
  type WorkletInboundMessage,
  type WorkletOutboundMessage,
} from './WorkletProcessor';
import workletUrl from './WorkletProcessor.ts?worker&url';

const SNAPSHOT_THROTTLE_MS = 16;
const ARRANGEMENT_DEBOUNCE_MS = 30;

export type { PlaybackMode };

export interface SectionRef {
  readonly id: string;
  readonly snapshot: BeatSnapshot;
}

export interface LiveTelemetry {
  readonly isPlaying: boolean;
  readonly currentBeat: number;
  readonly currentBar: number;
  readonly combinedCycleBeats: number;
  readonly layerPhases: readonly number[];
  readonly layerEnergies: readonly number[];
  readonly peakLevel: number;
  readonly mode: PlaybackMode;
  /** Timeline workspace only. */
  readonly songBeat: number;
  readonly trackPeaks: readonly number[];
  readonly activePlayers: number;
  readonly playerLimitHit: boolean;
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
    mode: 'beat',
    songBeat: 0,
    trackPeaks: [],
    activePlayers: 0,
    playerLimitHit: false,
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

  private mode: PlaybackMode = 'beat';
  private readonly playStartedListeners = new Set<(frame: number, songBeat: number) => void>();
  private lastArrangement: ArrangementDoc | null = null;
  private lastSections: readonly SectionRef[] = [];
  private arrangementTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly sentAssets = new Set<string>();
  private readonly assetSource = new Map<
    string,
    { left: Float32Array; right: Float32Array; sampleRate: number }
  >();

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
        mode: msg.mode,
        songBeat: msg.songBeat ?? this.telemetry.songBeat,
        trackPeaks: msg.trackPeaks ? [...msg.trackPeaks] : [],
        activePlayers: msg.activePlayers ?? 0,
        playerLimitHit: msg.playerLimitHit === true,
      };
      this.notifyListeners();
    } else if (msg.type === 'play-started') {
      const cb = this.playStartedListeners;
      for (const l of cb) l(msg.frame, msg.songBeat);
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
    this.forceBeatMode();
    this.flushAssets();
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
    this.forceBeatMode();
    this.flushAssets();
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

  // --- Timeline workspace -------------------------------------------------

  private forceBeatMode(): void {
    if (this.mode === 'beat') return;
    this.mode = 'beat';
    this.postToWorklet({ type: 'set-mode', mode: 'beat' });
  }

  public getMode(): PlaybackMode {
    return this.mode;
  }

  /** Switches the worklet between Beatkasten and Timeline (playback stops). */
  public async setMode(mode: PlaybackMode): Promise<void> {
    if (this.mode === mode) return;
    if (this.isPlaying) await this.stop();
    this.mode = mode;
    this.postToWorklet({ type: 'set-mode', mode });
    this.telemetry = { ...this.telemetry, mode };
    this.notifyListeners();
  }

  /** Sends the arrangement (debounced while editing). */
  public loadArrangement(doc: ArrangementDoc, immediate = false): void {
    this.lastArrangement = doc;
    if (!this.node) return;
    if (this.arrangementTimer !== null) clearTimeout(this.arrangementTimer);
    if (immediate) {
      this.arrangementTimer = null;
      this.postToWorklet({ type: 'arrangement', doc });
      return;
    }
    this.arrangementTimer = setTimeout(() => {
      this.arrangementTimer = null;
      if (this.lastArrangement) this.postToWorklet({ type: 'arrangement', doc: this.lastArrangement });
    }, ARRANGEMENT_DEBOUNCE_MS);
  }

  /** Current snapshots of all sections (clips reference them live). */
  public setSections(sections: readonly SectionRef[]): void {
    if (sections === this.lastSections) return;
    this.lastSections = sections;
    if (!this.node) return;
    this.postToWorklet({
      type: 'sections',
      sections: sections.map((x) => ({ id: x.id, snapshot: x.snapshot })),
    });
  }

  /** Registers PCM for audio clips / samples (sent to the worklet once). */
  public setAsset(id: string, pcm: { left: Float32Array; right: Float32Array; sampleRate: number }): void {
    this.assetSource.set(id, pcm);
    this.sentAssets.delete(id);
    this.flushAssets();
  }

  public removeAsset(id: string): void {
    this.assetSource.delete(id);
    if (this.sentAssets.delete(id)) this.postToWorklet({ type: 'asset-remove', id });
  }

  private flushAssets(): void {
    if (!this.node) return;
    for (const [id, pcm] of this.assetSource) {
      if (this.sentAssets.has(id)) continue;
      // Copies (the main thread keeps its PCM for waveforms / re-sends).
      this.postToWorklet({
        type: 'asset-add',
        id,
        left: pcm.left.slice(),
        right: pcm.right.slice(),
        sampleRate: pcm.sampleRate,
      });
      this.sentAssets.add(id);
    }
  }

  /** Starts timeline playback at a song beat. */
  public async playArrangement(fromBeat: number): Promise<void> {
    await this.ensureInitialized();
    if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume();
    if (this.arrangementTimer !== null) {
      clearTimeout(this.arrangementTimer);
      this.arrangementTimer = null;
    }
    this.mode = 'arrangement';
    this.postToWorklet({ type: 'set-mode', mode: 'arrangement' });
    this.postToWorklet({
      type: 'sections',
      sections: this.lastSections.map((x) => ({ id: x.id, snapshot: x.snapshot })),
    });
    this.flushAssets();
    if (this.lastArrangement) this.postToWorklet({ type: 'arrangement', doc: this.lastArrangement });
    this.postToWorklet({ type: 'seek', beat: Math.max(0, fromBeat) });
    this.postToWorklet({ type: 'play' });
    this.isPlaying = true;
    this.telemetry = { ...this.telemetry, isPlaying: true, mode: 'arrangement', songBeat: fromBeat };
    this.notifyListeners();
  }

  /** Moves the playhead while playing (or prepares the next start). */
  public seekSongBeat(beat: number): void {
    this.postToWorklet({ type: 'seek', beat: Math.max(0, beat) });
    this.telemetry = { ...this.telemetry, songBeat: beat, currentBeat: beat };
    this.notifyListeners();
  }

  /** Called with the audio-clock frame where playback really started (recording sync). */
  public onPlayStarted(listener: (frame: number, songBeat: number) => void): () => void {
    this.playStartedListeners.add(listener);
    return () => {
      this.playStartedListeners.delete(listener);
    };
  }

  /** Metronome clicks until a song beat (-1 = off, Infinity = always). */
  public setMetronome(untilBeat: number, level = 0.5): void {
    this.postToWorklet({ type: 'metronome', untilBeat: Number.isFinite(untilBeat) ? untilBeat : 1e9, level });
  }

  /** Microphone input needs the same AudioContext (recording, phase E). */
  public async getContext(): Promise<AudioContext> {
    await this.ensureInitialized();
    return this.ctx!;
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
