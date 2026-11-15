import type { LayerConfig } from '../../core/state/types';

export interface LayerBlock {
  readonly kind: 'single' | 'group';
  readonly group?: string;
  readonly layers: LayerConfig[];
}

/**
 * Groups the layer stack into display blocks: an ungrouped layer is its own
 * block, a group block appears at the position of its first member and collects
 * all members (in stack order).
 */
export function buildLayerBlocks(layers: readonly LayerConfig[]): LayerBlock[] {
  const blocks: LayerBlock[] = [];
  const groupBlocks = new Map<string, LayerBlock>();
  for (const layer of layers) {
    const g = layer.group?.trim();
    if (!g) {
      blocks.push({ kind: 'single', layers: [layer] });
      continue;
    }
    let block = groupBlocks.get(g);
    if (!block) {
      block = { kind: 'group', group: g, layers: [] };
      groupBlocks.set(g, block);
      blocks.push(block);
    }
    block.layers.push(layer);
  }
  return blocks;
}

export function flattenLayerBlocks(blocks: readonly LayerBlock[]): LayerConfig[] {
  const out: LayerConfig[] = [];
  for (const b of blocks) out.push(...b.layers);
  return out;
}

/** Existing group names in stack order. */
export function listLayerGroups(layers: readonly LayerConfig[]): string[] {
  return buildLayerBlocks(layers)
    .filter((b) => b.kind === 'group')
    .map((b) => b.group!);
}

/**
 * Moves a layer one step up (-1) or down (+1). Grouped layers move inside their
 * group; ungrouped layers and whole groups (`wholeGroup`) move past the
 * neighbouring block. Returns the original array when nothing changes.
 */
export function moveLayerInStack(
  layers: readonly LayerConfig[],
  layerId: string,
  direction: -1 | 1,
  wholeGroup = false,
): readonly LayerConfig[] {
  const blocks = buildLayerBlocks(layers);
  const bIdx = blocks.findIndex((b) => b.layers.some((l) => l.id === layerId));
  if (bIdx < 0) return layers;
  const block = blocks[bIdx]!;

  if (block.kind === 'group' && !wholeGroup) {
    const i = block.layers.findIndex((l) => l.id === layerId);
    const j = i + direction;
    if (j < 0 || j >= block.layers.length) return layers;
    const tmp = block.layers[i]!;
    block.layers[i] = block.layers[j]!;
    block.layers[j] = tmp;
    return flattenLayerBlocks(blocks);
  }

  const target = bIdx + direction;
  if (target < 0 || target >= blocks.length) return layers;
  const tmp = blocks[bIdx]!;
  blocks[bIdx] = blocks[target]!;
  blocks[target] = tmp;
  return flattenLayerBlocks(blocks);
}
