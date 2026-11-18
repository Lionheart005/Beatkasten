/// <reference types="vite/client" />
/**
 * Recording from microphone / audio interface (phase E). Uses the SAME
 * AudioContext as playback, so recorded frames and the song clock share one
 * time base. Echo cancellation / noise suppression / AGC are switched off.
 */
import { RECORDER_PROCESSOR_NAME, type RecorderInbound, type RecorderOutbound } from './RecorderProcessor';
import recorderUrl from './RecorderProcessor.ts?worker&url';

export interface RecordedTake {
  readonly left: Float32Array;
  readonly right: Float32Array;
  /** Audio-clock frame of the first recorded sample. */
  readonly startFrame: number;
  readonly sampleRate: number;
}

export interface InputDevice {
  readonly deviceId: string;
  readonly label: string;
}

export class Recorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private monitor: GainNode | null = null;
  private moduleLoaded = false;
  private chunks: Array<{ frame: number; left: Float32Array; right: Float32Array }> = [];
  private stopResolve: ((take: RecordedTake) => void) | null = null;
  private levelListeners = new Set<(peak: number) => void>();
  private deviceId = '';
  private stereo = false;
  /** Input latency reported by the browser (s). */
  private inputLatency = 0;

  public isOpen(): boolean {
    return this.node !== null;
  }

  public async listDevices(): Promise<InputDevice[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter((d) => d.kind === 'audioinput')
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Eingang ${i + 1}` }));
  }

  /** Opens the input (asks for permission). Re-opens when device / channels change. */
  public async open(ctx: AudioContext, deviceId = '', stereo = false): Promise<void> {
    if (this.node && this.ctx === ctx && deviceId === this.deviceId && stereo === this.stereo) return;
    this.close();
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Aufnahme braucht einen sicheren Kontext (localhost / https) und einen aktuellen Browser.');
    }
    this.ctx = ctx;
    this.deviceId = deviceId;
    this.stereo = stereo;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        channelCount: stereo ? 2 : 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const track = this.stream.getAudioTracks()[0];
    const settings = (track?.getSettings?.() ?? {}) as MediaTrackSettings & { latency?: number };
    this.inputLatency = typeof settings.latency === 'number' && Number.isFinite(settings.latency) ? settings.latency : 0.01;
    if (!this.moduleLoaded) {
      await ctx.audioWorklet.addModule(recorderUrl);
      this.moduleLoaded = true;
    }
    this.source = ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(ctx, RECORDER_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 2,
      channelCountMode: 'explicit',
    });
    // Keep the node pulled by the graph without making it audible.
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    this.node.connect(this.sink).connect(ctx.destination);
    this.source.connect(this.node);
    this.monitor = ctx.createGain();
    this.monitor.gain.value = 0;
    this.source.connect(this.monitor).connect(ctx.destination);
    this.node.port.onmessage = (e: MessageEvent<RecorderOutbound>) => this.onMessage(e.data);
  }

  private onMessage(m: RecorderOutbound): void {
    if (m.type === 'chunk') {
      this.chunks.push({ frame: m.frame, left: m.left, right: m.right });
    } else if (m.type === 'level') {
      for (const l of this.levelListeners) l(m.peak);
    } else if (m.type === 'stopped') {
      const resolve = this.stopResolve;
      this.stopResolve = null;
      resolve?.(this.assemble());
    }
  }

  private assemble(): RecordedTake {
    const chunks = this.chunks;
    this.chunks = [];
    const sr = this.ctx?.sampleRate ?? 48000;
    if (chunks.length === 0) return { left: new Float32Array(0), right: new Float32Array(0), startFrame: 0, sampleRate: sr };
    const start = chunks[0]!.frame;
    const end = chunks[chunks.length - 1]!.frame + chunks[chunks.length - 1]!.left.length;
    const len = Math.max(0, end - start);
    const left = new Float32Array(len);
    const right = this.stereo ? new Float32Array(len) : left;
    for (const c of chunks) {
      const o = c.frame - start;
      left.set(c.left.subarray(0, Math.max(0, Math.min(c.left.length, len - o))), o);
      if (this.stereo) right.set(c.right.subarray(0, Math.max(0, Math.min(c.right.length, len - o))), o);
    }
    return { left, right, startFrame: start, sampleRate: sr };
  }

  public onLevel(listener: (peak: number) => void): () => void {
    this.levelListeners.add(listener);
    return () => {
      this.levelListeners.delete(listener);
    };
  }

  public setMonitoring(on: boolean, level = 1): void {
    if (this.monitor && this.ctx) this.monitor.gain.setTargetAtTime(on ? level : 0, this.ctx.currentTime, 0.01);
  }

  public start(): void {
    this.chunks = [];
    this.post({ type: 'start' });
  }

  public stop(): Promise<RecordedTake> {
    return new Promise((resolve) => {
      this.stopResolve = resolve;
      this.post({ type: 'stop' });
    });
  }

  /** Automatic round-trip latency estimate (s): output + input path. */
  public estimatedLatency(): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    const out = (ctx.baseLatency || 0) + ((ctx as AudioContext & { outputLatency?: number }).outputLatency || 0);
    return out + this.inputLatency;
  }

  /**
   * Measures the real round trip: plays a click and finds it in the input.
   * Needs speakers + microphone (no headphones). Returns seconds or null.
   */
  public async calibrate(): Promise<number | null> {
    const ctx = this.ctx;
    if (!ctx || !this.node) return null;
    if (ctx.state === 'suspended') await ctx.resume();
    const sr = ctx.sampleRate;
    const click = ctx.createBuffer(1, Math.round(0.004 * sr), sr);
    const d = click.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (i % 2 === 0 ? 0.9 : -0.9) * (1 - i / d.length);
    this.start();
    const when = ctx.currentTime + 0.35;
    const src = ctx.createBufferSource();
    src.buffer = click;
    src.connect(ctx.destination);
    src.start(when);
    await new Promise((r) => setTimeout(r, 1100));
    const take = await this.stop();
    const clickFrame = Math.round(when * sr);
    // Noise floor from the part before the click, then the first clear rise.
    const pre = Math.max(0, Math.min(take.left.length, clickFrame - take.startFrame));
    let floor = 0;
    for (let i = 0; i < pre; i++) floor = Math.max(floor, Math.abs(take.left[i]!));
    const thr = Math.max(0.02, floor * 4);
    for (let i = pre; i < take.left.length; i++) {
      if (Math.abs(take.left[i]!) > thr) {
        const lat = (take.startFrame + i - clickFrame) / sr;
        return lat >= 0 && lat < 0.5 ? lat : null;
      }
    }
    return null;
  }

  private post(m: RecorderInbound): void {
    this.node?.port.postMessage(m);
  }

  public close(): void {
    this.post({ type: 'close' });
    this.node?.disconnect();
    this.source?.disconnect();
    this.monitor?.disconnect();
    this.sink?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.node = null;
    this.source = null;
    this.monitor = null;
    this.sink = null;
    this.stream = null;
  }
}

export const recorderSingleton = new Recorder();
