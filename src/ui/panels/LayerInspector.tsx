import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Plus,
  Power,
  Trash2,
} from 'lucide-react';
import { defaultRegistry } from '../../core/defaultRegistry';
import type { DrawnCurveData } from '../../core/math/curves';
import type {
  LayerConfig,
  ModulationRouteConfig,
  OperatorConfig,
  ProcessorCardConfig,
} from '../../core/state/types';
import type { CycleUnit } from '../../core/theory/cycles';
import { CurveDrawCanvas } from '../components/CurveDrawCanvas';
import { ModulationDrawer } from '../components/ModulationDrawer';
import { SchemaControl } from '../components/SchemaControl';
import { TimePreviewCanvas } from '../components/TimePreviewCanvas';
import type { ActiveModTarget } from '../store/useStudioStore';

interface LayerInspectorProps {
  layer: LayerConfig | undefined;
  allLayers: readonly LayerConfig[];
  curves: readonly DrawnCurveData[];
  beatsPerBar: number;
  currentLayerPhase: number;
  selectedCurveId: string;
  activeModTarget: ActiveModTarget | null;
  hoveredModSourceId: string | null;
  onSelectCurve: (curveId: string) => void;
  onSetActiveModTarget: (target: ActiveModTarget | null) => void;
  onHoverModSource: (sourceId: string | null) => void;
  onSwitchVoice: (layerId: string, voiceModuleId: string) => void;
  onSetLayerCycle: (layerId: string, value: number, unit: CycleUnit) => void;
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
  onReorderProcessorCards: (
    layerId: string,
    fromIndex: number,
    toIndex: number,
  ) => void;
  onAddProcessorCard: (layerId: string, moduleId: string) => void;
  onRemoveProcessorCard: (layerId: string, cardId: string) => void;
  onToggleProcessorBypass: (layerId: string, cardId: string) => void;
  onAddModulationRoute: (
    layerId: string,
    route: Omit<ModulationRouteConfig, 'id'>,
  ) => void;
  onUpdateModulationRouteLive: (
    layerId: string,
    routeId: string,
    patch: Partial<ModulationRouteConfig>,
  ) => void;
  onCommitModulationRoutePatch: (
    layerId: string,
    routeId: string,
    patch: Partial<ModulationRouteConfig>,
  ) => void;
  onDeleteModulationRoute: (layerId: string, routeId: string) => void;
  onUpsertCurveLive: (curve: DrawnCurveData) => void;
  onCreateCurve: (preset?: DrawnCurveData) => DrawnCurveData;
}

const POLY_CYCLE_PRESETS: ReadonlyArray<{
  label: string;
  value: number;
  unit: CycleUnit;
}> = [
  { label: '1 Takt', value: 1, unit: 'bars' },
  { label: '3 Beats', value: 3, unit: 'beats' },
  { label: '5 Beats', value: 5, unit: 'beats' },
  { label: '7 Beats', value: 7, unit: 'beats' },
  { label: '4 Takte', value: 4, unit: 'bars' },
  { label: '8 Takte', value: 8, unit: 'bars' },
];

type RhythmPresetId = 'four-on-floor' | 'offbeat-pump' | 'triplet-gallop' | 'riddle-3-5';

const RHYTHM_PRESETS: ReadonlyArray<{
  id: RhythmPresetId;
  label: string;
  description: string;
}> = [
  {
    id: 'four-on-floor',
    label: 'Four-on-the-Floor',
    description: 'Gerader 4/4 Grundpuls auf jedem Schlag',
  },
  {
    id: 'offbeat-pump',
    label: 'Offbeat-Pump',
    description: 'Zieht die Betonung auf die treibenden Offbeats',
  },
  {
    id: 'triplet-gallop',
    label: 'Triolen-Galopp',
    description: 'Rollender 3er-Triolen-Rhythmus mit leichtem Swing',
  },
  {
    id: 'riddle-3-5',
    label: '3-gegen-5 Rätsel',
    description: 'Polymetrische Überlagerung aus 5er- und 3er-Welle',
  },
];

function applyRhythmPreset(
  ops: readonly OperatorConfig[],
  presetId: RhythmPresetId,
): OperatorConfig[] {
  return ops.map((op) => {
    if (op.moduleId === 'time-warp') {
      return {
        ...op,
        bypassed: false,
        params: {
          warpAmount: presetId === 'triplet-gallop' ? 0.18 : 0,
        },
      };
    }
    if (op.moduleId === 'time-grid-gravity') {
      if (presetId === 'four-on-floor') {
        return {
          ...op,
          bypassed: false,
          params: { subdivisions: 4, phaseShift: 0, gravity: 0.9 },
        };
      }
      if (presetId === 'offbeat-pump') {
        return {
          ...op,
          bypassed: false,
          params: { subdivisions: 4, phaseShift: 0.5, gravity: 0.85 },
        };
      }
      if (presetId === 'triplet-gallop') {
        return {
          ...op,
          bypassed: false,
          params: { subdivisions: 6, phaseShift: 0.15, gravity: 0.72 },
        };
      }
      return {
        ...op,
        bypassed: false,
        params: { subdivisions: 5, phaseShift: 0, gravity: 0.45 },
      };
    }
    if (op.moduleId === 'time-pulse-interference') {
      if (presetId === 'four-on-floor') {
        return {
          ...op,
          bypassed: false,
          params: {
            freqA: 4,
            freqB: 1,
            interferenceMix: 0.2,
            phaseOffset: 0,
            threshold: 0.52,
          },
        };
      }
      if (presetId === 'offbeat-pump') {
        return {
          ...op,
          bypassed: false,
          params: {
            freqA: 4,
            freqB: 8,
            interferenceMix: 0.38,
            phaseOffset: 0.5,
            threshold: 0.44,
          },
        };
      }
      if (presetId === 'triplet-gallop') {
        return {
          ...op,
          bypassed: false,
          params: {
            freqA: 6,
            freqB: 3,
            interferenceMix: 0.52,
            phaseOffset: 0.16,
            threshold: 0.4,
          },
        };
      }
      return {
        ...op,
        bypassed: false,
        params: {
          freqA: 5,
          freqB: 3,
          interferenceMix: 0.6,
          phaseOffset: 0.2,
          threshold: 0.42,
        },
      };
    }
    return op;
  });
}

export function LayerInspector({
  layer,
  allLayers,
  curves,
  beatsPerBar,
  currentLayerPhase,
  selectedCurveId,
  activeModTarget,
  hoveredModSourceId,
  onSelectCurve,
  onSetActiveModTarget,
  onHoverModSource,
  onSwitchVoice,
  onSetLayerCycle,
  onUpdateLayerLive,
  onCommitLayerImmediate,
  onReorderProcessorCards,
  onAddProcessorCard,
  onRemoveProcessorCard,
  onToggleProcessorBypass,
  onAddModulationRoute,
  onUpdateModulationRouteLive,
  onCommitModulationRoutePatch,
  onDeleteModulationRoute,
  onUpsertCurveLive,
  onCreateCurve,
}: LayerInspectorProps) {
  const processors = defaultRegistry.listProcessors();
  const voices = defaultRegistry.listVoices();
  const [addCardModuleId, setAddCardModuleId] = useState<string>(
    processors[0]?.id ?? 'card-tone-filter',
  );
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  if (!layer) {
    return (
      <section className="inspector-shell">
        <div className="panel-scroll">Kein Layer ausgewählt.</div>
      </section>
    );
  }

  const voiceModule = defaultRegistry.getVoice(layer.voice.moduleId);

  const updateTimeOpParam = (opId: string, paramId: string, val: number) => {
    onUpdateLayerLive(
      layer.id,
      (l) => ({
        ...l,
        timeOperators: l.timeOperators.map((op) =>
          op.id === opId
            ? { ...op, params: { ...op.params, [paramId]: val } }
            : op,
        ),
      }),
      `Zeit-Parameter: ${paramId}`,
    );
  };

  const toggleTimeOpBypass = (opId: string) => {
    onCommitLayerImmediate(
      layer.id,
      (l) => ({
        ...l,
        timeOperators: l.timeOperators.map((op) =>
          op.id === opId ? { ...op, bypassed: !op.bypassed } : op,
        ),
      }),
      'Zeit-Operator Bypass umgeschaltet',
    );
  };

  const updateVoiceParam = (paramId: string, val: number) => {
    onUpdateLayerLive(
      layer.id,
      (l) => ({
        ...l,
        voice: {
          ...l.voice,
          params: { ...l.voice.params, [paramId]: val },
        },
      }),
      `Klang-Parameter: ${paramId}`,
    );
  };

  const updateCardParam = (
    card: ProcessorCardConfig,
    paramId: string,
    val: number,
  ) => {
    onUpdateLayerLive(
      layer.id,
      (l) => ({
        ...l,
        processorChain: l.processorChain.map((c) =>
          c.id === card.id
            ? { ...c, params: { ...c.params, [paramId]: val } }
            : c,
        ),
      }),
      `Klangkarte: ${paramId}`,
    );
  };

  return (
    <section className="inspector-shell">
      {/* Layer Header */}
      <div
        className="inspector-header"
        style={{ borderTop: `3px solid ${layer.color}` }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: layer.color,
            }}
          />
          <input
            type="text"
            value={layer.name}
            onChange={(e) =>
              onUpdateLayerLive(
                layer.id,
                (l) => ({ ...l, name: e.target.value }),
                `Layer umbenannt`,
              )
            }
            style={{ fontWeight: 600, minWidth: 150 }}
            title="Layer-Name bearbeiten"
          />

          <div className="field-chip" title="Klangerzeuger (Voice) wählen">
            <label>Klang-Voice</label>
            <select
              value={layer.voice.moduleId}
              onChange={(e) => onSwitchVoice(layer.id, e.target.value)}
            >
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.displayName}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Cycle Length & 1-Click Polyrhythm Presets */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <div className="field-chip" title="Umlaufdauer dieses Layers">
            <label>Zyklus</label>
            <input
              type="number"
              min={0.5}
              max={64}
              step={0.5}
              value={layer.cycleLength.value}
              style={{ width: 54 }}
              onChange={(e) =>
                onSetLayerCycle(
                  layer.id,
                  Math.max(0.5, Number(e.target.value) || 1),
                  layer.cycleLength.unit,
                )
              }
            />
            <select
              value={layer.cycleLength.unit}
              onChange={(e) =>
                onSetLayerCycle(
                  layer.id,
                  layer.cycleLength.value,
                  e.target.value as CycleUnit,
                )
              }
            >
              <option value="beats">Beats</option>
              <option value="bars">Takte</option>
            </select>
          </div>

          <div className="preset-chips">
            {POLY_CYCLE_PRESETS.map((preset) => {
              const isMatch =
                layer.cycleLength.value === preset.value &&
                layer.cycleLength.unit === preset.unit;
              return (
                <button
                  key={preset.label}
                  type="button"
                  className={`preset-chip${isMatch ? ' is-active' : ''}`}
                  onClick={() =>
                    onSetLayerCycle(layer.id, preset.value, preset.unit)
                  }
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 3 Columns */}
      <div className="inspector-columns">
        {/* Säule 1: Zeit & Rhythmus (WANN) */}
        <div className="inspector-col">
          <div className="inspector-col-head">
            <div>
              <div className="col-kicker">Säule 1 · WANN</div>
              <div className="col-title">Zeit & Rhythmus</div>
            </div>
          </div>
          <div className="inspector-col-body">
            <div className="preset-chips">
              {RHYTHM_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="preset-chip"
                  title={preset.description}
                  onClick={() =>
                    onCommitLayerImmediate(
                      layer.id,
                      (l) => ({
                        ...l,
                        timeOperators: applyRhythmPreset(
                          l.timeOperators,
                          preset.id,
                        ),
                      }),
                      `Rhythmus-Preset: ${preset.label}`,
                    )
                  }
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <TimePreviewCanvas
              layer={layer}
              beatsPerBar={beatsPerBar}
              currentPhase={currentLayerPhase}
            />

            {layer.timeOperators.map((op) => {
              const mod = defaultRegistry.getTimeOperator(op.moduleId);
              if (!mod) return null;
              return (
                <div
                  key={op.id}
                  className={`sub-card${op.bypassed ? ' is-bypassed' : ''}`}
                >
                  <div className="sub-card-head">
                    <span className="sub-card-title" title={mod.description}>
                      {mod.displayName}
                    </span>
                    <button
                      type="button"
                      className={`btn-sm${!op.bypassed ? ' is-active' : ''}`}
                      onClick={() => toggleTimeOpBypass(op.id)}
                      title={
                        op.bypassed
                          ? 'Zeit-Operator aktivieren'
                          : 'Zeit-Operator umgehen (Bypass)'
                      }
                    >
                      <Power size={11} />
                      {op.bypassed ? 'Aus' : 'An'}
                    </button>
                  </div>
                  {mod.parameters.map((schema) => (
                    <SchemaControl
                      key={schema.id}
                      schema={schema}
                      value={op.params[schema.id] ?? schema.defaultValue}
                      layer={layer}
                      targetDomain="time"
                      targetCardId={op.id}
                      activeModTarget={activeModTarget}
                      hoveredModSourceId={hoveredModSourceId}
                      accentColor={layer.color}
                      onChange={(val) =>
                        updateTimeOpParam(op.id, schema.id, val)
                      }
                      onOpenModTarget={onSetActiveModTarget}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {/* Säule 2: Klang & Drag-&-Drop Kartenkette (WIE ES KLINGT) */}
        <div className="inspector-col">
          <div className="inspector-col-head">
            <div>
              <div className="col-kicker">Säule 2 · WIE ES KLINGT</div>
              <div className="col-title">Voice & Kartenkette</div>
            </div>
          </div>
          <div className="inspector-col-body">
            {voiceModule && (
              <div className="sub-card">
                <div className="sub-card-head">
                  <span
                    className="sub-card-title"
                    title={voiceModule.description}
                  >
                    Voice: {voiceModule.displayName}
                  </span>
                </div>
                {voiceModule.parameters.map((schema) => (
                  <SchemaControl
                    key={schema.id}
                    schema={schema}
                    value={layer.voice.params[schema.id] ?? schema.defaultValue}
                    layer={layer}
                    targetDomain="voice"
                    targetCardId="voice"
                    activeModTarget={activeModTarget}
                    hoveredModSourceId={hoveredModSourceId}
                    accentColor={layer.color}
                    onChange={(val) => updateVoiceParam(schema.id, val)}
                    onOpenModTarget={onSetActiveModTarget}
                  />
                ))}
              </div>
            )}

            <div className="muted-note" style={{ fontWeight: 600 }}>
              Klang- & Effekt-Kette (Ziehen oder Pfeile zum Umsortieren):
            </div>

            {layer.processorChain.map((card, idx) => {
              const mod = defaultRegistry.getProcessor(card.moduleId);
              if (!mod) return null;
              return (
                <div
                  key={card.id}
                  draggable
                  onDragStart={(e) => {
                    setDragIndex(idx);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', String(idx));
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragOverIndex !== idx) setDragOverIndex(idx);
                  }}
                  onDragLeave={() => {
                    if (dragOverIndex === idx) setDragOverIndex(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from =
                      dragIndex ??
                      Number(e.dataTransfer.getData('text/plain'));
                    setDragIndex(null);
                    setDragOverIndex(null);
                    if (Number.isInteger(from) && from !== idx) {
                      onReorderProcessorCards(layer.id, from, idx);
                    }
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setDragOverIndex(null);
                  }}
                  className={`sub-card${card.bypassed ? ' is-bypassed' : ''}${
                    dragIndex === idx ? ' is-dragging' : ''
                  }${dragOverIndex === idx && dragIndex !== idx ? ' is-drag-over' : ''}`}
                >
                  <div className="sub-card-head">
                    <span className="sub-card-title" title={mod.description}>
                      <span className="drag-handle" title="Ziehen zum Sortieren">
                        <GripVertical size={13} />
                      </span>
                      {mod.displayName}
                    </span>
                    <div style={{ display: 'flex', gap: 3 }}>
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={idx === 0}
                        onClick={() =>
                          onReorderProcessorCards(layer.id, idx, idx - 1)
                        }
                        title="Karte nach oben verschieben"
                      >
                        <ArrowUp size={11} />
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={idx === layer.processorChain.length - 1}
                        onClick={() =>
                          onReorderProcessorCards(layer.id, idx, idx + 1)
                        }
                        title="Karte nach unten verschieben"
                      >
                        <ArrowDown size={11} />
                      </button>
                      <button
                        type="button"
                        className={`btn-sm${!card.bypassed ? ' is-active' : ''}`}
                        onClick={() =>
                          onToggleProcessorBypass(layer.id, card.id)
                        }
                        title="Karte aktivieren / umgehen"
                      >
                        <Power size={11} />
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-danger btn-sm"
                        onClick={() => onRemoveProcessorCard(layer.id, card.id)}
                        title="Karte entfernen"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>

                  {mod.parameters.map((schema) => (
                    <SchemaControl
                      key={schema.id}
                      schema={schema}
                      value={card.params[schema.id] ?? schema.defaultValue}
                      layer={layer}
                      targetDomain="processor"
                      targetCardId={card.id}
                      activeModTarget={activeModTarget}
                      hoveredModSourceId={hoveredModSourceId}
                      accentColor={layer.color}
                      onChange={(val) =>
                        updateCardParam(card, schema.id, val)
                      }
                      onOpenModTarget={onSetActiveModTarget}
                    />
                  ))}
                </div>
              );
            })}

            {/* Add Processor Card */}
            <div className="sub-card">
              <div style={{ display: 'flex', gap: 6 }}>
                <select
                  value={addCardModuleId}
                  onChange={(e) => setAddCardModuleId(e.target.value)}
                  style={{ flex: 1 }}
                >
                  {processors.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  onClick={() => onAddProcessorCard(layer.id, addCardModuleId)}
                >
                  <Plus size={12} /> Karte
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Säule 3: Zeit bewegt Klang (~ Bewegungs-Anker & Kurven-Zeichner) */}
        <div className="inspector-col">
          <div className="inspector-col-head">
            <div>
              <div className="col-kicker">Säule 3 · BEWEGUNG (~)</div>
              <div className="col-title">Zeit bewegt Klang</div>
            </div>
          </div>
          <div className="inspector-col-body">
            <ModulationDrawer
              target={activeModTarget}
              layer={layer}
              allLayers={allLayers}
              curves={curves}
              onClose={() => onSetActiveModTarget(null)}
              onAddRoute={onAddModulationRoute}
              onUpdateRouteLive={onUpdateModulationRouteLive}
              onCommitRoutePatch={onCommitModulationRoutePatch}
              onDeleteRoute={onDeleteModulationRoute}
              onSelectTarget={onSetActiveModTarget}
              onHoverSource={onHoverModSource}
            />

            <CurveDrawCanvas
              curves={curves}
              selectedCurveId={selectedCurveId}
              selectedLayer={layer}
              activeModTarget={activeModTarget}
              onSelectCurve={onSelectCurve}
              onUpsertCurve={onUpsertCurveLive}
              onCreateCurve={onCreateCurve}
              onAssignRoute={onAddModulationRoute}
              onHoverSource={onHoverModSource}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
