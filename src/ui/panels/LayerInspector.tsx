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
import { euclidPattern } from '../../core/time/operators';
import type { DrawnCurveData } from '../../core/math/curves';
import { buildDefaultParams } from '../../core/registry/types';
import type {
  LayerConfig,
  ModulationRouteConfig,
  OperatorConfig,
  ProcessorCardConfig,
  SecondaryVoiceConfig,
} from '../../core/state/types';
import type { CycleUnit } from '../../core/theory/cycles';
import { CurveDrawCanvas } from '../components/CurveDrawCanvas';
import { ModulationDrawer } from '../components/ModulationDrawer';
import { SchemaControl } from '../components/SchemaControl';
import type { ActiveModTarget } from '../store/useStudioStore';

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

interface RhythmPresetValues {
  warpAmount: number;
  subdivisions: number;
  phaseShift: number;
  gravity: number;
  resetCycles?: number;
  freqA: number;
  freqB: number;
  interferenceMix: number;
  phaseOffset: number;
  threshold: number;
  waveShape?: number;
}

const RHYTHM_PRESET_VALUES: Record<RhythmPresetId, RhythmPresetValues> = {
  'four-on-floor': {
    warpAmount: 0,
    subdivisions: 4,
    phaseShift: 0,
    gravity: 0,
    resetCycles: 8,
    freqA: 4,
    freqB: 4,
    interferenceMix: 0,
    phaseOffset: 0,
    threshold: 0,
  },
  'offbeat-pump': {
    warpAmount: 0,
    subdivisions: 4,
    phaseShift: 0.5,
    gravity: 0,
    freqA: 4,
    freqB: 4,
    interferenceMix: 1,
    phaseOffset: 0.5,
    threshold: 0.15,
  },
  'triplet-gallop': {
    warpAmount: 0.12,
    subdivisions: 6,
    phaseShift: 0,
    gravity: 0.25,
    freqA: 6,
    freqB: 3,
    interferenceMix: 0.35,
    phaseOffset: 0,
    threshold: 0.2,
  },
  'riddle-3-5': {
    warpAmount: 0,
    subdivisions: 5,
    phaseShift: 0,
    gravity: 0.2,
    freqA: 5,
    freqB: 3,
    interferenceMix: 0.45,
    phaseOffset: 0.125,
    threshold: 0.25,
  },
};

function applyRhythmPreset(
  ops: readonly OperatorConfig[],
  presetId: RhythmPresetId,
): OperatorConfig[] {
  const preset = RHYTHM_PRESET_VALUES[presetId];
  return ops.map((op) => {
    if (op.moduleId === 'time-warp') {
      return {
        ...op,
        bypassed: false,
        params: {
          warpAmount: preset.warpAmount,
        },
      };
    }
    if (op.moduleId === 'time-grid-gravity') {
      return {
        ...op,
        bypassed: false,
        params: {
          subdivisions: preset.subdivisions,
          phaseShift: preset.phaseShift,
          gravity: preset.gravity,
        },
      };
    }
    if (op.moduleId === 'time-phase-drift') {
      return {
        ...op,
        bypassed: false,
        params: {
          ...op.params,
          driftSteps: 0,
          ...(preset.resetCycles !== undefined
            ? { resetCycles: preset.resetCycles }
            : {}),
        },
      };
    }
    if (op.moduleId === 'time-pulse-interference') {
      return {
        ...op,
        bypassed: false,
        params: {
          freqA: preset.freqA,
          freqB: preset.freqB,
          interferenceMix: preset.interferenceMix,
          phaseOffset: preset.phaseOffset,
          threshold: preset.threshold,
          waveShape: preset.waveShape ?? 0,
        },
      };
    }
    if (op.moduleId === 'time-euclid') {
      // Classic presets are built on the pulse interference.
      return { ...op, bypassed: true };
    }
    return op;
  });
}

const EUCLID_TEMPLATES: ReadonlyArray<{
  label: string;
  steps: number;
  hits: number;
  rotation?: number;
  description: string;
}> = [
  { label: 'Tresillo 3/8', steps: 8, hits: 3, description: 'x..x..x. – Basis von Reggaeton, Dembow & vielen Techno-Basslines' },
  { label: 'Cinquillo 5/8', steps: 8, hits: 5, description: 'x.xx.xx. – kubanischer Puls, treibend' },
  { label: 'Bossa 5/16', steps: 16, hits: 5, description: 'Weit verteilte, schwebende Akzente' },
  { label: 'Samba 7/16', steps: 16, hits: 7, description: 'Lebendige, verschachtelte Sechzehntel' },
  { label: 'Roll 9/16', steps: 16, hits: 9, description: 'Dichter, rollender Hi-Hat-Teppich' },
  { label: 'Dicht 13/16', steps: 16, hits: 13, description: 'Fast durchgehend mit wenigen Lücken' },
  { label: 'Triole 4/12', steps: 12, hits: 4, description: 'Triolischer Viertelpuls' },
  { label: 'Aksak 4/9', steps: 9, hits: 4, description: 'Hinkender 2-2-2-3-Rhythmus (Balkan)' },
  { label: 'Rätsel 5/13', steps: 13, hits: 5, description: 'Ungerades Raster – erzeugt lange Phasenrätsel' },
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

  const applyEuclidTemplate = (opId: string, t: (typeof EUCLID_TEMPLATES)[number]) => {
    onCommitLayerImmediate(
      layer.id,
      (l) => ({
        ...l,
        timeOperators: l.timeOperators.map((op) =>
          op.id === opId
            ? {
                ...op,
                bypassed: false,
                params: {
                  ...op.params,
                  euclidSteps: t.steps,
                  euclidHits: t.hits,
                  euclidRotation: t.rotation ?? 0,
                },
              }
            : op,
        ),
      }),
      `Euklid-Vorlage: ${t.label}`,
    );
  };

  const renderEuclidExtras = (op: OperatorConfig) => {
    const steps = op.params.euclidSteps ?? 16;
    const hits = op.params.euclidHits ?? 5;
    const rotation = op.params.euclidRotation ?? 0;
    const pattern = euclidPattern(steps, hits, rotation);
    const isMask = Math.round(op.params.euclidMode ?? 0) === 1;
    const interferenceOn = layer.timeOperators.some(
      (o) => o.moduleId === 'time-pulse-interference' && !o.bypassed,
    );
    return (
      <>
        <div className="euclid-pattern" title={`${Math.min(hits, steps)} Schläge auf ${steps} Steps`}>
          {pattern.map((on, i) => (
            <span
              key={i}
              className={`euclid-cell${on ? ' is-hit' : ''}`}
              style={on ? { background: layer.color } : undefined}
            />
          ))}
        </div>
        <div className="preset-chips">
          {EUCLID_TEMPLATES.map((t) => (
            <button
              key={t.label}
              type="button"
              className={`preset-chip${t.steps === steps && t.hits === hits ? ' is-active' : ''}`}
              title={t.description}
              onClick={() => applyEuclidTemplate(op.id, t)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {!op.bypassed && (
          <div className="muted-note">
            {isMask
              ? interferenceOn
                ? 'Maske: nur Pulse der Puls-Interferenz, die auf einen Schlag fallen, kommen durch (am besten Puls-Welle A = Steps).'
                : 'Maske ohne aktive Puls-Interferenz: der Operator erzeugt den Puls selbst.'
              : interferenceOn
                ? 'Eigener Puls: ersetzt den Rhythmus der Puls-Interferenz (Beschleunigung & Gravitation wirken weiter).'
                : 'Eigener Puls: dieser Operator bestimmt den Rhythmus des Layers.'}
          </div>
        )}
      </>
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
                  {op.moduleId === 'time-euclid' && renderEuclidExtras(op)}
                </div>
              );
            })}

            {OPTIONAL_TIME_OPERATORS.filter(
              (opt) => !layer.timeOperators.some((op) => op.moduleId === opt.moduleId),
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

                  {secondaryVoiceMod &&
                    secondaryVoiceMod.parameters.map((schema) => (
                      <SchemaControl
                        key={schema.id}
                        schema={schema}
                        value={
                          secondaryParams[schema.id] ?? schema.defaultValue
                        }
                        layer={layer}
                        targetDomain="voice"
                        targetCardId="secondary-voice"
                        activeModTarget={activeModTarget}
                        hoveredModSourceId={hoveredModSourceId}
                        accentColor={layer.color}
                        onChange={(val) =>
                          updateSecondaryVoiceParam(schema.id, val)
                        }
                        onOpenModTarget={onSetActiveModTarget}
                      />
                    ))}
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
