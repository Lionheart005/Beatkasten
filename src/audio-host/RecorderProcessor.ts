/**
 * Second AudioWorklet node: records the microphone / interface input.
 * Sends packets (transferable Float32Arrays) with the audio-clock frame of
 * their first sample, plus a level meter, to the main thread.
 */
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}
declare function registerProcessor(name: string, ctor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor): void;
declare const currentFrame: number;
declare const sampleRate: number;

export const RECORDER_PROCESSOR_NAME = 'beatkasten-recorder';

export type RecorderInbound = { readonly type: 'start' } | { readonly type: 'stop' } | { readonly type: 'close' };

export type RecorderOutbound =
  | {
      readonly type: 'chunk';
      readonly frame: number;
      readonly left: Float32Array;
      readonly right: Float32Array;
    }
  | { readonly type: 'level'; readonly peak: number }
  | { readonly type: 'stopped'; readonly endFrame: number };

const PACKET = 4096;
const LEVEL_EVERY = 12;

if (typeof registerProcessor === 'function' && typeof AudioWorkletProcessor === 'function') {
  class RecorderProcessor extends AudioWorkletProcessor {
    private recording = false;
    private alive = true;
    private bufL = new Float32Array(PACKET);
    private bufR = new Float32Array(PACKET);
    private fill = 0;
    private packetFrame = 0;
    private peak = 0;
    private blocks = 0;

    constructor(options?: AudioWorkletNodeOptions) {
      super(options);
      this.port.onmessage = (e: MessageEvent<RecorderInbound>) => {
        const m = e.data;
        if (!m) return;
        if (m.type === 'start') {
          this.recording = true;
          this.fill = 0;
        } else if (m.type === 'stop') {
          this.flush();
          this.recording = false;
          this.port.postMessage({ type: 'stopped', endFrame: currentFrame } satisfies RecorderOutbound);
        } else if (m.type === 'close') {
          this.alive = false;
        }
      };
    }

    private flush(): void {
      if (this.fill === 0) return;
      const left = this.bufL.slice(0, this.fill);
      const right = this.bufR.slice(0, this.fill);
      this.port.postMessage({ type: 'chunk', frame: this.packetFrame, left, right } satisfies RecorderOutbound, [
        left.buffer,
        right.buffer,
      ]);
      this.fill = 0;
    }

    process(inputs: Float32Array[][]): boolean {
      const input = inputs[0];
      const l = input?.[0];
      const r = input?.[1] ?? l;
      if (l && r) {
        const n = l.length;
        for (let i = 0; i < n; i++) {
          const a = Math.abs(l[i]!) > Math.abs(r[i]!) ? Math.abs(l[i]!) : Math.abs(r[i]!);
          if (a > this.peak) this.peak = a;
        }
        if (this.recording) {
          for (let i = 0; i < n; i++) {
            if (this.fill === 0) this.packetFrame = currentFrame + i;
            this.bufL[this.fill] = l[i]!;
            this.bufR[this.fill] = r[i]!;
            this.fill++;
            if (this.fill >= PACKET) this.flush();
          }
        }
      }
      if (++this.blocks >= LEVEL_EVERY) {
        this.blocks = 0;
        this.port.postMessage({ type: 'level', peak: this.peak } satisfies RecorderOutbound);
        this.peak = 0;
      }
      void sampleRate;
      return this.alive;
    }
  }
  registerProcessor(RECORDER_PROCESSOR_NAME, RecorderProcessor);
}
