/**
 * WAV reader / 32-bit float writer for the audio pool (pure TS).
 * Reads PCM 8/16/24/32-bit integer and 32/64-bit float, mono … n channels.
 */
export interface DecodedWav {
  readonly sampleRate: number;
  readonly channels: Float32Array[];
}

function ascii(view: DataView, offset: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

/** Writes an IEEE-float WAV (format 3) — lossless for recordings. */
export function encodeWavFloat32(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
  const ch = Math.max(1, channels.length);
  const frames = Math.min(...channels.map((c) => c.length));
  const blockAlign = ch * 4;
  const dataBytes = frames * blockAlign;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const w = (o: number, t: string) => {
    for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i));
  };
  w(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 3, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, Math.round(sampleRate), true);
  v.setUint32(28, Math.round(sampleRate) * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, 32, true);
  w(36, 'data');
  v.setUint32(40, dataBytes, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++) {
      v.setFloat32(o, channels[c]![i]!, true);
      o += 4;
    }
  }
  return new Uint8Array(buf);
}

export function decodeWav(bytes: Uint8Array): DecodedWav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || ascii(view, 0, 4) !== 'RIFF' || ascii(view, 8, 4) !== 'WAVE') {
    throw new Error('Keine gültige WAV-Datei.');
  }
  let off = 12;
  let format = 1;
  let channels = 2;
  let sampleRate = 48000;
  let bits = 16;
  let dataOff = -1;
  let dataLen = 0;
  while (off + 8 <= bytes.byteLength) {
    const id = ascii(view, off, 4);
    const size = view.getUint32(off + 4, true);
    const body = off + 8;
    if (id === 'fmt ') {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true); // WAVE_FORMAT_EXTENSIBLE
    } else if (id === 'data') {
      dataOff = body;
      dataLen = Math.min(size, bytes.byteLength - body);
      break;
    }
    off = body + size + (size & 1);
  }
  if (dataOff < 0) throw new Error('WAV ohne Audiodaten.');
  const bps = bits / 8;
  const frames = Math.floor(dataLen / (bps * channels));
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  let p = dataOff;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      let s = 0;
      if (format === 3) s = bits === 64 ? view.getFloat64(p, true) : view.getFloat32(p, true);
      else if (bits === 8) s = (view.getUint8(p) - 128) / 128;
      else if (bits === 16) s = view.getInt16(p, true) / 32768;
      else if (bits === 24) {
        const v = view.getUint8(p) | (view.getUint8(p + 1) << 8) | (view.getInt8(p + 2) << 16);
        s = v / 8388608;
      } else if (bits === 32) s = view.getInt32(p, true) / 2147483648;
      out[c]![i] = s;
      p += bps;
    }
  }
  return { sampleRate, channels: out };
}
