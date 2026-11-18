import { describe, expect, it } from 'vitest';
import {
  addClip,
  addTrack,
  createAudioClip,
  createSectionClip,
  createTrack,
  EMPTY_DOC,
  renderArrangement,
  type ArrangementDoc,
  type AudioAssetData,
} from '../../src/core/arrangement';
import { freezeKeyForDoc } from '../../src/core/arrangement/clipSnapshot';
import { detectRootMidi, detectTransients, findSilenceBounds, peakOf } from '../../src/core/audio/analysis';
import { computePeaks } from '../../src/core/audio/peaks';
import { resample } from '../../src/core/audio/resample';
import { decodeWav, encodeWavFloat32 } from '../../src/core/audio/wavCodec';
import { encodeWav } from '../../src/core/export';
import { createHypnoticAMinorProject } from '../../src/core/state';

let n = 0;
const makeId = (p: string) => `${p}-${++n}`;
const SR = 48000;

function tone(seconds: number, hz: number, sr = SR, amp = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / sr);
  return out;
}

describe('WAV codec, resampling, peaks, analysis', () => {
  it('float WAV round-trips exactly; 24-bit PCM decodes', () => {
    const l = tone(0.1, 440);
    const r = tone(0.1, 660);
    const dec = decodeWav(encodeWavFloat32([l, r], SR));
    expect(dec.sampleRate).toBe(SR);
    expect(dec.channels[0]![123]).toBe(l[123]);
    expect(dec.channels[1]![321]).toBe(r[321]);
    const pcm24 = decodeWav(encodeWav(l, r, 44100, 24));
    expect(pcm24.sampleRate).toBe(44100);
    expect(Math.abs(pcm24.channels[0]![100]! - l[100]!)).toBeLessThan(1e-5);
  });

  it('resamples 44.1 kHz → 48 kHz keeping pitch and length', () => {
    const src = tone(1, 1000, 44100);
    const out = resample(src, 44100, 48000);
    expect(out.length).toBe(48000);
    // Compare against an ideal 48 kHz tone in the middle.
    const ideal = tone(1, 1000, 48000);
    let err = 0;
    for (let i = 1000; i < 47000; i++) err = Math.max(err, Math.abs(out[i]! - ideal[i]!));
    expect(err).toBeLessThan(0.01);
  });

  it('computes peaks, silence bounds, root note and transients', () => {
    const sig = new Float32Array(SR);
    sig.set(tone(0.5, 220), SR / 4);
    const peaks = computePeaks([sig]);
    expect(peaks.data[0]!.length).toBe(Math.ceil(SR / 64) * 2);
    const b = findSilenceBounds([sig]);
    expect(b.start).toBeGreaterThan(SR / 4 - 500);
    expect(b.end).toBeLessThan((3 * SR) / 4 + 500);
    expect(detectRootMidi([tone(0.5, 220)], SR)).toBe(57); // A3
    const hits = new Float32Array(SR);
    for (const pos of [0.1, 0.4, 0.7]) hits.set(tone(0.05, 300, SR, 0.8), Math.round(pos * SR));
    expect(detectTransients([hits], SR).length).toBeGreaterThanOrEqual(3);
    expect(peakOf([sig])).toBeCloseTo(0.5, 2);
  });
});

describe('Audio clips in the engine', () => {
  const asset: AudioAssetData = (() => {
    const l = tone(2, 330);
    return { left: l, right: l, sampleRate: SR, length: l.length };
  })();
  const lookup = (id: string) => (id === 'a1' ? asset : undefined);

  function audioDoc(reversed = false, offset = 0): ArrangementDoc {
    let doc: ArrangementDoc = { ...EMPTY_DOC, tempoMarkers: [{ id: 't', beat: 0, bpm: 120 }], masterGlue: 0 };
    const t = createTrack('audio', makeId, 0);
    doc = addTrack(doc, t);
    // Beat 2 = 1 s at 120 BPM, 2 beats long.
    return addClip(doc, t.id, { ...createAudioClip(makeId, 'a1', 2, 2, offset), reversed });
  }

  it('plays the asset at the clip position (sample-accurate, no time-stretch)', () => {
    // Pre-master: the master limiter adds 72 samples look-ahead and filter ring-out.
    const r = renderArrangement(audioDoc(), new Map(), { tailSeconds: 0, assets: lookup, endBeat: 6, outputStage: 'pre-master' });
    let pre = 0;
    for (let i = 0; i < SR; i++) pre = Math.max(pre, Math.abs(r.left[i]!));
    expect(pre).toBe(0);
    let mid = 0;
    for (let i = SR + 2000; i < 2 * SR - 2000; i++) mid = Math.max(mid, Math.abs(r.left[i]!));
    expect(mid).toBeGreaterThan(0.2);
    let after = 0;
    for (let i = 2 * SR + 2; i < r.numSamples; i++) after = Math.max(after, Math.abs(r.left[i]!));
    expect(after).toBeLessThan(1e-3);
  });

  it('reversed and offset clips read the right part of the asset', () => {
    const fwd = renderArrangement(audioDoc(false, 0), new Map(), { tailSeconds: 0, assets: lookup, endBeat: 4, outputStage: 'raw-clips' });
    const rev = renderArrangement(audioDoc(true, 0), new Map(), { tailSeconds: 0, assets: lookup, endBeat: 4, outputStage: 'raw-clips' });
    // Reversed: sample k after the start equals the forward sample (len-1-k).
    const start = SR;
    const len = SR;
    for (const k of [5000, 20000, 33333]) {
      expect(rev.left[start + k]).toBeCloseTo(fwd.left[start + len - 1 - k]!, 4);
    }
  });

  it('a frozen section clip plays its pre-rendered audio (≈ live)', () => {
    const snap = createHypnoticAMinorProject().activeSnapshot;
    const sections = new Map([['s', snap]]);
    let doc: ArrangementDoc = { ...EMPTY_DOC, tempoMarkers: [{ id: 't', beat: 0, bpm: 120 }], masterGlue: 0 };
    const t = createTrack('section', makeId, 0);
    doc = addTrack(doc, t);
    const clip = createSectionClip(makeId, 's', 0, 8);
    doc = addClip(doc, t.id, clip);
    const raw = renderArrangement(doc, sections, { tailSeconds: 0, outputStage: 'raw-clips' });
    const frozenAsset: AudioAssetData = { left: raw.left, right: raw.right, sampleRate: SR, length: raw.numSamples };
    const key = freezeKeyForDoc(doc, clip, snap);
    const frozenDoc: ArrangementDoc = {
      ...doc,
      tracks: [{ ...doc.tracks[0]!, clips: [{ ...clip, frozenAssetId: 'frz', frozenKey: key }] }],
    };
    const live = renderArrangement(doc, sections, { tailSeconds: 0 });
    const frozen = renderArrangement(frozenDoc, sections, { tailSeconds: 0, assets: (id) => (id === 'frz' ? frozenAsset : undefined) });
    let diff = 0;
    for (let i = 0; i < live.numSamples; i++) diff = Math.max(diff, Math.abs(live.left[i]! - frozen.left[i]!));
    expect(diff).toBeLessThan(0.02);
    // Stale key → live playback again.
    const staleDoc: ArrangementDoc = {
      ...frozenDoc,
      tracks: [{ ...frozenDoc.tracks[0]!, clips: [{ ...frozenDoc.tracks[0]!.clips[0]!, frozenKey: 'old' } as typeof clip] }],
    };
    const stale = renderArrangement(staleDoc, sections, { tailSeconds: 0, assets: () => undefined });
    let d2 = 0;
    for (let i = 0; i < live.numSamples; i++) d2 = Math.max(d2, Math.abs(live.left[i]! - stale.left[i]!));
    expect(d2).toBe(0);
  });
});

describe('Metronome (count-in)', () => {
  it('clicks on every beat until the given beat, also across chunk borders', async () => {
    const { ArrangementEngine } = await import('../../src/core/arrangement');
    const engine = new ArrangementEngine(SR, { maxPlayers: 1 });
    engine.setArrangement({ ...EMPTY_DOC, tempoMarkers: [{ id: 't', beat: 0, bpm: 120 }] }, new Map());
    engine.setMetronome(3);
    const total = 2 * SR;
    const out = new Float32Array(total);
    const L = new Float32Array(100);
    const R = new Float32Array(100);
    for (let o = 0; o < total; o += 100) {
      engine.processBlock(L, R, 100);
      out.set(L.subarray(0, Math.min(100, total - o)), o);
    }
    const onsets: number[] = [];
    let quiet = true;
    for (let i = 0; i < total; i++) {
      const a = Math.abs(out[i]!);
      if (quiet && a > 0.01) {
        onsets.push(i);
        quiet = false;
      } else if (!quiet && a === 0) {
        // stays non-quiet until a long silence
      }
      if (!quiet && i - onsets[onsets.length - 1]! > 0.05 * SR) quiet = true;
    }
    // Beats 0, 1, 2 at 120 BPM = 0, 24000, 48000 samples; beat 3 is excluded.
    expect(onsets.length).toBe(3);
    expect(Math.abs(onsets[1]! - 24000)).toBeLessThan(4);
    expect(Math.abs(onsets[2]! - 48000)).toBeLessThan(4);
  });
});
