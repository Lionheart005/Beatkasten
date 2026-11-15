function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

function clampSample(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= -1) return -1;
  if (value >= 1) return 1;
  return value;
}

/**
 * Encodes stereo Float32Array audio into a RIFF/WAVE PCM byte buffer (16-bit or 24-bit).
 */
export function encodeWav(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  bitDepth: 16 | 24 = 16,
): Uint8Array {
  const numChannels = 2;
  const safeSampleRate =
    Number.isFinite(sampleRate) && sampleRate > 0 ? Math.round(sampleRate) : 44100;
  const numFrames = Math.min(left.length, right.length);
  const bytesPerSample = bitDepth === 24 ? 3 : 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = safeSampleRate * blockAlign;
  const dataBytes = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const out = new Uint8Array(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, safeSampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  if (bitDepth === 16) {
    for (let i = 0; i < numFrames; i += 1) {
      const l = clampSample(left[i] ?? 0);
      const r = clampSample(right[i] ?? 0);
      const lInt = l < 0 ? Math.max(-32768, Math.round(l * 32768)) : Math.min(32767, Math.round(l * 32767));
      const rInt = r < 0 ? Math.max(-32768, Math.round(r * 32768)) : Math.min(32767, Math.round(r * 32767));
      view.setInt16(offset, lInt, true);
      view.setInt16(offset + 2, rInt, true);
      offset += 4;
    }
  } else {
    for (let i = 0; i < numFrames; i += 1) {
      const l = clampSample(left[i] ?? 0);
      const r = clampSample(right[i] ?? 0);
      const lInt =
        l < 0
          ? Math.max(-8388608, Math.round(l * 8388608))
          : Math.min(8388607, Math.round(l * 8388607));
      const rInt =
        r < 0
          ? Math.max(-8388608, Math.round(r * 8388608))
          : Math.min(8388607, Math.round(r * 8388607));

      out[offset] = lInt & 0xff;
      out[offset + 1] = (lInt >> 8) & 0xff;
      out[offset + 2] = (lInt >> 16) & 0xff;

      out[offset + 3] = rInt & 0xff;
      out[offset + 4] = (rInt >> 8) & 0xff;
      out[offset + 5] = (rInt >> 16) & 0xff;

      offset += 6;
    }
  }

  return out;
}
