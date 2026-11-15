import { useState, type CSSProperties } from 'react';
import { Copy, Layers, Plus, Trash2 } from 'lucide-react';
import { defaultRegistry } from '../../core/defaultRegistry';
import type { LayerConfig } from '../../core/state/types';
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
}

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
}: LayerStackPanelProps) {
  const voices = defaultRegistry.listVoices();
  const [newVoiceId, setNewVoiceId] = useState<string>(
    voices[0]?.id ?? 'pulse-texture',
  );

  return (
    <aside className="dock-panel">
      <div className="panel-header">
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Layers size={14} color="#38bdf8" />
          Layer-Stack ({layers.length})
        </span>
      </div>

      <div className="panel-scroll">
        {layers.map((layer) => {
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
