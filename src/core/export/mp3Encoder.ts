import { Mp3Encoder } from '@breezystack/lamejs';

const MP3_CHUNK_SIZE = 1152;

function floatToInt16(sample: number): number {
  if (!Number.isFinite(sample)) return 0;
  const clamped = sample <= -1 ? -1 : sample >= 1 ? 1 : sample;
  return clamped < 0
    ? Math.max(-32768, Math.round(clamped * 32768))
    : Math.min(32767, Math.round(clamped * 32767));
}

/**
 * Encodes stereo Float32Array audio into an MP3 byte buffer using @breezystack/lamejs.
 */
export function encodeMp3(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  kbps = 192,
): Uint8Array {
  const safeSampleRate =
    Number.isFinite(sampleRate) && sampleRate > 0 ? Math.round(sampleRate) : 44100;
  const safeKbps = Number.isFinite(kbps) && kbps > 0 ? Math.round(kbps) : 192;
  const numFrames = Math.min(left.length, right.length);

  const encoder = new Mp3Encoder(2, safeSampleRate, safeKbps);
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  const leftChunk = new Int16Array(MP3_CHUNK_SIZE);
  const rightChunk = new Int16Array(MP3_CHUNK_SIZE);

  for (let offset = 0; offset < numFrames; offset += MP3_CHUNK_SIZE) {
    const count = Math.min(MP3_CHUNK_SIZE, numFrames - offset);
    for (let i = 0; i < count; i += 1) {
      leftChunk[i] = floatToInt16(left[offset + i] ?? 0);
      rightChunk[i] = floatToInt16(right[offset + i] ?? 0);
    }

    const lSlice = count === MP3_CHUNK_SIZE ? leftChunk : leftChunk.subarray(0, count);
    const rSlice = count === MP3_CHUNK_SIZE ? rightChunk : rightChunk.subarray(0, count);
    const encoded = encoder.encodeBuffer(lSlice, rSlice);
    if (encoded.length > 0) {
      chunks.push(encoded);
      totalBytes += encoded.length;
    }
  }

  const flushed = encoder.flush();
  if (flushed.length > 0) {
    chunks.push(flushed);
    totalBytes += flushed.length;
  }

  const result = new Uint8Array(totalBytes);
  let writeOffset = 0;
  for (const chunk of chunks) {
    result.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }

  return result;
}
