import type { CSSProperties } from 'react';
import type { ParameterSchema } from '../../core/registry/types';
import type {
  LayerConfig,
  ModulationTargetDomain,
} from '../../core/state/types';
import type { ActiveModTarget } from '../store/useStudioStore';

interface SchemaControlProps {
  schema: ParameterSchema;
  value: number;
  layer: LayerConfig;
  targetDomain: Exclude<ModulationTargetDomain, 'modulation'>;
  targetCardId: string;
  activeModTarget: ActiveModTarget | null;
  hoveredModSourceId: string | null;
  accentColor: string;
  onChange: (nextValue: number) => void;
  onOpenModTarget: (target: ActiveModTarget) => void;
}

function formatParamValue(schema: ParameterSchema, value: number): string {
  if (schema.options && schema.options.length > 0) {
    const matched = schema.options.find((opt) => Math.abs(opt.value - value) < 0.01);
    if (matched) return matched.label;
  }

  let formatted: string;
  if (schema.step !== undefined && schema.step >= 1) {
    formatted = Math.round(value).toString();
  } else if (Math.abs(schema.max - schema.min) <= 2.5) {
    formatted = value.toFixed(2);
  } else {
    formatted = value.toFixed(1);
  }

  return schema.unitLabel ? `${formatted} ${schema.unitLabel}` : formatted;
}

function toSliderPosition(schema: ParameterSchema, value: number): number {
  const span = schema.max - schema.min;
  if (span <= 0) return 0;
  const norm = Math.max(0, Math.min(1, (value - schema.min) / span));
  if (schema.curve === 'exp' && schema.min > 0) {
    return Math.log(Math.max(schema.min, value) / schema.min) / Math.log(schema.max / schema.min);
  }
  return norm;
}

function fromSliderPosition(schema: ParameterSchema, pos01: number): number {
  const clamped = Math.max(0, Math.min(1, pos01));
  if (schema.curve === 'exp' && schema.min > 0) {
    return schema.min * Math.pow(schema.max / schema.min, clamped);
  }
  const raw = schema.min + clamped * (schema.max - schema.min);
  if (schema.step !== undefined && schema.step > 0) {
    const snapped = Math.round((raw - schema.min) / schema.step) * schema.step + schema.min;
    return Math.max(schema.min, Math.min(schema.max, snapped));
  }
  return raw;
}

export function SchemaControl({
  schema,
  value,
  layer,
  targetDomain,
  targetCardId,
  activeModTarget,
  hoveredModSourceId,
  accentColor,
  onChange,
  onOpenModTarget,
}: SchemaControlProps) {
  const safeVal = Number.isFinite(value) ? value : schema.defaultValue;

  const matchingRoutes = layer.modulations.filter(
    (m) =>
      m.enabled &&
      m.targetDomain === targetDomain &&
      m.targetParamId === schema.id &&
      (m.targetCardId === targetCardId ||
        (targetDomain === 'voice' && m.targetCardId === 'voice')),
  );

  const isTargetOpen =
    activeModTarget !== null &&
    activeModTarget.layerId === layer.id &&
    activeModTarget.targetDomain === targetDomain &&
    activeModTarget.targetCardId === targetCardId &&
    activeModTarget.targetParamId === schema.id;

  const isGlowingFromHover =
    hoveredModSourceId !== null &&
    matchingRoutes.some(
      (r) =>
        r.sourceConfig.curveId === hoveredModSourceId ||
        r.sourceConfig.sourceLayerId === hoveredModSourceId ||
        r.id === hoveredModSourceId,
    );

  const stepVal =
    schema.step !== undefined
      ? schema.step
      : Math.abs(schema.max - schema.min) <= 2.5
        ? 0.01
        : 0.05;

  return (
    <div
      className={`schema-control${isTargetOpen ? ' is-mod-target' : ''}${
        isGlowingFromHover ? ' is-mod-glow' : ''
      }`}
      title={schema.description}
    >
      <div className="schema-control-row">
        <div className="schema-label-wrap">
          <span className="schema-label">{schema.label}</span>
          {schema.modulatable && (
            <button
              type="button"
              className={`mod-tilde-btn${matchingRoutes.length > 0 ? ' has-routes' : ''}${
                isTargetOpen ? ' is-open' : ''
              }`}
              style={{ '--mod-color': accentColor } as CSSProperties}
              title={
                matchingRoutes.length > 0
                  ? `${matchingRoutes.length} aktive Bewegung(en) auf „${schema.label}“ – klicken zum Bearbeiten`
                  : `Bewegung (~) auf „${schema.label}“ hinzufügen`
              }
              onClick={() =>
                onOpenModTarget({
                  layerId: layer.id,
                  targetDomain,
                  targetCardId,
                  targetParamId: schema.id,
                  label: schema.label,
                  min: schema.min,
                  max: schema.max,
                  unitLabel: schema.unitLabel,
                })
              }
            >
              ~{matchingRoutes.length > 0 ? matchingRoutes.length : ''}
            </button>
          )}
        </div>
        <span className="schema-value">{formatParamValue(schema, safeVal)}</span>
      </div>

      {schema.options && schema.options.length > 0 ? (
        <select
          value={Math.round(safeVal)}
          onChange={(e) => onChange(Number(e.target.value))}
          title={schema.description}
        >
          {schema.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : schema.curve === 'exp' ? (
        <input
          type="range"
          min={0}
          max={1}
          step={0.005}
          value={toSliderPosition(schema, safeVal)}
          style={{ '--slider-accent': accentColor } as CSSProperties}
          onChange={(e) =>
            onChange(fromSliderPosition(schema, Number(e.target.value)))
          }
          onDoubleClick={() => onChange(schema.defaultValue)}
          title={`${schema.description} (Doppelklick = Standard)`}
        />
      ) : (
        <input
          type="range"
          min={schema.min}
          max={schema.max}
          step={stepVal}
          value={safeVal}
          style={{ '--slider-accent': accentColor } as CSSProperties}
          onChange={(e) => onChange(Number(e.target.value))}
          onDoubleClick={() => onChange(schema.defaultValue)}
          title={`${schema.description} (Doppelklick = Standard)`}
        />
      )}
    </div>
  );
}
