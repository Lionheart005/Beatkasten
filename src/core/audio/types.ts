/** Audio pool (recordings, imports, bounces, frozen clips). Metadata only. */
export type AudioAssetSource = 'recording' | 'import' | 'bounce' | 'freeze';

export interface AudioAssetMeta {
  readonly id: string;
  readonly name: string;
  readonly source: AudioAssetSource;
  /** Always the project rate (48000) after import. */
  readonly sampleRate: number;
  readonly channels: 1 | 2;
  readonly lengthSamples: number;
  /** audio/<id>_<name>.wav inside the project folder. */
  readonly fileName: string;
  /** Detected / set root note for the sample instrument. */
  readonly rootMidi?: number;
  readonly createdAt: number;
  /** Hash of the freeze source (cache key, source 'freeze'). */
  readonly freezeKey?: string;
}

/** Decoded PCM of an asset at the project sample rate. */
export interface AudioAssetPcm {
  readonly left: Float32Array;
  readonly right: Float32Array;
  readonly sampleRate: number;
  readonly length: number;
}

export const PROJECT_SAMPLE_RATE = 48000;
