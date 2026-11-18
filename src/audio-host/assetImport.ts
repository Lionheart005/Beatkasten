/**
 * Decodes an audio file (WAV/MP3/OGG/FLAC/M4A …) to stereo PCM at the project
 * rate. Uses the browser decoder (OfflineAudioContext resamples on decode);
 * plain WAV files also decode without Web Audio (tests / fallback).
 */
import { PROJECT_SAMPLE_RATE, type AudioAssetPcm } from '../core/audio/types';
import { resample } from '../core/audio/resample';
import { decodeWav } from '../core/audio/wavCodec';

export async function decodeAudioFile(
  bytes: ArrayBuffer,
  targetRate = PROJECT_SAMPLE_RATE,
): Promise<AudioAssetPcm & { channels: 1 | 2 }> {
  const Offline =
    (globalThis as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext ??
    (globalThis as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (Offline) {
    try {
      const ctx = new Offline(2, 1, targetRate);
      const buf = await ctx.decodeAudioData(bytes.slice(0));
      const left = buf.getChannelData(0).slice();
      const right = buf.numberOfChannels > 1 ? buf.getChannelData(1).slice() : left;
      const pcm = buf.sampleRate === targetRate ? { left, right } : { left: resample(left, buf.sampleRate, targetRate), right: right === left ? resample(left, buf.sampleRate, targetRate) : resample(right, buf.sampleRate, targetRate) };
      return {
        left: pcm.left,
        right: buf.numberOfChannels > 1 ? pcm.right : pcm.left,
        sampleRate: targetRate,
        length: pcm.left.length,
        channels: buf.numberOfChannels > 1 ? 2 : 1,
      };
    } catch {
      // fall through to the WAV decoder
    }
  }
  const wav = decodeWav(new Uint8Array(bytes));
  const l0 = wav.channels[0] ?? new Float32Array(0);
  const r0 = wav.channels[1];
  const left = resample(l0, wav.sampleRate, targetRate);
  const right = r0 ? resample(r0, wav.sampleRate, targetRate) : left;
  return { left, right, sampleRate: targetRate, length: left.length, channels: r0 ? 2 : 1 };
}
