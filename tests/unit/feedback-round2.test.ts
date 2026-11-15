import { describe, expect, it } from 'vitest';
import { renderOfflineLoop } from '../../src/core/engine/OfflineRenderer';
import { TechnoEngine } from '../../src/core/engine/TechnoEngine';
import { computeFullRepeatBars } from '../../src/core/engine/cycleMath';
import {
  createBellsAndOrganPreset,
  createDefaultLayer,
  createHypnoticAMinorProject,
  repairProjectIds,
  repairSnapshotIds,
} from '../../src/core/state';
import type { BeatSnapshot } from '../../src/core/state/types';
import { moveLayerInStack } from '../../src/ui/store/layerGroups';

describe('Feedback round 2', () => {
  it('createDefaultLayer IDs never collide with legacy counter IDs', () => {
    const a = createDefaultLayer('A', 'modal-bell');
    const b = createDefaultLayer('B', 'modal-bell');
    expect(a.id).not.toBe(b.id);
    expect(a.id).not.toMatch(/^layer_[0-9a-z]+$/);
  });

  it('repairSnapshotIds de-duplicates layer IDs deterministically (incl. history)', () => {
    const base = createBellsAndOrganPreset();
    const dupe = { ...base.layers[1]!, id: base.layers[0]!.id, name: 'Dupe' };
    const broken: BeatSnapshot = { ...base, layers: [...base.layers, dupe] };
    const fixed = repairSnapshotIds(broken);
    const ids = fixed.layers.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(repairSnapshotIds(fixed)).toBe(fixed); // idempotent, same reference

    const doc = createHypnoticAMinorProject();
    const brokenDoc = {
      ...doc,
      activeSnapshot: broken,
      historyNodes: doc.historyNodes.map((n) => ({ ...n, snapshot: broken })),
    };
    const fixedDoc = repairProjectIds(brokenDoc);
    expect(fixedDoc.activeSnapshot.layers.map((l) => l.id)).toEqual(ids);
    expect(fixedDoc.historyNodes[0]!.snapshot.layers.map((l) => l.id)).toEqual(ids);
  });

  it('moveLayerInStack moves layers inside groups and whole groups as blocks', () => {
    const mk = (id: string, group?: string) => ({
      ...createDefaultLayer(id, 'pulse-texture'),
      id,
      ...(group ? { group } : {}),
    });
    const layers = [mk('a'), mk('b', 'G'), mk('c', 'G'), mk('d')];
    expect(moveLayerInStack(layers, 'c', -1).map((l) => l.id)).toEqual(['a', 'c', 'b', 'd']);
    expect(moveLayerInStack(layers, 'b', -1)).toBe(layers); // edge of group: no-op
    expect(moveLayerInStack(layers, 'b', -1, true).map((l) => l.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveLayerInStack(layers, 'd', -1).map((l) => l.id)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('engine switches chords on exact beats and includes the progression in the cycle', () => {
    const base = createBellsAndOrganPreset();
    const snap: BeatSnapshot = {
      ...base,
      harmony: {
        ...base.harmony,
        progressionMode: 'custom',
        customSteps: [
          { id: 's1', degree: 0, accidental: 0, chordType: 'auto', durationBeats: 3, transitionType: 'glide', transitionBeats: 1 },
          { id: 's2', degree: 5, accidental: 0, chordType: 'maj9', durationBeats: 5, transitionType: 'crossfade', transitionBeats: 0.5 },
        ],
      },
    };
    const engine = new TechnoEngine(48000);
    engine.applySnapshot(snap);
    expect(engine.getHarmonyTimeline().totalBeats).toBe(8);
    expect(engine.getTelemetry().combinedCycleBeats % 8).toBe(0);
    const out = new Float32Array(48000);
    const outR = new Float32Array(48000);
    engine.processBlock(out, outR, 48000);
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
    expect(computeFullRepeatBars(snap) * 4 % 8).toBe(0);
  });

  it('pre-roll export starts the loop on a loop-length boundary (identical to no pre-roll for full repeats)', () => {
    const snap = createBellsAndOrganPreset();
    const bars = computeFullRepeatBars(snap);
    const a = renderOfflineLoop(snap, { bars, preRollBars: 0, sampleRate: 22050 });
    const b = renderOfflineLoop(snap, { bars, preRollBars: 2, sampleRate: 22050 });
    expect(b.numSamples).toBe(a.numSamples);
    // Loop starts at the same musical position: energy profile of the first bar matches closely.
    const n = Math.floor(a.numSamples / bars);
    let ea = 0;
    let eb = 0;
    for (let i = 0; i < n; i++) {
      ea += a.left[i]! * a.left[i]!;
      eb += b.left[i]! * b.left[i]!;
    }
    expect(Math.abs(ea - eb) / Math.max(1e-9, ea)).toBeLessThan(0.5);
  });
});
