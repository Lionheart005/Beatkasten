import { describe, expect, it } from 'vitest';
import { defaultRegistry } from '../../src/core/defaultRegistry';
import {
  commitSnapshot,
  createChordToOffbeatArpPreset,
  createHypnoticAMinorProject,
  createInitialHistory,
  createTripletRiddlePreset,
  getAncestorLineage,
  jumpToHistoryNode,
  stepRedoFirstChild,
  stepUndo,
  toggleBookmark,
  type BeatSnapshot,
  type ProjectDocument,
} from '../../src/core/state';

function assertSnapshotModulesExistInRegistry(snapshot: BeatSnapshot): void {
  expect(snapshot.tempoBpm).toBeGreaterThan(0);
  expect(snapshot.layers.length).toBeGreaterThan(0);

  const curveIds = new Set(snapshot.curves.map((c) => c.id));

  for (const layer of snapshot.layers) {
    // Voice module must exist
    const voice = defaultRegistry.getVoice(layer.voice.moduleId);
    expect(voice, `Missing voice module: ${layer.voice.moduleId}`).toBeDefined();

    // Time operators must exist
    for (const op of layer.timeOperators) {
      const opMod = defaultRegistry.getTimeOperator(op.moduleId);
      expect(opMod, `Missing time operator: ${op.moduleId}`).toBeDefined();
    }

    // Processor cards must exist
    for (const card of layer.processorChain) {
      const cardMod = defaultRegistry.getProcessor(card.moduleId);
      expect(cardMod, `Missing processor module: ${card.moduleId}`).toBeDefined();
    }

    // Drawn-curve modulation routes must reference valid curve IDs
    for (const mod of layer.modulations) {
      if (mod.sourceType === 'drawn-curve' && mod.sourceConfig.curveId) {
        expect(curveIds.has(mod.sourceConfig.curveId)).toBe(true);
      }
    }
  }
}

describe('HistoryTree branching & navigation', () => {
  it('preserves sibling branches, supports jump, bookmark, undo/redo, and JSON roundtrip', () => {
    const baseSnap = createTripletRiddlePreset();
    const snapA: BeatSnapshot = { ...baseSnap, id: 'snap_a', tempoBpm: 134 };
    const snapB: BeatSnapshot = { ...baseSnap, id: 'snap_b', tempoBpm: 138 };
    const snapA1: BeatSnapshot = { ...baseSnap, id: 'snap_a1', tempoBpm: 140 };

    const init = createInitialHistory(baseSnap, 'Root');
    expect(init.nodes).toHaveLength(1);
    const rootId = init.activeNodeId;
    expect(init.nodes[0]?.parentId).toBeNull();

    // Branch A from root
    const afterA = commitSnapshot(init.nodes, rootId, snapA, 'Branch A');
    const nodeAId = afterA.activeNodeId;
    expect(afterA.nodes).toHaveLength(2);

    // Child A1 under Branch A
    const afterA1 = commitSnapshot(afterA.nodes, nodeAId, snapA1, 'Child A1');
    const nodeA1Id = afterA1.activeNodeId;
    expect(afterA1.nodes).toHaveLength(3);

    // Branch B from root — must preserve Branch A and Child A1!
    const afterB = commitSnapshot(afterA1.nodes, rootId, snapB, 'Branch B');
    const nodeBId = afterB.activeNodeId;
    expect(afterB.nodes).toHaveLength(4);

    // Jump to nodes
    expect(jumpToHistoryNode(afterB.nodes, nodeAId)?.id).toBe('snap_a');
    expect(jumpToHistoryNode(afterB.nodes, nodeBId)?.id).toBe('snap_b');
    expect(jumpToHistoryNode(afterB.nodes, nodeA1Id)?.id).toBe('snap_a1');
    expect(jumpToHistoryNode(afterB.nodes, 'non_existent')).toBeUndefined();

    // Undo & Redo
    expect(stepUndo(afterB.nodes, nodeA1Id)).toBe(nodeAId);
    expect(stepUndo(afterB.nodes, nodeAId)).toBe(rootId);
    expect(stepUndo(afterB.nodes, rootId)).toBeNull();
    expect(stepRedoFirstChild(afterB.nodes, rootId)).toBe(nodeAId);
    expect(stepRedoFirstChild(afterB.nodes, nodeAId)).toBe(nodeA1Id);
    expect(stepRedoFirstChild(afterB.nodes, nodeA1Id)).toBeNull();

    // Lineage
    const lineage = getAncestorLineage(afterB.nodes, nodeA1Id);
    expect(lineage.map((n) => n.id)).toEqual([rootId, nodeAId, nodeA1Id]);

    // Bookmarks (immutability + toggle off removes bookmarkName)
    const bookmarked = toggleBookmark(afterB.nodes, nodeBId, 'Peak Drop');
    expect(afterB.nodes.find((n) => n.id === nodeBId)?.bookmarked).toBe(false);
    const bmNode = bookmarked.find((n) => n.id === nodeBId);
    expect(bmNode?.bookmarked).toBe(true);
    expect(bmNode?.bookmarkName).toBe('Peak Drop');

    const unbookmarked = toggleBookmark(bookmarked, nodeBId);
    const ubmNode = unbookmarked.find((n) => n.id === nodeBId);
    expect(ubmNode?.bookmarked).toBe(false);
    expect(ubmNode?.bookmarkName).toBeUndefined();

    // JSON roundtrip on full ProjectDocument
    const project = createHypnoticAMinorProject();
    const docWithHistory: ProjectDocument = {
      ...project,
      activeHistoryNodeId: nodeBId,
      historyNodes: bookmarked,
    };
    const serialized = JSON.stringify(docWithHistory);
    const parsed = JSON.parse(serialized) as ProjectDocument;

    expect(parsed.id).toBe(docWithHistory.id);
    expect(parsed.historyNodes).toHaveLength(4);
    expect(jumpToHistoryNode(parsed.historyNodes, nodeA1Id)?.tempoBpm).toBe(140);
    expect(parsed.historyNodes.find((n) => n.id === nodeBId)?.bookmarkName).toBe(
      'Peak Drop',
    );
  });
});

describe('Built-in Presets & Registry Contract', () => {
  it('validates all 3 starter presets and verifies all moduleIds exist in defaultRegistry', () => {
    const hypnoticProject = createHypnoticAMinorProject();
    expect(hypnoticProject.sections).toHaveLength(3);
    assertSnapshotModulesExistInRegistry(hypnoticProject.activeSnapshot);
    for (const section of hypnoticProject.sections) {
      assertSnapshotModulesExistInRegistry(section.snapshot);
    }

    const tripletRiddle = createTripletRiddlePreset();
    assertSnapshotModulesExistInRegistry(tripletRiddle);

    const chordToOffbeat = createChordToOffbeatArpPreset();
    assertSnapshotModulesExistInRegistry(chordToOffbeat);
  });
});
