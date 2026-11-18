import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { loadLayoutPref, saveLayoutPref, Splitter } from '../components/Splitter';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Plus,
  Power,
  Trash2,
} from 'lucide-react';
import { defaultRegistry } from '../../core/defaultRegistry';
import { insertTimeOperator, OPTIONAL_TIME_OPERATORS } from '../../core/state/presets';
import { gridParamsFromCells } from '../../core/time/operators';
import type { DrawnCurveData } from '../../core/math/curves';
import {
  buildDefaultParams,
  PARAM_GROUP_LABELS,
  PARAM_GROUP_ORDER,
  type ParameterSchema,
} from '../../core/registry/types';
import { NOTE_NAMES } from '../../core/theory/scales';
import { cycleToBeats } from '../../core/theory/cycles';
import { GRID_TEMPLATES, StepGridEditor } from '../components/StepGridEditor';
import type {
  LayerConfig,
  ModulationRouteConfig,
  ProcessorCardConfig,
  SecondaryVoiceConfig,
} from '../../core/state/types';
import type { CycleUnit } from '../../core/theory/cycles';
import { CurveDrawCanvas } from '../components/CurveDrawCanvas';
import { ModulationDrawer } from '../components/ModulationDrawer';
import { SchemaControl } from '../components/SchemaControl';
import type { ActiveModTarget } from '../store/useStudioStore';

interface GroupedControlsProps {
  readonly schemas: readonly ParameterSchema[];
  readonly values: Record<string, number>;
  readonly layer: LayerConfig;
  readonly targetCardId: 'voice' | 'secondary-voice';
  readonly activeModTarget: ActiveModTarget | null;
  readonly hoveredModSourceId: string | null;
  readonly onChange: (paramId: string, val: number) => void;
  readonly onOpenModTarget: (target: ActiveModTarget | null) => void;
  /** Zusätzlicher Inhalt oben in der Gruppe „Tonhöhe“ (z. B. Ton-Quelle). */
  readonly pitchExtra?: React.ReactNode;
}

/** Klang-Regler nach Funktions-Gruppen (einheitliche Reihenfolge, einklappbar). */
function GroupedSchemaControls({
  schemas,
  values,
  layer,
  targetCardId,
  activeModTarget,
  hoveredModSourceId,
  onChange,
  onOpenModTarget,
  pitchExtra,
}: GroupedControlsProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const v = loadLayoutPref<Record<string, boolean>>('paramGroupsCollapsed', {});
    return v && typeof v === 'object' ? v : {};
  });
  const toggle = (g: string) => {
    const next = { ...collapsed, [g]: !collapsed[g] };
    setCollapsed(next);
    saveLayoutPref('paramGroupsCollapsed', next);
  };
  const groups = PARAM_GROUP_ORDER.map((g) => ({
    g,
    items: schemas.filter((p) => !p.hidden && (p.group ?? 'tone') === g),
  })).filter((x) => x.items.length > 0 || (x.g === 'pitch' && pitchExtra));
  return (
    <>
      {groups.map(({ g, items }) => (
        <div key={g} className="param-group">
          <button
            type="button"
            className="param-group-head"
            onClick={() => toggle(g)}
            aria-expanded={!collapsed[g]}
            title={collapsed[g] ? 'Gruppe aufklappen' : 'Gruppe einklappen'}
          >
            {collapsed[g] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            {PARAM_GROUP_LABELS[g]}
            <span className="param-group-count">{items.length + (g === 'pitch' && pitchExtra ? 1 : 0)}</span>
          </button>
          {!collapsed[g] && (
            <div className="param-group-body">
              {g === 'pitch' && pitchExtra}
              {items.map((schema) => (
                <SchemaControl
                  key={schema.id}
                  schema={schema}
                  value={values[schema.id] ?? schema.defaultValue}
                  layer={layer}
                  targetDomain="voice"
                  targetCardId={targetCardId}
                  activeModTarget={activeModTarget}
                  hoveredModSourceId={hoveredModSourceId}
                  accentColor={layer.color}
                  onChange={(val) => onChange(schema.id, val)}
                  onOpenModTarget={onOpenModTarget}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

/** Ton-Quelle des Layers: folgt den Akkorden oder spielt einen festen Einzelton. */
function PitchSourceControl({
  layer,
  onCommit,
}: {
  readonly layer: LayerConfig;
  readonly onCommit: (pitch: NonNullable<LayerConfig['pitch']>, label: string) => void;
}) {
  const pitch = layer.pitch ?? { mode: 'harmony' as const, note: 9, octave: 0 };
  const fixed = pitch.mode === 'fixed';
  return (
    <div className="pitch-source">
      <div className="pitch-source-row">
        <span className="schema-label">Ton-Quelle</span>
        <div className="segmented">
          <button
            type="button"
            className={!fixed ? 'is-active' : undefined}
            onClick={() => onCommit({ ...pitch, mode: 'harmony' }, 'Ton-Quelle: folgt Akkorden')}
            title="Der Layer spielt die Töne der Akkordfolge (Standard)"
          >
            Folgt Akkorden
          </button>
          <button
            type="button"
            className={fixed ? 'is-active' : undefined}
            onClick={() => onCommit({ ...pitch, mode: 'fixed' }, 'Ton-Quelle: fester Ton')}
            title="Vom Akkord abkoppeln und immer denselben Ton spielen"
          >
            Fester Ton
          </button>
        </div>
      </div>
      {fixed && (
        <div className="pitch-source-row">
          <select
            value={((Math.round(pitch.note) % 12) + 12) % 12}
            onChange={(e) =>
              onCommit({ ...pitch, note: Number(e.target.value) }, `Fester Ton: ${NOTE_NAMES[Number(e.target.value)]}`)
            }
            title="Welcher Ton gespielt wird"
          >
            {NOTE_NAMES.map((n, i) => (
              <option key={n} value={i}>
                {n}
              </option>
            ))}
          </select>
          <select
            value={Math.round(pitch.octave)}
            onChange={(e) => onCommit({ ...pitch, octave: Number(e.target.value) }, 'Fester Ton: Oktave')}
            title="Oktave relativ zur normalen Lage des Instruments"
          >
            {[-2, -1, 0, 1, 2].map((o) => (
              <option key={o} value={o}>
                {o === 0 ? 'Normale Oktave' : `${o > 0 ? '+' : ''}${o} Oktave${Math.abs(o) > 1 ? 'n' : ''}`}
              </option>
            ))}
          </select>
          <span className="muted-note">Akkordwechsel werden ignoriert · gilt für Stimme A & B</span>
        </div>
      )}
    </div>
  );
}

interface LayerInspectorProps {
  layer: LayerConfig | undefined;
  allLayers: readonly LayerConfig[];
  curves: readonly DrawnCurveData[];
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

export function LayerInspector({
  layer,
  allLayers,
  curves,
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
  // Breiten der drei Säulen (Anteile), per Maus veränderbar & gespeichert.
  const [colFr, setColFr] = useState<number[]>(() => {
    const v = loadLayoutPref<number[]>('inspectorCols', [1, 1, 1]);
    return Array.isArray(v) && v.length === 3 && v.every((x) => Number.isFinite(x) && x > 0) ? v : [1, 1, 1];
  });
  const colsRef = useRef<HTMLDivElement | null>(null);
  const dragStartFr = useRef<number[]>(colFr);
  const startColDrag = useCallback(() => {
    dragStartFr.current = colFr;
  }, [colFr]);
  const dragCol = useCallback((idx: number, deltaPx: number) => {
    const el = colsRef.current;
    const start = dragStartFr.current;
    if (!el) return;
    const usable = Math.max(200, el.clientWidth - 40);
    const sum = start.reduce((a, b) => a + b, 0);
    const deltaFr = (deltaPx / usable) * sum;
    const minFr = sum * 0.12;
    const pairSum = start[idx]! + start[idx + 1]!;
    const a = Math.min(pairSum - minFr, Math.max(minFr, start[idx]! + deltaFr));
    const next = [...start];
    next[idx] = a;
    next[idx + 1] = pairSum - a;
    setColFr(next);
    saveLayoutPref('inspectorCols', next);
  }, []);
  const resetCols = useCallback(() => {
    setColFr([1, 1, 1]);
    saveLayoutPref('inspectorCols', [1, 1, 1]);
  }, []);

  const processors = defaultRegistry.listProcessors();
  const voices = defaultRegistry.listVoices();
  const [addCardModuleId, setAddCardModuleId] = useState<string>(
    processors[0]?.id ?? 'card-tone-filter',
  );
  const secEnabled = Boolean(layer?.secondaryVoice?.enabled);
  const [secExpanded, setSecExpanded] = useState<boolean>(secEnabled);

  useEffect(() => {
    setSecExpanded(secEnabled);
  }, [layer?.id, secEnabled]);

  if (!layer) {
    return (
      <section className="inspector-shell">
        <div className="panel-scroll">Kein Layer ausgewählt.</div>
      </section>
    );
  }

  const voiceModule = defaultRegistry.getVoice(layer.voice.moduleId);

  const pickDefaultSecondaryVoiceId = (primaryVoiceId: string): string => {
    const preferred = primaryVoiceId === 'modal-bell' ? 'pipe-organ' : 'modal-bell';
    if (defaultRegistry.getVoice(preferred)) return preferred;
    return (
      voices.find((v) => v.id !== primaryVoiceId)?.id ??
      voices[0]?.id ??
      preferred
    );
  };

  const createInitialSecondaryVoice = (
    primaryVoiceId: string,
    enabled: boolean,
  ): SecondaryVoiceConfig => {
    const moduleId = pickDefaultSecondaryVoiceId(primaryVoiceId);
    const mod = defaultRegistry.getVoice(moduleId);
    return {
      enabled,
      moduleId,
      version: mod?.version ?? 1,
      mix: 0.35,
      params: mod ? buildDefaultParams(mod) : {},
    };
  };

  const activeSecModuleId =
    layer.secondaryVoice?.moduleId ??
    pickDefaultSecondaryVoiceId(layer.voice.moduleId);
  const secondaryVoiceMod = defaultRegistry.getVoice(activeSecModuleId);
  const secondaryMix = layer.secondaryVoice?.mix ?? 0.35;
  const secondaryParams = layer.secondaryVoice?.params ?? {};

  const toggleSecondaryVoice = () => {
    const nextEnabled = !secEnabled;
    onCommitLayerImmediate(
      layer.id,
      (l) => {
        const base =
          l.secondaryVoice ??
          createInitialSecondaryVoice(l.voice.moduleId, nextEnabled);
        return {
          ...l,
          secondaryVoice: { ...base, enabled: nextEnabled },
        };
      },
      nextEnabled ? 'Stimme B aktiviert' : 'Stimme B deaktiviert',
    );
    setSecExpanded(nextEnabled);
  };

  const switchSecondaryVoice = (nextModuleId: string) => {
    const mod = defaultRegistry.getVoice(nextModuleId);
    if (!mod) return;
    onCommitLayerImmediate(
      layer.id,
      (l) => ({
        ...l,
        secondaryVoice: {
          enabled: l.secondaryVoice?.enabled ?? true,
          moduleId: mod.id,
          version: mod.version,
          mix: l.secondaryVoice?.mix ?? 0.35,
          params: buildDefaultParams(mod),
        },
      }),
      `Stimme B gewechselt: ${mod.displayName}`,
    );
    if (
      activeModTarget &&
      activeModTarget.layerId === layer.id &&
      activeModTarget.targetCardId === 'secondary-voice' &&
      !mod.parameters.some((p) => p.id === activeModTarget.targetParamId)
    ) {
      onSetActiveModTarget(null);
    }
  };

  const updateSecondaryMix = (mix: number) => {
    onUpdateLayerLive(
      layer.id,
      (l) => {
        const base =
          l.secondaryVoice ??
          createInitialSecondaryVoice(l.voice.moduleId, false);
        return {
          ...l,
          secondaryVoice: { ...base, mix },
        };
      },
      'Anteil Stimme B',
    );
  };

  const updateSecondaryVoiceParam = (paramId: string, val: number) => {
    onUpdateLayerLive(
      layer.id,
      (l) => {
        const base =
          l.secondaryVoice ??
          createInitialSecondaryVoice(l.voice.moduleId, false);
        return {
          ...l,
          secondaryVoice: {
            ...base,
            params: { ...base.params, [paramId]: val },
          },
        };
      },
      `Stimme B Parameter: ${paramId}`,
    );
  };

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

  const commitTimeOpParams = (opId: string, patch: Record<string, number>, label: string) => {
    onCommitLayerImmediate(
      layer.id,
      (l) => ({
        ...l,
        timeOperators: l.timeOperators.map((op) =>
          op.id === opId ? { ...op, params: { ...op.params, ...patch } } : op,
        ),
      }),
      label,
    );
  };

  const removeTimeOp = (opId: string, label: string) => {
    onCommitLayerImmediate(
      layer.id,
      (l) => ({
        ...l,
        timeOperators: l.timeOperators.filter((op) => op.id !== opId),
        modulations: l.modulations.filter(
          (m) => !(m.targetDomain === 'time' && m.targetCardId === opId),
        ),
      }),
      `${label} entfernt`,
    );
  };

  const commitPitch = (pitch: NonNullable<LayerConfig['pitch']>, label: string) => {
    onCommitLayerImmediate(layer.id, (l) => ({ ...l, pitch }), label);
  };

  const gridOp = layer.timeOperators.find((op) => op.moduleId === 'time-step-grid');
  const gridMod = defaultRegistry.getTimeOperator('time-step-grid');
  const grooveOps = layer.timeOperators.filter((op) => op.moduleId !== 'time-step-grid');
  const layerCycleBeats = cycleToBeats(layer.cycleLength.value, layer.cycleLength.unit, 4);

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
      <div
        className="inspector-columns is-resizable"
        ref={colsRef}
        style={{
          gridTemplateColumns: `minmax(0, ${colFr[0]}fr) 10px minmax(0, ${colFr[1]}fr) 10px minmax(0, ${colFr[2]}fr)`,
        }}
      >
        {/* Säule 1: Zeit & Rhythmus (WANN) */}
        <div className="inspector-col">
          <div className="inspector-col-head">
            <div>
              <div className="col-kicker">Säule 1 · WANN</div>
              <div className="col-title">Zeit & Rhythmus</div>
            </div>
          </div>
          <div className="inspector-col-body">
            {gridOp && gridMod ? (
              <div className={`sub-card${gridOp.bypassed ? ' is-bypassed' : ''}`}>
                <div className="sub-card-head">
                  <span className="sub-card-title" title={gridMod.description}>
                    Rhythmus-Raster
                  </span>
                  <button
                    type="button"
                    className={`btn-sm${!gridOp.bypassed ? ' is-active' : ''}`}
                    onClick={() => toggleTimeOpBypass(gridOp.id)}
                    title={
                      gridOp.bypassed
                        ? 'Raster einschalten'
                        : 'Raster ausschalten – Flächen-Instrumente klingen dann durchgehend'
                    }
                  >
                    <Power size={11} />
                    {gridOp.bypassed ? 'Aus (Dauerton)' : 'An'}
                  </button>
                </div>
                <div className="preset-chips">
                  {GRID_TEMPLATES.map((t) => (
                    <button
                      key={t.label}
                      type="button"
                      className="preset-chip"
                      title={t.description}
                      onClick={() =>
                        commitTimeOpParams(
                          gridOp.id,
                          { steps: t.steps, ...gridParamsFromCells(t.cells()) },
                          `Rhythmus-Vorlage: ${t.label}`,
                        )
                      }
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <StepGridEditor
                  params={gridOp.params}
                  color={layer.color}
                  cycleBeats={layerCycleBeats}
                  disabled={gridOp.bypassed}
                  onCommit={(patch, label) => commitTimeOpParams(gridOp.id, patch, label)}
                />
                <div className="param-group-title">Kurve jedes Schlags</div>
                {gridMod.parameters
                  .filter((schema) => !schema.hidden && schema.id !== 'steps')
                  .map((schema) => (
                    <SchemaControl
                      key={schema.id}
                      schema={schema}
                      value={gridOp.params[schema.id] ?? schema.defaultValue}
                      layer={layer}
                      targetDomain="time"
                      targetCardId={gridOp.id}
                      activeModTarget={activeModTarget}
                      hoveredModSourceId={hoveredModSourceId}
                      accentColor={layer.color}
                      onChange={(val) => updateTimeOpParam(gridOp.id, schema.id, val)}
                      onOpenModTarget={onSetActiveModTarget}
                    />
                  ))}
                <div className="muted-note">
                  Ausgehaltene Töne: Haltebögen (Werkzeug „Halten“) malen und in Säule 2 „Halten (Sustain)“
                  hochdrehen.
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="btn-sm"
                onClick={() =>
                  onCommitLayerImmediate(
                    layer.id,
                    (l) => ({
                      ...l,
                      timeOperators: insertTimeOperator(
                        l.timeOperators,
                        OPTIONAL_TIME_OPERATORS.find((o) => o.moduleId === 'time-step-grid')!.create(l.id),
                      ),
                    }),
                    'Rhythmus-Raster hinzugefügt',
                  )
                }
              >
                <Plus size={12} /> Rhythmus-Raster
              </button>
            )}

            {grooveOps.length > 0 && (
              <div className="muted-note" style={{ fontWeight: 600 }}>
                Groove (Reihenfolge wird automatisch richtig einsortiert):
              </div>
            )}
            {grooveOps.map((op) => {
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
                    <div style={{ display: 'flex', gap: 3 }}>
                      <button
                        type="button"
                        className={`btn-sm${!op.bypassed ? ' is-active' : ''}`}
                        onClick={() => toggleTimeOpBypass(op.id)}
                        title={op.bypassed ? 'Aktivieren' : 'Umgehen (Bypass)'}
                      >
                        <Power size={11} />
                        {op.bypassed ? 'Aus' : 'An'}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-danger btn-sm"
                        onClick={() => removeTimeOp(op.id, mod.displayName)}
                        title="Karte entfernen"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                  {!op.bypassed &&
                    mod.parameters
                      .filter((schema) => !schema.hidden)
                      .map((schema) => (
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
                          onChange={(val) => updateTimeOpParam(op.id, schema.id, val)}
                          onOpenModTarget={onSetActiveModTarget}
                        />
                      ))}
                </div>
              );
            })}

            <div className="preset-chips">
              {OPTIONAL_TIME_OPERATORS.filter(
                (opt) =>
                  opt.moduleId !== 'time-step-grid' &&
                  !layer.timeOperators.some((op) => op.moduleId === opt.moduleId),
              ).map((opt) => (
                <button
                  key={opt.moduleId}
                  type="button"
                  className="btn-sm"
                  onClick={() =>
                    onCommitLayerImmediate(
                      layer.id,
                      (l) => ({
                        ...l,
                        timeOperators: insertTimeOperator(l.timeOperators, opt.create(l.id)),
                      }),
                      `${opt.label} hinzugefügt`,
                    )
                  }
                  title={opt.hint}
                >
                  <Plus size={12} /> {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <Splitter
          direction="col"
          onDragStart={startColDrag}
          onDrag={(d) => dragCol(0, d)}
          onReset={resetCols}
        />
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
                <GroupedSchemaControls
                  schemas={voiceModule.parameters}
                  values={layer.voice.params}
                  layer={layer}
                  targetCardId="voice"
                  activeModTarget={activeModTarget}
                  hoveredModSourceId={hoveredModSourceId}
                  onChange={updateVoiceParam}
                  onOpenModTarget={onSetActiveModTarget}
                  pitchExtra={<PitchSourceControl layer={layer} onCommit={commitPitch} />}
                />
              </div>
            )}

            {/* Stimme B (Dual-Voice Kombination) */}
            <div
              className={`sub-card${!secEnabled && secExpanded ? ' is-bypassed' : ''}`}
            >
              <div className="sub-card-head">
                <span
                  className="sub-card-title"
                  title="Optionale zweite Stimme mit der Haupt-Voice mischen"
                >
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    style={{ padding: '2px 3px' }}
                    onClick={() => setSecExpanded((prev) => !prev)}
                    title={
                      secExpanded ? 'Stimme B einklappen' : 'Stimme B aufklappen'
                    }
                    aria-expanded={secExpanded}
                  >
                    {secExpanded ? (
                      <ChevronDown size={13} />
                    ) : (
                      <ChevronRight size={13} />
                    )}
                  </button>
                  Stimme B (Kombination)
                </span>
                <button
                  type="button"
                  className={`btn-sm${secEnabled ? ' is-active' : ''}`}
                  onClick={toggleSecondaryVoice}
                  title={
                    secEnabled
                      ? 'Stimme B deaktivieren'
                      : 'Stimme B aktivieren und einmischen'
                  }
                >
                  <Power size={11} />
                  {secEnabled ? 'An' : 'Aus'}
                </button>
              </div>

              {!secExpanded && !secEnabled && (
                <button
                  type="button"
                  className="btn-sm"
                  onClick={toggleSecondaryVoice}
                  title="Zweite Stimme aktivieren und mit der Haupt-Voice mischen"
                >
                  <Plus size={12} /> Zweite Stimme einmischen
                </button>
              )}

              {secExpanded && (
                <>
                  <div
                    className="field-chip"
                    title="Zweite Klangerzeuger-Voice wählen"
                  >
                    <label>Voice B</label>
                    <select
                      value={activeSecModuleId}
                      onChange={(e) => switchSecondaryVoice(e.target.value)}
                      style={{ flex: 1, minWidth: 0 }}
                    >
                      {voices.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.displayName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div
                    className="schema-control"
                    title="Mischanteil zwischen Haupt-Voice (0 %) und Stimme B (100 %)"
                  >
                    <div className="schema-control-row">
                      <div className="schema-label-wrap">
                        <span className="schema-label">Anteil Stimme B</span>
                      </div>
                      <span className="schema-value">
                        {Math.round(secondaryMix * 100)} %
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={secondaryMix}
                      style={{ '--slider-accent': layer.color } as CSSProperties}
                      onChange={(e) =>
                        updateSecondaryMix(Number(e.target.value))
                      }
                      onDoubleClick={() => updateSecondaryMix(0.35)}
                      title="Anteil Stimme B (Doppelklick = 35 %)"
                    />
                  </div>

                  {secondaryVoiceMod && (
                    <GroupedSchemaControls
                      schemas={secondaryVoiceMod.parameters}
                      values={secondaryParams}
                      layer={layer}
                      targetCardId="secondary-voice"
                      activeModTarget={activeModTarget}
                      hoveredModSourceId={hoveredModSourceId}
                      onChange={updateSecondaryVoiceParam}
                      onOpenModTarget={onSetActiveModTarget}
                    />
                  )}
                </>
              )}
            </div>

            <div className="muted-note" style={{ fontWeight: 600 }}>
              Klang- & Effekt-Kette (Pfeile zum Umsortieren):
            </div>

            {layer.processorChain.map((card, idx) => {
              const mod = defaultRegistry.getProcessor(card.moduleId);
              if (!mod) return null;
              return (
                <div
                  key={card.id}
                  className={`sub-card${card.bypassed ? ' is-bypassed' : ''}`}
                >
                  <div className="sub-card-head">
                    <span className="sub-card-title" title={mod.description}>
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

        <Splitter
          direction="col"
          onDragStart={startColDrag}
          onDrag={(d) => dragCol(1, d)}
          onReset={resetCols}
        />
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
