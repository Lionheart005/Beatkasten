import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { defaultRegistry } from '../../core/defaultRegistry';
import {
  DEFAULT_CURVE_PRESETS,
  evaluateDrawnCurve,
  type CurvePoint,
  type DrawnCurveData,
} from '../../core/math/curves';
import type {
  LayerConfig,
  ModulationCombineMode,
  ModulationRouteConfig,
  ModulationTargetDomain,
} from '../../core/state/types';
import type { CycleUnit } from '../../core/theory/cycles';
import type { ActiveModTarget } from '../store/useStudioStore';

interface CurveDrawCanvasProps {
  curves: readonly DrawnCurveData[];
  selectedCurveId: string;
  selectedLayer: LayerConfig | undefined;
  activeModTarget: ActiveModTarget | null;
  onSelectCurve: (curveId: string) => void;
  onUpsertCurve: (curve: DrawnCurveData) => void;
  onCreateCurve: (preset?: DrawnCurveData) => DrawnCurveData;
  onAssignRoute: (
    layerId: string,
    route: Omit<ModulationRouteConfig, 'id'>,
  ) => void;
  onHoverSource: (sourceId: string | null) => void;
}

interface AssignableTarget {
  readonly key: string;
  readonly domain: Exclude<ModulationTargetDomain, 'modulation'>;
  readonly cardId: string;
  readonly paramId: string;
  readonly label: string;
}

const SNAP_OPTIONS = [
  { value: 0, label: 'Frei' },
  { value: 4, label: '4' },
  { value: 8, label: '8' },
  { value: 12, label: '12 (Triole)' },
  { value: 16, label: '16' },
];

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function snapValue(x: number, snapDiv: number): number {
  const c = clamp01(x);
  if (!snapDiv || snapDiv <= 0) return c;
  return Math.round(c * snapDiv) / snapDiv;
}

function simplifyStroke(raw: CurvePoint[], maxPoints = 18): CurvePoint[] {
  if (raw.length <= 2) return raw;
  const sorted = [...raw].sort((a, b) => a.x - b.x);
  const deduped: CurvePoint[] = [];
  for (const pt of sorted) {
    const prev = deduped[deduped.length - 1];
    if (!prev || pt.x - prev.x > 0.03) {
      deduped.push(pt);
    } else {
      deduped[deduped.length - 1] = pt;
    }
  }
  if (deduped.length <= maxPoints) return deduped;
  const step = (deduped.length - 1) / (maxPoints - 1);
  const out: CurvePoint[] = [];
  for (let i = 0; i < maxPoints; i++) {
    out.push(deduped[Math.round(i * step)]!);
  }
  return out;
}

export function CurveDrawCanvas({
  curves,
  selectedCurveId,
  selectedLayer,
  activeModTarget,
  onSelectCurve,
  onUpsertCurve,
  onCreateCurve,
  onAssignRoute,
  onHoverSource,
}: CurveDrawCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drawMode, setDrawMode] = useState<'points' | 'freehand'>('points');
  const [dragPointIdx, setDragPointIdx] = useState<number | null>(null);
  const [isDrawingFreehand, setIsDrawingFreehand] = useState(false);
  const freehandRef = useRef<CurvePoint[]>([]);
  const [selectedTargetKey, setSelectedTargetKey] = useState<string>('');
  const [assignMode, setAssignMode] = useState<ModulationCombineMode>('add');
  const [assignDepth, setAssignDepth] = useState<number>(0.45);

  const activeCurve: DrawnCurveData = useMemo(() => {
    const found = curves.find((c) => c.id === selectedCurveId);
    return found ?? curves[0] ?? DEFAULT_CURVE_PRESETS[0]!;
  }, [curves, selectedCurveId]);

  const assignableTargets: AssignableTarget[] = useMemo(() => {
    if (!selectedLayer) return [];
    const list: AssignableTarget[] = [];

    const voiceMod = defaultRegistry.getVoice(selectedLayer.voice.moduleId);
    if (voiceMod) {
      for (const p of voiceMod.parameters) {
        if (!p.modulatable) continue;
        list.push({
          key: `voice::voice::${p.id}`,
          domain: 'voice',
          cardId: 'voice',
          paramId: p.id,
          label: `Klang: ${p.label}`,
        });
      }
    }

    for (const op of selectedLayer.timeOperators) {
      const mod = defaultRegistry.getTimeOperator(op.moduleId);
      if (!mod) continue;
      for (const p of mod.parameters) {
        if (!p.modulatable) continue;
        list.push({
          key: `time::${op.id}::${p.id}`,
          domain: 'time',
          cardId: op.id,
          paramId: p.id,
          label: `Zeit (${mod.displayName}): ${p.label}`,
        });
      }
    }

    for (const card of selectedLayer.processorChain) {
      const mod = defaultRegistry.getProcessor(card.moduleId);
      if (!mod) continue;
      for (const p of mod.parameters) {
        if (!p.modulatable) continue;
        list.push({
          key: `processor::${card.id}::${p.id}`,
          domain: 'processor',
          cardId: card.id,
          paramId: p.id,
          label: `${mod.displayName}: ${p.label}`,
        });
      }
    }

    return list;
  }, [selectedLayer]);

  useEffect(() => {
    if (activeModTarget) {
      const key = `${activeModTarget.targetDomain}::${activeModTarget.targetCardId}::${activeModTarget.targetParamId}`;
      if (assignableTargets.some((t) => t.key === key)) {
        setSelectedTargetKey(key);
        return;
      }
    }
    if (
      assignableTargets.length > 0 &&
      !assignableTargets.some((t) => t.key === selectedTargetKey)
    ) {
      setSelectedTargetKey(assignableTargets[0]!.key);
    }
  }, [activeModTarget, assignableTargets, selectedTargetKey]);

  // Draw Catmull-Rom curve & control points
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 280;
    const height = 136;
    if (
      canvas.width !== Math.round(width * dpr) ||
      canvas.height !== Math.round(height * dpr)
    ) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const padX = 8;
    const padY = 10;
    const innerW = width - padX * 2;
    const innerH = height - padY * 2;

    // Horizontal guide lines (0%, 50%, 100%)
    ctx.strokeStyle = 'rgba(161, 174, 198, 0.14)';
    ctx.lineWidth = 1;
    [0, 0.5, 1].forEach((gy) => {
      const y = padY + (1 - gy) * innerH;
      ctx.beginPath();
      ctx.moveTo(padX, y);
      ctx.lineTo(padX + innerW, y);
      ctx.stroke();
    });

    // Vertical snap grid
    const div = activeCurve.snapDivision > 0 ? activeCurve.snapDivision : 4;
    for (let i = 0; i <= div; i++) {
      const x = padX + (i / div) * innerW;
      ctx.strokeStyle =
        i % 4 === 0 ? 'rgba(161, 174, 198, 0.22)' : 'rgba(161, 174, 198, 0.09)';
      ctx.beginPath();
      ctx.moveTo(x, padY);
      ctx.lineTo(x, padY + innerH);
      ctx.stroke();
    }

    // Smooth Catmull-Rom curve
    const samples = 128;
    ctx.beginPath();
    for (let i = 0; i < samples; i++) {
      const p = i / (samples - 1);
      const val = evaluateDrawnCurve(activeCurve.points, p);
      const x = padX + p * innerW;
      const y = padY + (1 - val) * innerH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = selectedLayer?.color ?? '#38bdf8';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // Fill under curve
    ctx.lineTo(padX + innerW, padY + innerH);
    ctx.lineTo(padX, padY + innerH);
    ctx.closePath();
    ctx.fillStyle = `${selectedLayer?.color ?? '#38bdf8'}22`;
    ctx.fill();

    // Control points
    activeCurve.points.forEach((pt, idx) => {
      const px = padX + pt.x * innerW;
      const py = padY + (1 - pt.y) * innerH;
      ctx.beginPath();
      ctx.arc(px, py, idx === dragPointIdx ? 5.5 : 4.2, 0, Math.PI * 2);
      ctx.fillStyle = idx === dragPointIdx ? '#ffffff' : '#eef2f9';
      ctx.fill();
      ctx.strokeStyle = selectedLayer?.color ?? '#38bdf8';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    ctx.restore();
  }, [activeCurve, dragPointIdx, selectedLayer?.color]);

  const toNormalizedCoords = useCallback(
    (clientX: number, clientY: number): CurvePoint => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0.5, y: 0.5 };
      const rect = canvas.getBoundingClientRect();
      const padX = 8;
      const padY = 10;
      const innerW = Math.max(1, rect.width - padX * 2);
      const innerH = Math.max(1, rect.height - padY * 2);
      const rawX = (clientX - rect.left - padX) / innerW;
      const rawY = 1 - (clientY - rect.top - padY) / innerH;
      return {
        x: snapValue(rawX, activeCurve.snapDivision),
        y: clamp01(rawY),
      };
    },
    [activeCurve.snapDivision],
  );

  const ensureProjectCurve = useCallback(
    (nextPoints: readonly CurvePoint[]): DrawnCurveData => {
      const inProject = curves.some((c) => c.id === activeCurve.id);
      if (inProject) {
        return { ...activeCurve, points: nextPoints };
      }
      const created = onCreateCurve(activeCurve);
      return { ...created, points: nextPoints };
    },
    [activeCurve, curves, onCreateCurve],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button === 2) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = toNormalizedCoords(e.clientX, e.clientY);

    if (drawMode === 'freehand') {
      setIsDrawingFreehand(true);
      freehandRef.current = [pt];
      return;
    }

    // Check if near an existing point
    let nearestIdx = -1;
    let nearestDist = 0.045;
    activeCurve.points.forEach((p, idx) => {
      const d = Math.hypot(p.x - pt.x, p.y - pt.y);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = idx;
      }
    });

    if (nearestIdx >= 0) {
      setDragPointIdx(nearestIdx);
    } else {
      const nextPoints = [...activeCurve.points, pt].sort((a, b) => a.x - b.x);
      const newIdx = nextPoints.findIndex(
        (p) => Math.abs(p.x - pt.x) < 1e-5 && Math.abs(p.y - pt.y) < 1e-5,
      );
      setDragPointIdx(newIdx >= 0 ? newIdx : null);
      onUpsertCurve(ensureProjectCurve(nextPoints));
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pt = toNormalizedCoords(e.clientX, e.clientY);
    if (drawMode === 'freehand' && isDrawingFreehand) {
      freehandRef.current.push(pt);
      const simplified = simplifyStroke(freehandRef.current);
      onUpsertCurve(ensureProjectCurve(simplified));
      return;
    }
    if (dragPointIdx === null) return;
    const nextPoints = activeCurve.points.map((p, idx) =>
      idx === dragPointIdx ? pt : p,
    );
    nextPoints.sort((a, b) => a.x - b.x);
    const movedIdx = nextPoints.findIndex(
      (p) => Math.abs(p.x - pt.x) < 1e-5 && Math.abs(p.y - pt.y) < 1e-5,
    );
    setDragPointIdx(movedIdx >= 0 ? movedIdx : dragPointIdx);
    onUpsertCurve(ensureProjectCurve(nextPoints));
  };

  const handlePointerUp = () => {
    setDragPointIdx(null);
    setIsDrawingFreehand(false);
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (activeCurve.points.length <= 2) return;
    const pt = toNormalizedCoords(e.clientX, e.clientY);
    let nearestIdx = -1;
    let nearestDist = 0.06;
    activeCurve.points.forEach((p, idx) => {
      const d = Math.hypot(p.x - pt.x, p.y - pt.y);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = idx;
      }
    });
    if (nearestIdx >= 0) {
      const nextPoints = activeCurve.points.filter((_, idx) => idx !== nearestIdx);
      onUpsertCurve(ensureProjectCurve(nextPoints));
    }
  };

  const handleAssignCurve = () => {
    if (!selectedLayer) return;
    const target = assignableTargets.find((t) => t.key === selectedTargetKey);
    if (!target) return;

    let curveIdToUse = activeCurve.id;
    if (!curves.some((c) => c.id === activeCurve.id)) {
      const created = onCreateCurve(activeCurve);
      curveIdToUse = created.id;
    }

    onAssignRoute(selectedLayer.id, {
      label: activeCurve.name,
      enabled: true,
      sourceType: 'drawn-curve',
      sourceConfig: {
        curveId: curveIdToUse,
        cycleValue: activeCurve.cycleValue,
        cycleUnit: activeCurve.cycleUnit,
      },
      targetDomain: target.domain,
      targetCardId: target.cardId,
      targetParamId: target.paramId,
      combineMode: assignMode,
      depth: assignDepth,
    });
  };

  return (
    <div
      className="sub-card"
      onMouseEnter={() => onHoverSource(activeCurve.id)}
      onMouseLeave={() => onHoverSource(null)}
    >
      <div className="sub-card-head">
        <span className="sub-card-title">
          <Sparkles size={13} color="#38bdf8" />
          Kurven-Zeichner
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            className="btn-sm"
            onClick={() => onCreateCurve()}
            title="Neue eigene Kurve anlegen"
          >
            <Plus size={12} /> Neu
          </button>
        </div>
      </div>

      {/* Curve Selection & Name */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
        <select
          value={activeCurve.id}
          onChange={(e) => onSelectCurve(e.target.value)}
        >
          {curves.length === 0 && (
            <option value={activeCurve.id}>{activeCurve.name} (Vorlage)</option>
          )}
          {curves.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value=""
          onChange={(e) => {
            const preset = DEFAULT_CURVE_PRESETS.find(
              (p) => p.id === e.target.value,
            );
            if (preset) {
              onUpsertCurve({
                ...activeCurve,
                points: preset.points.map((pt) => ({ ...pt })),
                snapDivision: preset.snapDivision,
              });
            }
          }}
          title="Kurven-Vorlage auf aktuelle Kurve laden"
        >
          <option value="" disabled>
            Vorlage…
          </option>
          {DEFAULT_CURVE_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Mode & Snap Grid */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            className={`btn-sm${drawMode === 'points' ? ' is-active' : ''}`}
            onClick={() => setDrawMode('points')}
            title="Klicke zum Setzen/Ziehen von Punkten (Rechtsklick löscht Punkt)"
          >
            Punkte
          </button>
          <button
            type="button"
            className={`btn-sm${drawMode === 'freehand' ? ' is-active' : ''}`}
            onClick={() => setDrawMode('freehand')}
            title="Freihand-Bewegung über das Feld zeichnen"
          >
            Freihand
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="muted-note">Raster:</span>
          <select
            value={activeCurve.snapDivision}
            onChange={(e) =>
              onUpsertCurve({
                ...activeCurve,
                snapDivision: Number(e.target.value),
              })
            }
          >
            {SNAP_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        className="canvas-box"
        style={{ height: 136, cursor: 'crosshair', touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onContextMenu={handleContextMenu}
        title="Links ziehen = Punkt setzen/bewegen · Rechtsklick = Punkt entfernen"
      />

      {/* Cycle length of the curve */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 64px 74px',
          gap: 5,
          alignItems: 'center',
        }}
      >
        <input
          type="text"
          value={activeCurve.name}
          onChange={(e) =>
            onUpsertCurve({ ...activeCurve, name: e.target.value })
          }
          placeholder="Kurven-Name"
        />
        <input
          type="number"
          min={0.25}
          max={64}
          step={0.5}
          value={activeCurve.cycleValue}
          onChange={(e) =>
            onUpsertCurve({
              ...activeCurve,
              cycleValue: Math.max(0.25, Number(e.target.value) || 1),
            })
          }
        />
        <select
          value={activeCurve.cycleUnit}
          onChange={(e) =>
            onUpsertCurve({
              ...activeCurve,
              cycleUnit: e.target.value as CycleUnit,
            })
          }
        >
          <option value="beats">Beats</option>
          <option value="bars">Takte</option>
        </select>
      </div>

      {/* Direct assignment to any parameter */}
      <div
        style={{
          borderTop: '1px solid var(--border-subtle)',
          paddingTop: 7,
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
        }}
      >
        <span className="muted-note">Kurve direkt zuweisen an Regler:</span>
        <select
          value={selectedTargetKey}
          onChange={(e) => setSelectedTargetKey(e.target.value)}
        >
          {assignableTargets.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr auto',
            gap: 6,
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', gap: 3 }}>
            <button
              type="button"
              className={`btn-sm${assignMode === 'add' ? ' is-active' : ''}`}
              onClick={() => setAssignMode('add')}
              title="Additiv (+)"
            >
              +
            </button>
            <button
              type="button"
              className={`btn-sm${assignMode === 'multiply' ? ' is-active' : ''}`}
              onClick={() => setAssignMode('multiply')}
              title="Multiplikativ (×)"
            >
              ×
            </button>
          </div>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.01}
            value={assignDepth}
            onChange={(e) => setAssignDepth(Number(e.target.value))}
            title={`Stärke: ${Math.round(assignDepth * 100)} %`}
          />
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={handleAssignCurve}
            disabled={!selectedLayer || assignableTargets.length === 0}
          >
            Zuweisen ({Math.round(assignDepth * 100)}%)
          </button>
        </div>
      </div>
    </div>
  );
}
