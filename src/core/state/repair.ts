import type { BeatSnapshot, LayerConfig, ProjectDocument } from './types';

/**
 * Older builds generated layer IDs from a per-page-load counter (`layer_1`, …),
 * so layers added after reloading a saved project could share an ID with an
 * existing layer. Duplicate IDs make the engine render one LayerEngine twice and
 * the UI select/delete several layers at once.
 *
 * This repair is deterministic (suffix derived from the layer index), so the
 * same layer receives the same new ID in the active snapshot, every history
 * node and every section.
 */
export function repairSnapshotIds(snapshot: BeatSnapshot): BeatSnapshot {
  const seen = new Set<string>();
  let changed = false;

  const layers = snapshot.layers.map((layer, index): LayerConfig => {
    if (!seen.has(layer.id)) {
      seen.add(layer.id);
      return layer;
    }
    changed = true;
    let newId = `${layer.id}__dup${index}`;
    while (seen.has(newId)) newId = `${newId}x`;
    seen.add(newId);
    return reassignLayerId(layer, newId);
  });

  return changed ? { ...snapshot, layers } : snapshot;
}

function reassignLayerId(layer: LayerConfig, newId: string): LayerConfig {
  const opIds = new Map<string, string>();
  const cardIds = new Map<string, string>();
  const modIds = new Map<string, string>();

  const timeOperators = layer.timeOperators.map((op) => {
    const id = `${newId}__${op.id}`;
    opIds.set(op.id, id);
    return { ...op, id };
  });
  const processorChain = layer.processorChain.map((card) => {
    const id = `${newId}__${card.id}`;
    cardIds.set(card.id, id);
    return { ...card, id };
  });
  layer.modulations.forEach((m) => modIds.set(m.id, `${newId}__${m.id}`));

  const modulations = layer.modulations.map((m) => {
    let targetCardId = m.targetCardId;
    if (m.targetDomain === 'time') targetCardId = opIds.get(targetCardId) ?? targetCardId;
    else if (m.targetDomain === 'processor')
      targetCardId = cardIds.get(targetCardId) ?? targetCardId;
    else if (m.targetDomain === 'modulation')
      targetCardId = modIds.get(targetCardId) ?? targetCardId;
    return {
      ...m,
      id: modIds.get(m.id) ?? m.id,
      targetCardId,
      sourceConfig:
        m.sourceConfig.sourceLayerId === layer.id
          ? { ...m.sourceConfig, sourceLayerId: newId }
          : m.sourceConfig,
    };
  });

  return { ...layer, id: newId, timeOperators, processorChain, modulations };
}

/** Applies {@link repairSnapshotIds} to the active snapshot, history and sections. */
export function repairProjectIds(doc: ProjectDocument): ProjectDocument {
  let changed = false;
  const fix = (snap: BeatSnapshot): BeatSnapshot => {
    const next = repairSnapshotIds(snap);
    if (next !== snap) changed = true;
    return next;
  };

  const activeSnapshot = fix(doc.activeSnapshot);
  const historyNodes = doc.historyNodes.map((n) => {
    const snapshot = fix(n.snapshot);
    return snapshot === n.snapshot ? n : { ...n, snapshot };
  });
  const sections = doc.sections.map((s) => {
    const snapshot = fix(s.snapshot);
    return snapshot === s.snapshot ? s : { ...s, snapshot };
  });

  return changed ? { ...doc, activeSnapshot, historyNodes, sections } : doc;
}
