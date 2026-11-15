import { describe, expect, it } from 'vitest';
import { exportAudioAsync } from '../../src/audio-host/exportService';
import { encodeMp3, encodeWav } from '../../src/core/export';
import { createTripletRiddlePreset } from '../../src/core/state';
import { sanitizeStorageName } from '../../src/storage/ProjectStorageAdapter';

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

describe('WAV & MP3 Encoding', () => {
  it('encodeWav generates valid 16-bit and 24-bit RIFF/WAVE headers with exact byte lengths', () => {
    const sampleRate = 48000;
    const frames = 1024;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);

    for (let i = 0; i < frames; i += 1) {
      left[i] = Math.sin((2 * Math.PI * 110 * i) / sampleRate) * 0.8;
      right[i] = Math.cos((2 * Math.PI * 110 * i) / sampleRate) * 0.8;
    }
    // Inject extreme/non-finite samples to verify clamping
    left[0] = 2.5;
    right[1] = -2.5;
    left[2] = Number.NaN;

    for (const bitDepth of [16, 24] as const) {
      const wav = encodeWav(left, right, sampleRate, bitDepth);
      const expectedBytes = 44 + frames * 2 * (bitDepth / 8);
      expect(wav.byteLength).toBe(expectedBytes);

      expect(readAscii(wav, 0, 4)).toBe('RIFF');
      expect(readAscii(wav, 8, 4)).toBe('WAVE');
      expect(readAscii(wav, 12, 4)).toBe('fmt ');
      expect(readAscii(wav, 36, 4)).toBe('data');

      const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
      expect(view.getUint32(4, true)).toBe(expectedBytes - 8);
      expect(view.getUint16(20, true)).toBe(1); // PCM format
      expect(view.getUint16(22, true)).toBe(2); // Stereo
      expect(view.getUint32(24, true)).toBe(sampleRate);
      expect(view.getUint16(34, true)).toBe(bitDepth);
      expect(view.getUint32(40, true)).toBe(expectedBytes - 44);
    }
  });

  it('encodeMp3 produces valid non-empty MP3 bytes at 192 and 320 kbps', () => {
    const sampleRate = 44100;
    const frames = 8192;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);

    for (let i = 0; i < frames; i += 1) {
      const s = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 0.6;
      left[i] = s;
      right[i] = s;
    }

    for (const kbps of [192, 320]) {
      const mp3 = encodeMp3(left, right, sampleRate, kbps);
      expect(mp3.byteLength).toBeGreaterThan(256);
      // Standard MPEG audio frame sync starts with 0xFF and top 3 bits 0xE0
      expect(mp3[0]).toBe(0xff);
      expect((mp3[1]! & 0xe0) === 0xe0).toBe(true);
    }
  });

  it('exportAudioAsync falls back cleanly in Node and exports WAV, MP3, and stems', async () => {
    const snapshot = createTripletRiddlePreset();

    const wavRes = await exportAudioAsync(
      {
        snapshot,
        bars: 1,
        preRollBars: 0,
        sampleRate: 24000,
        format: 'wav-16',
      },
      'Test:Loop/1',
    );
    expect(wavRes.mainFile?.fileName).toBe('Test_Loop_1.wav');
    expect(wavRes.mainFile?.mimeType).toBe('audio/wav');
    expect(readAscii(wavRes.mainFile!.bytes, 0, 4)).toBe('RIFF');
    expect(wavRes.durationSeconds).toBeGreaterThan(1);

    const mp3Res = await exportAudioAsync(
      {
        snapshot,
        bars: 1,
        preRollBars: 0,
        sampleRate: 44100,
        format: 'mp3-192',
      },
      'Mp3Test',
    );
    expect(mp3Res.mainFile?.fileName).toBe('Mp3Test.mp3');
    expect(mp3Res.mainFile?.bytes.byteLength).toBeGreaterThan(256);

    const stemRes = await exportAudioAsync(
      {
        snapshot,
        bars: 1,
        preRollBars: 0,
        sampleRate: 24000,
        format: 'stems-wav-24',
      },
      'StemProject',
    );
    expect(stemRes.mainFile?.fileName).toBe('StemProject_mix.wav');
    expect(stemRes.stemFiles).toHaveLength(snapshot.layers.length);
    for (const stem of stemRes.stemFiles!) {
      expect(stem.fileName.endsWith('.wav')).toBe(true);
      expect(readAscii(stem.bytes, 0, 4)).toBe('RIFF');
    }
  });
});

describe('Storage Name Sanitization', () => {
  it('sanitizeStorageName handles empty, whitespace, path separators, and illegal chars', () => {
    expect(sanitizeStorageName('')).toBe('untitled');
    expect(sanitizeStorageName('   \t\n  ', 'fallback_name')).toBe('fallback_name');
    expect(sanitizeStorageName('My Techno / Acid: <Mix>?*')).toBe(
      'My_Techno___Acid___Mix___',
    );
    expect(sanitizeStorageName('  Hypnotic   A-Minor \x00  ')).toBe(
      'Hypnotic_A-Minor__',
    );
    expect(sanitizeStorageName('01_Intro_Puls')).toBe('01_Intro_Puls');
  });
});
