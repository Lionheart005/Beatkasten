import { describe, expect, it } from 'vitest';
import {
  ArrangementEngine,
  compileArrangement,
  createSectionClip,
  createTrack,
  deriveClipSnapshot,
  duplicateClips,
  EMPTY_DOC,
  evaluateKeyframes,
  addClip,
  addTrack,
  moveClips,
  renderArrangement,
  setTempoMarker,
  snapBeat,
  splitClip,
  TempoMap,
  trimClipEnd,
  trimClipStart,
  type ArrangementDoc,
  type SectionClip as SectionClipT,
} from '../../src/core/arrangement';
import { createHypnoticAMinorProject } from '../../src/core/state';
import type { BeatSnapshot } from '../../src/core/state/types';
import {
  arrangementFromSongChain,
  createEmptyArrangement,
} from '../../src/core/state/arrangementMigration';

let idCounter = 0;
const makeId = (p: string) => `${p}-${++idCounter}`;

const SR = 48000;
const baseSnapshot = (): BeatSnapshot => createHypnoticAMinorProject().activeSnapshot;

function docWithClips(
  clips: Array<{ start: number; len: number; offset?: number; overrides?: Record<string, { enabled?: boolean; level?: number }> }>,
  bpm = 130,
): { doc: ArrangementDoc; sections: Map<string, BeatSnapshot> } {
  const snap = baseSnapshot();
  const sections = new Map([['sec-a', snap]]);
  const track = createTrack('section', makeId, 0);
  const doc: ArrangementDoc = {
    ...EMPTY_DOC,
    tempoMarkers: [{ id: 't0', beat: 0, bpm }],
    tracks: [
      {
        ...track,
        clips: clips.map((c) => ({
          ...createSectionClip(makeId, 'sec-a', c.start, c.len),
          sourceOffsetBeats: c.offset ?? 0,
          layerOverrides: c.overrides ?? {},
        })),
      },
    ],
  };
  return { doc, sections };
}

describe('TempoMap & snapping', () => {
  it('converts beats ↔ seconds across tempo changes', () => {
    const tm = new TempoMap(
      [
        { id: 'a', beat: 0, bpm: 120 },
        { id: 'b', beat: 8, bpm: 60 },
      ],
      [{ id: 'm', beat: 0, numerator: 4, denominator: 4 }],
    );
    expect(tm.beatToSec(8)).toBeCloseTo(4);
    expect(tm.beatToSec(10)).toBeCloseTo(6);
    expect(tm.secToBeat(6)).toBeCloseTo(10);
    expect(tm.bpmAt(9)).toBe(60);
    expect(tm.beatToSample(8, SR)).toBe(4 * SR);
  });

  it('counts bars across meter changes', () => {
    const tm = new TempoMap(
      [{ id: 'a', beat: 0, bpm: 120 }],
      [
        { id: 'm0', beat: 0, numerator: 4, denominator: 4 },
        { id: 'm1', beat: 8, numerator: 7, denominator: 8 },
      ],
    );
    expect(tm.barStartBeat(2)).toBe(8);
    expect(tm.barStartBeat(3)).toBeCloseTo(11.5);
    expect(tm.barPosition(12).bar).toBe(3);
    expect(tm.formatPosition(9)).toBe('3:2');
  });

  it('snaps to bars, beats and triplets', () => {
    const tm = new TempoMap([{ id: 'a', beat: 0, bpm: 120 }], [{ id: 'm', beat: 0, numerator: 4, denominator: 4 }]);
    expect(snapBeat(5.7, 'bar', tm)).toBe(4);
    expect(snapBeat(6.1, 'bar', tm)).toBe(8);
    expect(snapBeat(5.4, '1/4', tm)).toBe(5);
    expect(snapBeat(5.3, '1/8T', tm)).toBeCloseTo(5 + 1 / 3);
    expect(snapBeat(5.3, 'off', tm)).toBe(5.3);
  });
});

describe('Arrangement editing', () => {
  it('split → right part continues the loop offset; trim/duplicate/move', () => {
    const { doc } = docWithClips([{ start: 0, len: 32 }]);
    const clipId = doc.tracks[0]!.clips[0]!.id;
    const { doc: split, rightId } = splitClip(doc, clipId, 12, makeId);
    const clips = split.tracks[0]!.clips;
    expect(clips).toHaveLength(2);
    const right = clips.find((c) => c.id === rightId)!;
    expect(right.startBeat).toBe(12);
    expect(right.kind === 'section' && right.sourceOffsetBeats).toBe(12);

    const trimmed = trimClipStart(split, rightId!, 14);
    const r2 = trimmed.tracks[0]!.clips.find((c) => c.id === rightId)!;
    expect(r2.startBeat).toBe(14);
    expect(r2.kind === 'section' && r2.sourceOffsetBeats).toBe(14);
    expect(r2.lengthBeats).toBe(18);
    expect(trimClipEnd(trimmed, rightId!, 20).tracks[0]!.clips.find((c) => c.id === rightId)!.lengthBeats).toBe(6);

    const dup = duplicateClips(doc, [clipId], makeId);
    expect(dup.doc.tracks[0]!.clips[1]!.startBeat).toBe(32);
    expect(moveClips(doc, [clipId], -10).tracks[0]!.clips[0]!.startBeat).toBe(0);
  });

  it('song chain → timeline puts sections back to back', () => {
    const p = createHypnoticAMinorProject();
    const base = createEmptyArrangement(p.activeSnapshot, makeId);
    const sections = [
      { id: 's1', name: 'A', notes: '', color: '#fff', exportBars: 4, snapshot: p.activeSnapshot },
      { id: 's2', name: 'B', notes: '', color: '#fff', exportBars: 8, snapshot: p.activeSnapshot },
    ];
    const doc = arrangementFromSongChain(sections, base, makeId);
    const clips = doc.tracks[doc.tracks.length - 1]!.clips;
    expect(clips.map((c) => [c.startBeat, c.lengthBeats])).toEqual([
      [0, 16],
      [16, 32],
    ]);
  });
});

describe('Clip snapshot derivation', () => {
  it('applies song tempo, transposition and layer overrides', () => {
    const snap = baseSnapshot();
    const layer = snap.layers[0]!;
    const d = deriveClipSnapshot(snap, { layerOverrides: { [layer.id]: { enabled: false, level: 0.3 } }, transposeSemitones: 2 }, 140);
    expect(d.tempoBpm).toBe(140);
    expect(d.id).toBe(snap.id);
    expect(d.harmony.rootNote).toBe(snap.harmony.rootNote + 2);
    expect(d.layers[0]!.muted).toBe(true);
    expect(d.layers[0]!.level).toBe(0.3);
    expect(d.layers[1]).toBe(snap.layers[1]);
  });
});

describe('Compile & render', () => {
  it('chains seamless continuations and merges identical segments', () => {
    const { doc, sections } = docWithClips([
      { start: 0, len: 16, offset: 0 },
      { start: 16, len: 16, offset: 16 },
      { start: 40, len: 8, offset: 0 },
    ]);
    const c = compileArrangement(doc, sections, SR);
    expect(c.chainCount).toBe(2);
    expect(c.segments).toHaveLength(2);
    expect(c.segments[0]!.clipIds).toHaveLength(2);
    expect(c.segments[0]!.endSample).toBe(Math.round(((32 * 60) / 130) * SR));
  });

  it('a split clip renders bit-identically to the unsplit clip', () => {
    const whole = docWithClips([{ start: 0, len: 16 }]);
    const parts = docWithClips([
      { start: 0, len: 6.5, offset: 0 },
      { start: 6.5, len: 9.5, offset: 6.5 },
    ]);
    const a = renderArrangement(whole.doc, whole.sections, { tailSeconds: 0.5 });
    const b = renderArrangement(parts.doc, parts.sections, { tailSeconds: 0.5 });
    expect(a.numSamples).toBe(b.numSamples);
    let maxDiff = 0;
    let energy = 0;
    for (let i = 0; i < a.numSamples; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(a.left[i]! - b.left[i]!), Math.abs(a.right[i]! - b.right[i]!));
      energy += a.left[i]! * a.left[i]!;
    }
    expect(energy).toBeGreaterThan(1);
    expect(maxDiff).toBe(0);
  });

  it('clip boundaries are sample-accurate (silence before, sound after)', () => {
    const { doc, sections } = docWithClips([{ start: 4, len: 8 }], 120);
    const r = renderArrangement(doc, sections, { tailSeconds: 0 });
    const startSample = 2 * SR; // beat 4 @ 120 BPM
    let pre = 0;
    for (let i = 0; i < startSample; i++) pre = Math.max(pre, Math.abs(r.left[i]!));
    let post = 0;
    for (let i = startSample; i < startSample + SR; i++) post = Math.max(post, Math.abs(r.left[i]!));
    expect(pre).toBe(0);
    expect(post).toBeGreaterThan(0.01);
  });

  it('layer overrides mute layers', () => {
    const snap = baseSnapshot();
    const allOff = Object.fromEntries(snap.layers.map((l) => [l.id, { enabled: false }]));
    const { doc, sections } = docWithClips([{ start: 0, len: 8, overrides: allOff }]);
    const r = renderArrangement(doc, sections, { tailSeconds: 0 });
    // After the mute fade (first ~50 ms) everything is silent.
    let peak = 0;
    for (let i = Math.round(0.1 * SR); i < r.numSamples; i++) peak = Math.max(peak, Math.abs(r.left[i]!));
    expect(peak).toBeLessThan(1e-3);
  });

  it('render length follows tempo changes', () => {
    let { doc, sections } = docWithClips([{ start: 0, len: 16 }], 120);
    doc = setTempoMarker(doc, 8, 60, makeId);
    const r = renderArrangement(doc, sections, { tailSeconds: 0 });
    // 8 beats @120 (4 s) + 8 beats @60 (8 s) = 12 s
    expect(r.numSamples).toBe(12 * SR);
  });

  it('track mute silences, two parallel sections stay in sync', () => {
    const snap = baseSnapshot();
    const sections = new Map([['sec-a', snap]]);
    let doc: ArrangementDoc = { ...EMPTY_DOC, tempoMarkers: [{ id: 't', beat: 0, bpm: 130 }] };
    const t1 = createTrack('section', makeId, 0);
    const t2 = { ...createTrack('section', makeId, 1), muted: true };
    doc = addTrack(addTrack(doc, t1), t2);
    doc = addClip(doc, t1.id, createSectionClip(makeId, 'sec-a', 0, 8));
    doc = addClip(doc, t2.id, createSectionClip(makeId, 'sec-a', 0, 8));
    const engine = new ArrangementEngine(SR, { maxPlayers: 4 });
    engine.setArrangement(doc, sections);
    const L = new Float32Array(128);
    const R = new Float32Array(128);
    for (let i = 0; i < 200; i++) engine.processBlock(L, R, 128);
    expect(engine.getTelemetry().activePlayers).toBe(2);
    expect(engine.getTelemetry().trackPeaks[1]).toBe(0);
    expect(engine.getTelemetry().trackPeaks[0]).toBeGreaterThan(0);
  });

  it('performance: 3 parallel sections, 10 s, within budget', () => {
    const snap = baseSnapshot();
    const sections = new Map([['sec-a', snap]]);
    let doc: ArrangementDoc = { ...EMPTY_DOC, tempoMarkers: [{ id: 't', beat: 0, bpm: 130 }] };
    for (let i = 0; i < 3; i++) {
      const t = createTrack('section', makeId, i);
      doc = addTrack(doc, t);
      doc = addClip(doc, t.id, createSectionClip(makeId, 'sec-a', 0, 22));
    }
    const t0 = performance.now();
    const r = renderArrangement(doc, sections, { tailSeconds: 0 });
    const ms = performance.now() - t0;
    expect(r.durationSeconds).toBeGreaterThan(10);
    expect(ms).toBeLessThan(10000);
  });
});

describe('Keyframe automation', () => {
  it('interpolates linear / hold / smooth without overshoot', () => {
    const pts = [
      { beat: 0, value: 0, curve: 'linear' as const },
      { beat: 4, value: 1, curve: 'hold' as const },
      { beat: 8, value: 0.5, curve: 'smooth' as const },
      { beat: 12, value: 0.5, curve: 'linear' as const },
    ];
    expect(evaluateKeyframes(pts, -1)).toBe(0);
    expect(evaluateKeyframes(pts, 2)).toBeCloseTo(0.5);
    expect(evaluateKeyframes(pts, 6)).toBe(1);
    expect(evaluateKeyframes(pts, 20)).toBe(0.5);
    for (let b = 8; b <= 12; b += 0.25) {
      const v = evaluateKeyframes(pts, b);
      expect(v).toBeGreaterThanOrEqual(0.5 - 1e-9);
      expect(v).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });

  it('track level automation fades a track out', () => {
    const { doc: d0, sections } = docWithClips([{ start: 0, len: 16 }], 120);
    const trackId = d0.tracks[0]!.id;
    const doc: ArrangementDoc = {
      ...d0,
      automation: [
        {
          id: 'lane',
          enabled: true,
          target: { scope: 'track', trackId, param: 'level' },
          points: [
            { beat: 0, value: 1, curve: 'linear' },
            { beat: 4, value: 0, curve: 'linear' },
          ],
        },
      ],
    };
    const r = renderArrangement(doc, sections, { tailSeconds: 0 });
    let late = 0;
    for (let i = 3 * SR; i < r.numSamples; i++) late = Math.max(late, Math.abs(r.left[i]!));
    expect(late).toBeLessThan(1e-3);
  });
});

describe('Clip-layer keyframes & tails (phase C)', () => {
  it('a layer can be switched on later inside one clip (Kick ab Takt 3)', () => {
    const snap = baseSnapshot();
    const allOff = Object.fromEntries(snap.layers.map((l) => [l.id, { enabled: false }]));
    const { doc: d0, sections } = docWithClips([{ start: 0, len: 16, overrides: allOff }], 120);
    const clipId = d0.tracks[0]!.clips[0]!.id;
    const layer = snap.layers[0]!;
    const doc: ArrangementDoc = {
      ...d0,
      automation: [
        {
          id: 'en',
          enabled: true,
          target: { scope: 'clip-layer', clipId, layerId: layer.id, param: 'enabled' },
          points: [
            { beat: 0, value: 0, curve: 'hold' },
            { beat: 8, value: 1, curve: 'hold' },
          ],
        },
      ],
    };
    const r = renderArrangement(doc, sections, { tailSeconds: 0 });
    let early = 0;
    for (let i = Math.round(0.2 * SR); i < 4 * SR - 10; i++) early = Math.max(early, Math.abs(r.left[i]!));
    let late = 0;
    for (let i = 4 * SR; i < 8 * SR; i++) late = Math.max(late, Math.abs(r.left[i]!));
    expect(early).toBeLessThan(1e-3);
    expect(late).toBeGreaterThan(0.01);
  });

  it('tail keeps the song longer and the voices stop at the clip end', () => {
    const { doc: d0, sections } = docWithClips([{ start: 0, len: 8 }], 120);
    const clip = d0.tracks[0]!.clips[0]!;
    const doc: ArrangementDoc = {
      ...d0,
      tracks: [{ ...d0.tracks[0]!, clips: [{ ...clip, tailBeats: 4 } as typeof clip] }],
    };
    const c = compileArrangement(doc, sections, SR);
    expect(c.segments[0]!.tailEndSample).toBe(6 * SR);
    expect(c.endBeat).toBe(12);
  });
});


describe('Transition templates (C4)', () => {
  it('every template applies at a boundary, renders, and can be removed', async () => {
    const { applyTransition, findBoundary, removeTransition, TRANSITIONS } = await import('../../src/core/arrangement/transitions');
    const { doc: base, sections } = docWithClips(
      [
        { start: 0, len: 8 },
        { start: 8, len: 8, offset: 3 },
      ],
      120,
    );
    const trackId = base.tracks[0]!.id;
    const tm = new TempoMap(base.tempoMarkers, base.meterMarkers);
    for (const t of TRANSITIONS) {
      if (t.id === 'riser') continue;
      const boundary = findBoundary(base, trackId, 7.6)!;
      expect(boundary.beat).toBe(8);
      const runId = `run-${t.id}`;
      const r = applyTransition({ template: t.id, trackId, boundary, lengthBeats: 4, runId, tempoMap: tm, makeId })(base);
      expect(r.message).toBeNull();
      expect(r.doc).not.toBe(base);
      const out = renderArrangement(r.doc, sections, { tailSeconds: 0.2, endBeat: 12 });
      let finite = true;
      for (let i = 0; i < out.numSamples; i += 97) if (!Number.isFinite(out.left[i]!)) finite = false;
      expect(finite).toBe(true);
      const removed = removeTransition(r.doc, runId);
      expect(removed.automation.length).toBe(0);
      expect(removed.tracks[0]!.fx.length).toBe(0);
    }
  }, 60000);
});

describe('Keyframes on any layer control inside a clip (C2b)', () => {
  it('a clip-layer-param lane drives a processor parameter via the external source', () => {
    const probe = docWithClips([{ start: 0, len: 16 }], 120);
    const snap = probe.sections.get('sec-a')!;
    // The chord layer (L4) has a bright tone filter worth sweeping.
    const layer = snap.layers[snap.layers.length - 1]!;
    const card = layer.processorChain.find((c) => c.moduleId === 'card-tone-filter')!;
    const solo = Object.fromEntries(snap.layers.filter((l) => l.id !== layer.id).map((l) => [l.id, { enabled: false }]));
    const sections = probe.sections;
    const d0: ArrangementDoc = {
      ...probe.doc,
      tracks: [{ ...probe.doc.tracks[0]!, clips: [{ ...probe.doc.tracks[0]!.clips[0]!, layerOverrides: solo } as SectionClipT] }],
    };
    const clipId = d0.tracks[0]!.clips[0]!.id;
    const withLane = (value: number): ArrangementDoc => ({
      ...d0,
      automation: [
        {
          id: 'p',
          enabled: true,
          target: { scope: 'clip-layer-param', clipId, layerId: layer.id, domain: 'processor', cardId: card.id, paramId: 'brightness' },
          points: [{ beat: 0, value, curve: 'linear' }],
        },
      ],
    });
    const energy = (doc: ArrangementDoc) => {
      const r = renderArrangement(doc, sections, { tailSeconds: 0, outputStage: 'pre-master' });
      let e = 0;
      for (let i = 0; i < r.numSamples; i++) e += r.left[i]! * r.left[i]!;
      return e;
    };
    const dark = energy(withLane(0));
    const bright = energy(withLane(1));
    expect(Math.abs(dark - bright) / Math.max(dark, bright)).toBeGreaterThan(0.05);
    const c = compileArrangement(withLane(0.2), sections, SR);
    expect(c.segments[0]!.paramLanes.length).toBe(1);
    const injected = c.segments[0]!.snapshot!.layers.find((l) => l.id === layer.id)!.modulations.filter((m) => m.sourceType === 'external');
    expect(injected.length).toBe(1);
  }, 30000);
});
