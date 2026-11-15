import type { BeatSnapshot, HistoryNode } from './types';

let historyIdCounter = 0;

function generateHistoryNodeId(): string {
  historyIdCounter += 1;
  const rand = Math.floor(Math.random() * 1_000_000)
    .toString(36)
    .padStart(4, '0');
  return `hist_${Date.now().toString(36)}_${historyIdCounter.toString(36)}_${rand}`;
}

/**
 * Creates the initial root node for a branching history tree.
 */
export function createInitialHistory(
  snapshot: BeatSnapshot,
  label = 'Startzustand',
): { activeNodeId: string; nodes: HistoryNode[] } {
  const rootId = generateHistoryNodeId();
  const rootNode: HistoryNode = {
    id: rootId,
    parentId: null,
    createdAt: Date.now(),
    label,
    bookmarked: false,
    snapshot,
  };

  return {
    activeNodeId: rootId,
    nodes: [rootNode],
  };
}

/**
 * Commits a new child snapshot under `parentId`, preserving all existing sibling branches.
 */
export function commitSnapshot(
  nodes: readonly HistoryNode[],
  parentId: string,
  snapshot: BeatSnapshot,
  label: string,
): { activeNodeId: string; nodes: HistoryNode[] } {
  const parentExists = nodes.some((n) => n.id === parentId);
  const resolvedParentId = parentExists
    ? parentId
    : (nodes[0]?.id ?? null);

  const nextId = generateHistoryNodeId();
  const nextNode: HistoryNode = {
    id: nextId,
    parentId: resolvedParentId,
    createdAt: Date.now(),
    label: label.trim() || 'Änderung',
    bookmarked: false,
    snapshot,
  };

  return {
    activeNodeId: nextId,
    nodes: [...nodes, nextNode],
  };
}

/**
 * Returns the snapshot associated with a given history node ID, if present.
 */
export function jumpToHistoryNode(
  nodes: readonly HistoryNode[],
  nodeId: string,
): BeatSnapshot | undefined {
  return nodes.find((n) => n.id === nodeId)?.snapshot;
}

/**
 * Toggles or sets a bookmark on a history node without mutating the input array.
 */
export function toggleBookmark(
  nodes: readonly HistoryNode[],
  nodeId: string,
  bookmarkName?: string,
): HistoryNode[] {
  return nodes.map((node) => {
    if (node.id !== nodeId) return node;

    if (bookmarkName !== undefined) {
      const trimmed = bookmarkName.trim();
      return {
        ...node,
        bookmarked: true,
        bookmarkName: trimmed.length > 0 ? trimmed : node.label,
      };
    }

    const nextBookmarked = !node.bookmarked;
    if (nextBookmarked) {
      return {
        ...node,
        bookmarked: true,
      };
    }

    const { bookmarkName: _removed, ...rest } = node;
    return {
      ...rest,
      bookmarked: false,
    };
  });
}

/**
 * Returns the ordered lineage from the root node down to `nodeId`.
 */
export function getAncestorLineage(
  nodes: readonly HistoryNode[],
  nodeId: string,
): HistoryNode[] {
  const byId = new Map<string, HistoryNode>();
  for (const node of nodes) {
    byId.set(node.id, node);
  }

  const lineage: HistoryNode[] = [];
  const visited = new Set<string>();
  let current = byId.get(nodeId);

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    lineage.push(current);
    current = current.parentId !== null ? byId.get(current.parentId) : undefined;
  }

  lineage.reverse();
  return lineage;
}

/**
 * Steps one node back toward the root, returning the parent node ID or null at the root.
 */
export function stepUndo(
  nodes: readonly HistoryNode[],
  activeNodeId: string,
): string | null {
  const current = nodes.find((n) => n.id === activeNodeId);
  return current?.parentId ?? null;
}

/**
 * Steps forward to the first child of `activeNodeId`, or returns null if it is a leaf.
 */
export function stepRedoFirstChild(
  nodes: readonly HistoryNode[],
  activeNodeId: string,
): string | null {
  const firstChild = nodes.find((n) => n.parentId === activeNodeId);
  return firstChild?.id ?? null;
}
