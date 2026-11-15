import { useMemo, useState } from 'react';
import {
  Bookmark,
  Copy,
  GitBranch,
  Play,
  Plus,
  Redo2,
  RefreshCw,
  Star,
  Trash2,
  Undo2,
} from 'lucide-react';
import type { HistoryNode, SectionItem } from '../../core/state/types';
import type { SectionSwitchMode } from '../store/useStudioStore';

interface SectionsAndHistoryPanelProps {
  sections: readonly SectionItem[];
  sectionSwitchMode: SectionSwitchMode;
  pendingSectionId: string | null;
  historyNodes: readonly HistoryNode[];
  activeHistoryNodeId: string;
  compareNodeId: string | null;
  abCompareActive: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onSetSectionSwitchMode: (mode: SectionSwitchMode) => void;
  onTriggerSection: (section: SectionItem) => void;
  onSaveNewSection: (name: string, notes: string, exportBars: number) => void;
  onDuplicateSection: (sectionId: string) => void;
  onOverwriteSection: (sectionId: string) => void;
  onUpdateSectionMeta: (
    sectionId: string,
    patch: Partial<Pick<SectionItem, 'name' | 'notes' | 'exportBars'>>,
  ) => void;
  onDeleteSection: (sectionId: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onJumpHistory: (nodeId: string) => void;
  onToggleBookmark: (nodeId: string) => void;
  onToggleAbCompare: (nodeId?: string) => void;
  onClearCompare: () => void;
}

interface TreeDisplayRow {
  readonly node: HistoryNode;
  readonly depth: number;
  readonly isBranchStart: boolean;
}

function buildTreeRows(nodes: readonly HistoryNode[]): TreeDisplayRow[] {
  const childrenMap = new Map<string | null, HistoryNode[]>();
  const knownIds = new Set(nodes.map((n) => n.id));

  for (const node of nodes) {
    const parentKey =
      node.parentId !== null && knownIds.has(node.parentId)
        ? node.parentId
        : null;
    const list = childrenMap.get(parentKey) ?? [];
    list.push(node);
    childrenMap.set(parentKey, list);
  }

  const rows: TreeDisplayRow[] = [];
  const visited = new Set<string>();

  const walk = (node: HistoryNode, depth: number, isBranchStart: boolean) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    rows.push({ node, depth, isBranchStart });
    const kids = childrenMap.get(node.id) ?? [];
    kids.forEach((child, idx) => {
      walk(child, idx === 0 ? depth : depth + 1, idx > 0);
    });
  };

  const roots = childrenMap.get(null) ?? [];
  roots.forEach((root, idx) => walk(root, 0, idx > 0));

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      walk(node, 0, false);
    }
  }

  return rows;
}

export function SectionsAndHistoryPanel({
  sections,
  sectionSwitchMode,
  pendingSectionId,
  historyNodes,
  activeHistoryNodeId,
  compareNodeId,
  abCompareActive,
  canUndo,
  canRedo,
  onSetSectionSwitchMode,
  onTriggerSection,
  onSaveNewSection,
  onDuplicateSection,
  onOverwriteSection,
  onUpdateSectionMeta,
  onDeleteSection,
  onUndo,
  onRedo,
  onJumpHistory,
  onToggleBookmark,
  onToggleAbCompare,
  onClearCompare,
}: SectionsAndHistoryPanelProps) {
  const [newSectionName, setNewSectionName] = useState('');
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [bookmarksOnly, setBookmarksOnly] = useState(false);

  const treeRows = useMemo(() => buildTreeRows(historyNodes), [historyNodes]);
  const visibleRows = useMemo(
    () =>
      bookmarksOnly
        ? treeRows.filter(
            (r) => r.node.bookmarked || r.node.id === activeHistoryNodeId,
          )
        : treeRows,
    [activeHistoryNodeId, bookmarksOnly, treeRows],
  );

  const compareNode = useMemo(
    () => historyNodes.find((n) => n.id === compareNodeId) ?? null,
    [compareNodeId, historyNodes],
  );

  return (
    <aside className="dock-panel">
      {/* Top Half: Song Sections */}
      <div className="panel-header">
        <span>Song-Abschnitte ({sections.length})</span>
        <div style={{ display: 'flex', gap: 3 }}>
          <button
            type="button"
            className={`btn-sm${sectionSwitchMode === 'immediate' ? ' is-active' : ''}`}
            onClick={() => onSetSectionSwitchMode('immediate')}
            title="Abschnitt sofort beim Klick umschalten"
          >
            Sofort
          </button>
          <button
            type="button"
            className={`btn-sm${sectionSwitchMode === 'next-bar' ? ' is-active' : ''}`}
            onClick={() => onSetSectionSwitchMode('next-bar')}
            title="Abschnitt exakt beim nächsten Taktwechsel umschalten"
          >
            Nächster Takt
          </button>
        </div>
      </div>

      <div
        className="panel-scroll"
        style={{ maxHeight: '46%', borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div style={{ display: 'flex', gap: 5 }}>
          <input
            type="text"
            value={newSectionName}
            onChange={(e) => setNewSectionName(e.target.value)}
            placeholder="Neuer Abschnitt (z. B. 04_Drop)"
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => {
              onSaveNewSection(
                newSectionName || `0${sections.length + 1}_Section`,
                '',
                8,
              );
              setNewSectionName('');
            }}
            title="Aktuellen Zustand als neuen Abschnitt speichern"
          >
            <Plus size={12} /> Neu
          </button>
        </div>

        {sections.map((sec) => {
          const isPending = pendingSectionId === sec.id;
          const isEditing = editingSectionId === sec.id;
          return (
            <div
              key={sec.id}
              className={`section-item${isPending ? ' is-pending' : ''}`}
              style={{ borderLeftColor: sec.color }}
            >
              <div className="sub-card-head">
                <button
                  type="button"
                  className="btn-ghost"
                  style={{
                    padding: '2px 4px',
                    fontWeight: 600,
                    justifyContent: 'flex-start',
                    flex: 1,
                    color: '#eef2f9',
                  }}
                  onClick={() => onTriggerSection(sec)}
                  title={`Abschnitt aktivieren (${
                    sectionSwitchMode === 'next-bar'
                      ? 'ab nächstem Takt'
                      : 'sofort'
                  })`}
                >
                  <Play size={11} color={sec.color} />
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {sec.name}
                  </span>
                  {isPending && (
                    <span
                      style={{
                        fontSize: 10,
                        color: '#f59e0b',
                        marginLeft: 4,
                      }}
                    >
                      (wartet…)
                    </span>
                  )}
                </button>

                <div style={{ display: 'flex', gap: 2 }}>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => onOverwriteSection(sec.id)}
                    title="Aktuellen Zustand in diesen Abschnitt übernehmen"
                  >
                    <RefreshCw size={11} />
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => onDuplicateSection(sec.id)}
                    title="Abschnitt duplizieren"
                  >
                    <Copy size={11} />
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() =>
                      setEditingSectionId(isEditing ? null : sec.id)
                    }
                    title="Name, Notiz & Takte bearbeiten"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-danger btn-sm"
                    onClick={() => onDeleteSection(sec.id)}
                    title="Abschnitt löschen"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>

              {sec.notes && !isEditing && (
                <div className="muted-note">
                  {sec.notes} · {sec.exportBars} Takte
                </div>
              )}

              {isEditing && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    marginTop: 2,
                  }}
                >
                  <input
                    type="text"
                    value={sec.name}
                    onChange={(e) =>
                      onUpdateSectionMeta(sec.id, { name: e.target.value })
                    }
                    placeholder="Name"
                  />
                  <input
                    type="text"
                    value={sec.notes}
                    onChange={(e) =>
                      onUpdateSectionMeta(sec.id, { notes: e.target.value })
                    }
                    placeholder="Notiz für diesen Abschnitt"
                  />
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 6,
                    }}
                  >
                    <span className="muted-note">Export-Takte:</span>
                    <input
                      type="number"
                      min={1}
                      max={64}
                      value={sec.exportBars}
                      style={{ width: 64 }}
                      onChange={(e) =>
                        onUpdateSectionMeta(sec.id, {
                          exportBars: Math.max(1, Number(e.target.value) || 4),
                        })
                      }
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom Half: Branching History Tree + A/B Compare */}
      <div className="panel-header">
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <GitBranch size={13} color="#a855f7" />
          History-Baum ({historyNodes.length})
        </span>
        <div style={{ display: 'flex', gap: 3 }}>
          <button
            type="button"
            className="btn-sm"
            disabled={!canUndo}
            onClick={onUndo}
            title="Rückgängig (Strg+Z)"
          >
            <Undo2 size={12} />
          </button>
          <button
            type="button"
            className="btn-sm"
            disabled={!canRedo}
            onClick={onRedo}
            title="Wiederholen (Strg+Y)"
          >
            <Redo2 size={12} />
          </button>
          <button
            type="button"
            className={`btn-sm${bookmarksOnly ? ' is-active' : ''}`}
            onClick={() => setBookmarksOnly((b) => !b)}
            title="Nur Favoriten (★) anzeigen"
          >
            <Bookmark size={11} />
          </button>
        </div>
      </div>

      {compareNode && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
            padding: '6px 10px',
            background: 'rgba(245, 158, 11, 0.14)',
            borderBottom: '1px solid rgba(245, 158, 11, 0.4)',
            fontSize: 11.5,
          }}
        >
          <button
            type="button"
            className={`btn-sm${abCompareActive ? ' is-active' : ''}`}
            onClick={() => onToggleAbCompare()}
            title="Zwischen aktuellem Stand (A) und Vergleichs-Knoten (B) umschalten"
          >
            {abCompareActive ? `Höre B: ${compareNode.label}` : `Höre A (Aktuell) ↔ B`}
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={onClearCompare}
            title="A/B-Vergleich beenden"
          >
            ✕
          </button>
        </div>
      )}

      <div className="panel-scroll">
        {visibleRows.map(({ node, depth, isBranchStart }) => {
          const isActive = node.id === activeHistoryNodeId;
          const isCompare = node.id === compareNodeId;
          const indentPx = Math.min(4, depth) * 14;
          return (
            <div
              key={node.id}
              className={`history-tree-node${isActive ? ' is-active' : ''}${
                isCompare ? ' is-compare' : ''
              }`}
              style={{ paddingLeft: 6 + indentPx }}
              onClick={() => onJumpHistory(node.id)}
              title={`Zu „${node.label}“ springen (${new Date(
                node.createdAt,
              ).toLocaleTimeString('de-DE')})`}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  minWidth: 0,
                  flex: 1,
                }}
              >
                <span
                  style={{
                    color: isBranchStart ? '#a855f7' : 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                  }}
                >
                  {isBranchStart ? '↳' : depth > 0 ? '│' : '●'}
                </span>
                <span
                  style={{
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    fontWeight: isActive ? 700 : 400,
                  }}
                >
                  {node.label}
                </span>
              </div>

              <div
                style={{ display: 'flex', gap: 2, flexShrink: 0 }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className={`btn-ghost btn-sm${isCompare ? ' is-active' : ''}`}
                  onClick={() => onToggleAbCompare(node.id)}
                  title="Als A/B-Vergleichspunkt B anhören"
                >
                  A/B
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => onToggleBookmark(node.id)}
                  title="Favorit / Bookmark setzen"
                >
                  <Star
                    size={12}
                    fill={node.bookmarked ? '#f59e0b' : 'none'}
                    color={node.bookmarked ? '#f59e0b' : 'currentColor'}
                  />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
