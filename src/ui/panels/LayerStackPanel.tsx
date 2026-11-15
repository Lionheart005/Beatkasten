import { useState, type CSSProperties } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  FolderTree,
  Layers,
  Plus,
  Trash2,
} from 'lucide-react';
import { defaultRegistry } from '../../core/defaultRegistry';
import type { LayerConfig } from '../../core/state/types';
import { buildLayerBlocks, listLayerGroups } from '../store/layerGroups';
import type { ActiveModTarget } from '../store/useStudioStore';

interface LayerStackPanelProps {
  layers: readonly LayerConfig[];
  selectedLayerId: string;
  activeModTarget: ActiveModTarget | null;
  hoveredModSourceId: string | null;
  onSelectLayer: (layerId: string) => void;
  onOpenModTarget: (target: ActiveModTarget) => void;
  onAddLayer: (voiceModuleId: string) => void;
  onDuplicateLayer: (layerId: string) => void;
  onDeleteLayer: (layerId: string) => void;
  onUpdateLayerLive: (
    layerId: string,
    updater: (layer: LayerConfig) => LayerConfig,
    label: string,
  ) => void;
  onCommitLayerImmediate: (
    layerId: string,
    updater: (layer: LayerConfig) => LayerConfig,
    label: string,
  ) => void;
  onMoveLayer: (layerId: string, direction: -1 | 1, wholeGroup?: boolean) => void;
  onSetLayerGroup: (layerId: string, group: string) => void;
  onRenameGroup: (oldName: string, newName: string) => void;
  onToggleGroupFlag: (group: string, flag: 'muted' | 'solo' | 'enabled') => void;
}

const NEW_GROUP_VALUE = '__new_group__';

export function LayerStackPanel({
  layers,
  selectedLayerId,
  activeModTarget,
  hoveredModSourceId,
  onSelectLayer,
  onOpenModTarget,
  onAddLayer,
  onDuplicateLayer,
  onDeleteLayer,
  onUpdateLayerLive,
  onCommitLayerImmediate,
  onMoveLayer,
  onSetLayerGroup,
  onRenameGroup,
  onToggleGroupFlag,
}: LayerStackPanelProps) {
  const voices = defaultRegistry.listVoices();
  const [newVoiceId, setNewVoiceId] = useState<string>(
    voices[0]?.id ?? 'pulse-texture',
  );
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const groupNames = listLayerGroups(layers);
  const blocks = buildLayerBlocks(layers);

  const toggleCollapsed = (g: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

  const handleGroupSelect = (layer: LayerConfig, value: string) => {
    if (value === NEW_GROUP_VALUE) {
      const name = window.prompt('Name der neuen Gruppe (z. B. Drums, Bass, Flächen):', '');
      if (name && name.trim()) onSetLayerGroup(layer.id, name.trim());
      return;
    }
    onSetLayerGroup(layer.id, value);
  };

  const renderLayerCard = (layer: LayerConfig) => {
    const isSelected = layer.id === selectedLayerId;
          const voiceMod = defaultRegistry.getVoice(layer.voice.moduleId);
          const cycleBadge = `${layer.cycleLength.value} ${
            layer.cycleLength.unit === 'bars'
              ? layer.cycleLength.value === 1
                ? 'Takt'
                : 'Takte'
              : layer.cycleLength.value === 1
                ? 'Beat'
                : 'Beats'
          }`;

          return (
            <div
              key={layer.id}
              className={`layer-card${isSelected ? ' is-selected' : ''}`}
              style={{ borderLeftColor: layer.color }}
              onClick={() => onSelectLayer(layer.id)}
            >
              <div className="layer-card-top">
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    minWidth: 0,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={layer.enabled}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      onCommitLayerImmediate(
                        layer.id,
                        (l) => ({ ...l, enabled: e.target.checked }),
                        `Layer ${layer.name} ${
                          e.target.checked ? 'aktiviert' : 'deaktiviert'
                        }`,
                      )
                    }
                    title="Layer ein-/ausschalten"
                  />
                  <span className="layer-name" title={layer.name}>
                    {layer.name}
                  </span>
                </div>

                <div
                  style={{ display: 'flex', gap: 3, flexShrink: 0 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className={`pill-toggle${layer.muted ? ' is-mute' : ''}`}
                    onClick={() =>
                      onCommitLayerImmediate(
                        layer.id,
                        (l) => ({ ...l, muted: !l.muted }),
                        `Mute: ${layer.name}`,
                      )
                    }
                    title="Layer stummschalten (Mute)"
                  >
                    M
                  </button>
                  <button
                    type="button"
                    className={`pill-toggle${layer.solo ? ' is-solo' : ''}`}
                    onClick={() =>
                      onCommitLayerImmediate(
                        layer.id,
                        (l) => ({ ...l, solo: !l.solo }),
                        `Solo: ${layer.name}`,
                      )
                    }
                    title="Layer einzeln abhören (Solo)"
                  >
                    S
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => onMoveLayer(layer.id, -1)}
                    title={layer.group ? 'Innerhalb der Gruppe nach oben' : 'Layer nach oben'}
                  >
                    <ArrowUp size={11} />
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => onMoveLayer(layer.id, 1)}
                    title={layer.group ? 'Innerhalb der Gruppe nach unten' : 'Layer nach unten'}
                  >
                    <ArrowDown size={11} />
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => onDuplicateLayer(layer.id)}
                    title="Layer duplizieren"
                  >
                    <Copy size={12} />
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-danger btn-sm"
                    onClick={() => onDeleteLayer(layer.id)}
                    title="Layer löschen"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>

              <div className="layer-sub">
                <span>{voiceMod?.displayName ?? layer.voice.moduleId}</span>
                <select
                  className="layer-group-select"
                  value={layer.group ?? ''}
                  title="Gruppe zuordnen"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => handleGroupSelect(layer, e.target.value)}
                >
                  <option value="">Keine Gruppe</option>
                  {groupNames.map((g) => (
                    <option key={g} value={g}>
                      Gruppe: {g}
                    </option>
                  ))}
                  <option value={NEW_GROUP_VALUE}>+ Neue Gruppe…</option>
                </select>
                <span
                  style={{
                    color: layer.color,
                    fontWeight: 600,
                  }}
                >
                  {cycleBadge}
                </span>
              </div>

              {/* Level & Pan */}
              {(() => {
                const renderMixTildeBtn = (
                  paramId: 'level' | 'pan',
                  label: string,
                  min: number,
                  max: number,
                ) => {
                  const routes = layer.modulations.filter(
                    (m) =>
                      m.enabled &&
                      m.targetDomain === 'voice' &&
                      m.targetCardId === 'layer-mix' &&
                      m.targetParamId === paramId,
                  );
                  const isOpen =
                    activeModTarget !== null &&
                    activeModTarget.layerId === layer.id &&
                    activeModTarget.targetDomain === 'voice' &&
                    activeModTarget.targetCardId === 'layer-mix' &&
                    activeModTarget.targetParamId === paramId;
                  const isGlowing =
                    hoveredModSourceId !== null &&
                    routes.some(
                      (r) =>
                        r.sourceConfig.curveId === hoveredModSourceId ||
                        r.sourceConfig.sourceLayerId === hoveredModSourceId ||
                        r.id === hoveredModSourceId,
                    );
                  return (
                    <button
                      type="button"
                      className={`mod-tilde-btn${routes.length > 0 ? ' has-routes' : ''}${
                        isOpen ? ' is-open' : ''
                      }${isGlowing ? ' is-mod-glow' : ''}`}
                      style={{ '--mod-color': layer.color } as CSSProperties}
                      title={
                        routes.length > 0
                          ? `${routes.length} aktive Bewegung(en) auf „${label}“ – klicken zum Bearbeiten`
                          : `Bewegung (~) auf „${label}“ hinzufügen`
                      }
                      onClick={() => {
                        onSelectLayer(layer.id);
                        onOpenModTarget({
                          layerId: layer.id,
                          targetDomain: 'voice',
                          targetCardId: 'layer-mix',
                          targetParamId: paramId,
                          label,
                          min,
                          max,
                        });
                      }}
                    >
                      ~{routes.length > 0 ? routes.length : ''}
                    </button>
                  );
                };

                return (
                  <>
                    <div
                      className="layer-controls-row"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="muted-note" style={{ width: 28 }}>
                        Pegel
                      </span>
                      {renderMixTildeBtn(
                        'level',
                        'Layer-Lautstärke (Pegel)',
                        0,
                        1.5,
                      )}
                      <input
                        type="range"
                        min={0}
                        max={1.2}
                        step={0.01}
                        value={layer.level}
                        style={{ '--slider-accent': layer.color } as CSSProperties}
                        onChange={(e) =>
                          onUpdateLayerLive(
                            layer.id,
                            (l) => ({ ...l, level: Number(e.target.value) }),
                            `Pegel: ${layer.name}`,
                          )
                        }
                      />
                      <span
                        className="schema-value"
                        style={{ width: 32, textAlign: 'right' }}
                      >
                        {Math.round(layer.level * 100)}
                      </span>
                    </div>

                    <div
                      className="layer-controls-row"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="muted-note" style={{ width: 28 }}>
                        Pan
                      </span>
                      {renderMixTildeBtn(
                        'pan',
                        'Layer-Panorama (Pan)',
                        -1,
                        1,
                      )}
                      <input
                        type="range"
                        min={-1}
                        max={1}
                        step={0.01}
                        value={layer.pan}
                        style={{ '--slider-accent': layer.color } as CSSProperties}
                        onChange={(e) =>
                          onUpdateLayerLive(
                            layer.id,
                            (l) => ({ ...l, pan: Number(e.target.value) }),
                            `Panorama: ${layer.name}`,
                          )
                        }
                        onDoubleClick={() =>
                          onCommitLayerImmediate(
                            layer.id,
                            (l) => ({ ...l, pan: 0 }),
                            `Pan zentriert: ${layer.name}`,
                          )
                        }
                      />
                      <span
                        className="schema-value"
                        style={{ width: 32, textAlign: 'right' }}
                      >
                        {Math.abs(layer.pan) < 0.03
                          ? 'C'
                          : layer.pan < 0
                            ? `L${Math.round(Math.abs(layer.pan) * 100)}`
                            : `R${Math.round(layer.pan * 100)}`}
                      </span>
                    </div>
                  </>
                );
              })()}
            </div>
          );
  };

  return (
    <aside className="dock-panel">
      <div className="panel-header">
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Layers size={14} color="#38bdf8" />
          Layer-Stack ({layers.length})
        </span>
      </div>

      <div className="panel-scroll">
        {blocks.map((block) => {
          if (block.kind === 'single') return renderLayerCard(block.layers[0]!);
          const g = block.group!;
          const collapsed = collapsedGroups.has(g);
          const allMuted = block.layers.every((l) => l.muted);
          const allSolo = block.layers.every((l) => l.solo);
          const anySelected = block.layers.some((l) => l.id === selectedLayerId);
          return (
            <div key={`group:${g}`} className={`layer-group${anySelected ? ' has-selected' : ''}`}>
              <div className="layer-group-head">
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => toggleCollapsed(g)}
                  title={collapsed ? 'Gruppe aufklappen' : 'Gruppe einklappen'}
                >
                  {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                </button>
                <FolderTree size={12} color="var(--text-muted)" />
                {renamingGroup === g ? (
                  <input
                    type="text"
                    autoFocus
                    value={renameValue}
                    style={{ flex: 1, minWidth: 0 }}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => {
                      onRenameGroup(g, renameValue);
                      setRenamingGroup(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setRenamingGroup(null);
                    }}
                  />
                ) : (
                  <span
                    className="layer-group-name"
                    title="Doppelklick zum Umbenennen"
                    onDoubleClick={() => {
                      setRenamingGroup(g);
                      setRenameValue(g);
                    }}
                  >
                    {g} <span className="muted-note">({block.layers.length})</span>
                  </span>
                )}
                <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    title="Ganze Gruppe nach oben"
                    onClick={() => onMoveLayer(block.layers[0]!.id, -1, true)}
                  >
                    <ArrowUp size={11} />
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    title="Ganze Gruppe nach unten"
                    onClick={() => onMoveLayer(block.layers[0]!.id, 1, true)}
                  >
                    <ArrowDown size={11} />
                  </button>
                  <button
                    type="button"
                    className={`pill-toggle${allMuted ? ' is-mute' : ''}`}
                    title="Ganze Gruppe stummschalten"
                    onClick={() => onToggleGroupFlag(g, 'muted')}
                  >
                    M
                  </button>
                  <button
                    type="button"
                    className={`pill-toggle${allSolo ? ' is-solo' : ''}`}
                    title="Ganze Gruppe solo"
                    onClick={() => onToggleGroupFlag(g, 'solo')}
                  >
                    S
                  </button>
                </div>
              </div>
              {!collapsed && (
                <div className="layer-group-body">
                  {block.layers.map((l) => renderLayerCard(l))}
                </div>
              )}
            </div>
          );
        })}

        {/* Add New Layer */}
        <div className="sub-card" style={{ marginTop: 4 }}>
          <span className="muted-note" style={{ fontWeight: 600 }}>
            + Neuen Layer hinzufügen
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <select
              value={newVoiceId}
              onChange={(e) => setNewVoiceId(e.target.value)}
              style={{ flex: 1 }}
            >
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.displayName}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-primary"
              onClick={() => onAddLayer(newVoiceId)}
            >
              <Plus size={13} /> Layer
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
