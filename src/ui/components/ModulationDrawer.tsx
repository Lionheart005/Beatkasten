import { Plus, Trash2, Waves, X } from 'lucide-react';
import type { DrawnCurveData } from '../../core/math/curves';
import type { WaveformType } from '../../core/math/waves';
import type {
  LayerConfig,
  ModulationCombineMode,
  ModulationRouteConfig,
  ModulationSourceType,
} from '../../core/state/types';
import type { CycleUnit } from '../../core/theory/cycles';
import type { ActiveModTarget } from '../store/useStudioStore';

interface ModulationDrawerProps {
  target: ActiveModTarget | null;
  layer: LayerConfig | undefined;
  allLayers: readonly LayerConfig[];
  curves: readonly DrawnCurveData[];
  onClose: () => void;
  onAddRoute: (
    layerId: string,
    route: Omit<ModulationRouteConfig, 'id'>,
  ) => void;
  onUpdateRouteLive: (
    layerId: string,
    routeId: string,
    patch: Partial<ModulationRouteConfig>,
  ) => void;
  onCommitRoutePatch: (
    layerId: string,
    routeId: string,
    patch: Partial<ModulationRouteConfig>,
  ) => void;
  onDeleteRoute: (layerId: string, routeId: string) => void;
  onSelectTarget: (target: ActiveModTarget) => void;
  onHoverSource: (sourceId: string | null) => void;
}

const SOURCE_LABELS: Record<ModulationSourceType, string> = {
  'wave-lfo': 'Takt-Welle',
  'layer-pulse': 'Layer-Puls (Sidechain)',
  'macro-arc': 'Makro-Bogen',
  'drawn-curve': 'Gezeichnete Kurve',
};

const WAVE_OPTIONS: { value: WaveformType; label: string }[] = [
  { value: 'sine', label: 'Sinus (weich)' },
  { value: 'cosine', label: 'Cosinus (ab Start)' },
  { value: 'triangle', label: 'Dreieck' },
  { value: 'ramp-up', label: 'Anstieg (Ramp ↑)' },
  { value: 'ramp-down', label: 'Abfall (Ramp ↓)' },
  { value: 'soft-pulse', label: 'Weicher Puls' },
];

export function ModulationDrawer({
  target,
  layer,
  allLayers,
  curves,
  onClose,
  onAddRoute,
  onUpdateRouteLive,
  onCommitRoutePatch,
  onDeleteRoute,
  onSelectTarget,
  onHoverSource,
}: ModulationDrawerProps) {
  if (!layer) return null;

  const targetRoutes = target
    ? layer.modulations.filter(
        (m) =>
          m.targetDomain === target.targetDomain &&
          m.targetParamId === target.targetParamId &&
          (m.targetCardId === target.targetCardId ||
            (target.targetDomain === 'voice' &&
              target.targetCardId !== 'secondary-voice' &&
              target.targetCardId !== 'layer-mix' &&
              m.targetCardId === 'voice')),
      )
    : [];

  const renderSourceControls = (route: ModulationRouteConfig) => {
    return (
      <>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: 5,
            alignItems: 'center',
          }}
        >
          <select
            value={route.sourceType}
            onChange={(e) => {
              const nextType = e.target.value as ModulationSourceType;
              onCommitRoutePatch(layer.id, route.id, {
                sourceType: nextType,
                sourceConfig: {
                  ...route.sourceConfig,
                  waveform: route.sourceConfig.waveform ?? 'sine',
                  cycleValue:
                    nextType === 'drawn-curve'
                      ? undefined
                      : route.sourceConfig.cycleValue ??
                        (nextType === 'macro-arc' ? 8 : 4),
                  cycleUnit:
                    nextType === 'drawn-curve'
                      ? undefined
                      : route.sourceConfig.cycleUnit ??
                        (nextType === 'macro-arc' ? 'bars' : 'beats'),
                  sourceLayerId:
                    route.sourceConfig.sourceLayerId ??
                    allLayers[0]?.id ??
                    layer.id,
                  curveId: route.sourceConfig.curveId ?? curves[0]?.id,
                },
              });
            }}
          >
            {Object.entries(SOURCE_LABELS).map(([val, label]) => (
              <option key={val} value={val}>
                {label}
              </option>
            ))}
          </select>

          <div style={{ display: 'flex', gap: 3 }}>
            <button
              type="button"
              className={`btn-sm${route.combineMode === 'add' ? ' is-active' : ''}`}
              onClick={() =>
                onCommitRoutePatch(layer.id, route.id, { combineMode: 'add' })
              }
              title="Additiv (+)"
            >
              +
            </button>
            <button
              type="button"
              className={`btn-sm${
                route.combineMode === 'multiply' ? ' is-active' : ''
              }`}
              onClick={() =>
                onCommitRoutePatch(layer.id, route.id, {
                  combineMode: 'multiply',
                })
              }
              title="Multiplikativ (×)"
            >
              ×
            </button>
          </div>
        </div>

        {route.sourceType === 'wave-lfo' && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 56px 68px',
              gap: 5,
            }}
          >
            <select
              value={route.sourceConfig.waveform ?? 'sine'}
              onChange={(e) =>
                onCommitRoutePatch(layer.id, route.id, {
                  sourceConfig: {
                    ...route.sourceConfig,
                    waveform: e.target.value as WaveformType,
                  },
                })
              }
            >
              {WAVE_OPTIONS.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0.25}
              max={64}
              step={0.5}
              value={route.sourceConfig.cycleValue ?? 4}
              onChange={(e) =>
                onCommitRoutePatch(layer.id, route.id, {
                  sourceConfig: {
                    ...route.sourceConfig,
                    cycleValue: Math.max(0.25, Number(e.target.value) || 1),
                  },
                })
              }
            />
            <select
              value={route.sourceConfig.cycleUnit ?? 'beats'}
              onChange={(e) =>
                onCommitRoutePatch(layer.id, route.id, {
                  sourceConfig: {
                    ...route.sourceConfig,
                    cycleUnit: e.target.value as CycleUnit,
                  },
                })
              }
            >
              <option value="beats">Beats</option>
              <option value="bars">Takte</option>
            </select>
          </div>
        )}

        {route.sourceType === 'layer-pulse' && (
          <select
            value={route.sourceConfig.sourceLayerId ?? layer.id}
            onChange={(e) =>
              onCommitRoutePatch(layer.id, route.id, {
                sourceConfig: {
                  ...route.sourceConfig,
                  sourceLayerId: e.target.value,
                },
              })
            }
          >
            {allLayers.map((src) => (
              <option key={src.id} value={src.id}>
                Puls von: {src.name}
              </option>
            ))}
          </select>
        )}

        {route.sourceType === 'macro-arc' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 78px', gap: 5 }}>
            <input
              type="number"
              min={1}
              max={64}
              step={1}
              value={route.sourceConfig.cycleValue ?? 8}
              onChange={(e) =>
                onCommitRoutePatch(layer.id, route.id, {
                  sourceConfig: {
                    ...route.sourceConfig,
                    cycleValue: Math.max(1, Number(e.target.value) || 8),
                    cycleUnit: route.sourceConfig.cycleUnit ?? 'bars',
                  },
                })
              }
            />
            <select
              value={route.sourceConfig.cycleUnit ?? 'bars'}
              onChange={(e) =>
                onCommitRoutePatch(layer.id, route.id, {
                  sourceConfig: {
                    ...route.sourceConfig,
                    cycleUnit: e.target.value as CycleUnit,
                  },
                })
              }
            >
              <option value="bars">Takte</option>
              <option value="beats">Beats</option>
            </select>
          </div>
        )}

        {route.sourceType === 'drawn-curve' && (
          <select
            value={route.sourceConfig.curveId ?? ''}
            onChange={(e) =>
              onCommitRoutePatch(layer.id, route.id, {
                sourceConfig: {
                  ...route.sourceConfig,
                  curveId: e.target.value,
                  cycleValue: undefined,
                  cycleUnit: undefined,
                },
              })
            }
          >
            {curves.length === 0 && <option value="">Keine Kurve vorhanden</option>}
            {curves.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.cycleValue}{' '}
                {c.cycleUnit === 'bars' ? 'Takte' : 'Beats'})
              </option>
            ))}
          </select>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '48px 1fr 44px',
            gap: 6,
            alignItems: 'center',
          }}
        >
          <span className="muted-note">Tiefe</span>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.01}
            value={route.depth}
            onChange={(e) =>
              onUpdateRouteLive(layer.id, route.id, {
                depth: Number(e.target.value),
              })
            }
          />
          <span className="schema-value" style={{ textAlign: 'right' }}>
            {route.depth >= 0 ? '+' : ''}
            {Math.round(route.depth * 100)}%
          </span>
        </div>
      </>
    );
  };

  if (!target) {
    const directRoutes = layer.modulations.filter(
      (m) => m.targetDomain !== 'modulation',
    );
    return (
      <div className="sub-card">
        <div className="sub-card-head">
          <span className="sub-card-title">
            <Waves size={13} color={layer.color} />
            Aktive Bewegungen (~)
          </span>
          <span className="muted-note">{directRoutes.length} aktiv</span>
        </div>
        <div className="muted-note">
          Klicke links auf ein <strong>~</strong>-Symbol bei einem Regler, um
          genau diesen Klang- oder Zeit-Regler in Bewegung zu setzen.
        </div>
        {directRoutes.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {directRoutes.map((route) => {
              const isLayerMix = route.targetCardId === 'layer-mix';
              const displayLabel = isLayerMix
                ? route.targetParamId === 'level'
                  ? 'Layer-Lautstärke (Pegel)'
                  : route.targetParamId === 'pan'
                    ? 'Layer-Panorama (Pan)'
                    : route.targetParamId
                : route.targetParamId;
              const targetMin =
                isLayerMix && route.targetParamId === 'pan' ? -1 : 0;
              const targetMax =
                isLayerMix && route.targetParamId === 'level' ? 1.5 : 1;
              return (
                <div
                  key={route.id}
                  className="mod-route-card"
                  onMouseEnter={() =>
                    onHoverSource(
                      route.sourceConfig.curveId ??
                        route.sourceConfig.sourceLayerId ??
                        route.id,
                    )
                  }
                  onMouseLeave={() => onHoverSource(null)}
                >
                  <div className="sub-card-head">
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      style={{ padding: 0, fontWeight: 600 }}
                      onClick={() =>
                        onSelectTarget({
                          layerId: layer.id,
                          targetDomain: route.targetDomain as Exclude<
                            typeof route.targetDomain,
                            'modulation'
                          >,
                          targetCardId: route.targetCardId,
                          targetParamId: route.targetParamId,
                          label: displayLabel,
                          min: targetMin,
                          max: targetMax,
                        })
                      }
                    >
                      →{' '}
                      {route.targetCardId === 'secondary-voice'
                        ? 'Stimme B: '
                        : isLayerMix
                          ? 'Layer: '
                          : ''}
                      {displayLabel}
                    </button>
                    <span className="schema-value">
                      {SOURCE_LABELS[route.sourceType]} ({Math.round(route.depth * 100)}%)
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="sub-card" style={{ borderColor: layer.color }}>
      <div className="sub-card-head">
        <span className="sub-card-title">
          <Waves size={13} color={layer.color} />~ {target.label}
          {target.targetCardId === 'secondary-voice'
            ? ' (Stimme B)'
            : target.targetCardId === 'layer-mix'
              ? ' (Layer-Mix)'
              : ''}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() =>
              onAddRoute(layer.id, {
                label: `${target.label}${
                  target.targetCardId === 'secondary-voice'
                    ? ' (Stimme B)'
                    : target.targetCardId === 'layer-mix'
                      ? ' (Layer-Mix)'
                      : ''
                } Bewegung`,
                enabled: true,
                sourceType: 'wave-lfo',
                sourceConfig: {
                  waveform: 'sine',
                  cycleValue: 4,
                  cycleUnit: 'beats',
                  phaseOffset: 0,
                },
                targetDomain: target.targetDomain,
                targetCardId: target.targetCardId,
                targetParamId: target.targetParamId,
                combineMode: 'add' as ModulationCombineMode,
                depth: 0.35,
              })
            }
          >
            <Plus size={12} /> Bewegung
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={onClose}
            title="Drawer schließen"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {targetRoutes.length === 0 ? (
        <div className="muted-note">
          Noch keine Bewegung auf „{target.label}“. Klicke auf{' '}
          <strong>+ Bewegung</strong> oder weise unten eine gezeichnete Kurve
          zu.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {targetRoutes.map((route) => {
            const subRoutes = layer.modulations.filter(
              (m) =>
                m.targetDomain === 'modulation' && m.targetCardId === route.id,
            );
            return (
              <div key={route.id} className="mod-route-card">
                <div className="sub-card-head">
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      fontSize: 11.5,
                      fontWeight: 600,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={route.enabled}
                      onChange={(e) =>
                        onCommitRoutePatch(layer.id, route.id, {
                          enabled: e.target.checked,
                        })
                      }
                    />
                    <span>{SOURCE_LABELS[route.sourceType]}</span>
                  </label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() =>
                        onAddRoute(layer.id, {
                          label: 'Welle auf Welle',
                          enabled: true,
                          sourceType: 'macro-arc',
                          sourceConfig: {
                            cycleValue: 8,
                            cycleUnit: 'bars',
                          },
                          targetDomain: 'modulation',
                          targetCardId: route.id,
                          targetParamId: 'depth',
                          combineMode: 'add',
                          depth: 0.5,
                        })
                      }
                      title="Welle-auf-Welle: Steuert Tiefe oder Tempo dieser Bewegung"
                    >
                      + Welle-auf-Welle
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-danger btn-sm"
                      onClick={() => onDeleteRoute(layer.id, route.id)}
                      title="Route löschen"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {renderSourceControls(route)}

                {subRoutes.map((sub) => (
                  <div key={sub.id} className="mod-subroute-card">
                    <div className="sub-card-head">
                      <span className="muted-note" style={{ fontWeight: 600 }}>
                        Welle-auf-Welle →
                      </span>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <select
                          value={sub.targetParamId}
                          onChange={(e) =>
                            onCommitRoutePatch(layer.id, sub.id, {
                              targetParamId: e.target.value,
                            })
                          }
                        >
                          <option value="depth">Tiefe steuern</option>
                          <option value="rateMultiplier">Tempo steuern</option>
                        </select>
                        <button
                          type="button"
                          className="btn-ghost btn-danger btn-sm"
                          onClick={() => onDeleteRoute(layer.id, sub.id)}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                    {renderSourceControls(sub)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
