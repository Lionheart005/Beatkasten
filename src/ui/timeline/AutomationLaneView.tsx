import { useMemo, useRef } from 'react';
import { LaneEvaluator } from '../../core/arrangement/automation';
import type { AutomationLane, Keyframe, KeyframeCurve } from '../../core/arrangement/types';

interface AutomationLaneViewProps {
  lane: AutomationLane;
  height: number;
  pxPerBeat: number;
  scrollLeft: number;
  viewWidth: number;
  totalWidth: number;
  min: number;
  max: number;
  /** Song beat of lane beat 0 (clip-layer lanes are relative to the clip start). */
  beatOffset: number;
  color: string;
  snap: (songBeat: number, altKey: boolean) => number;
  onPreview: (points: readonly Keyframe[]) => void;
  onCommitPreview: (label: string) => void;
  onCommit: (points: readonly Keyframe[], label: string) => void;
}

const CURVE_CYCLE: readonly KeyframeCurve[] = ['linear', 'smooth', 'hold', 'exp'];
const PAD = 5;

export function AutomationLaneView({
  lane,
  height,
  pxPerBeat,
  scrollLeft,
  viewWidth,
  totalWidth,
  min,
  max,
  beatOffset,
  color,
  snap,
  onPreview,
  onCommitPreview,
  onCommit,
}: AutomationLaneViewProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const span = max - min || 1;
  const yOf = (v: number) => PAD + (1 - (v - min) / span) * (height - 2 * PAD);
  const vOf = (y: number) => Math.min(max, Math.max(min, min + (1 - (y - PAD) / (height - 2 * PAD)) * span));
  const xOf = (laneBeat: number) => (laneBeat + beatOffset) * pxPerBeat;

  const path = useMemo(() => {
    if (lane.points.length === 0) return '';
    const ev = new LaneEvaluator(lane.points, min, max);
    const x0 = Math.max(0, scrollLeft - 20);
    const x1 = Math.min(totalWidth, scrollLeft + viewWidth + 20);
    const parts: string[] = [];
    for (let x = x0; x <= x1; x += 3) {
      const v = ev.value(x / pxPerBeat - beatOffset);
      parts.push(`${parts.length === 0 ? 'M' : 'L'}${x.toFixed(1)},${yOf(v).toFixed(1)}`);
    }
    return parts.join('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lane.points, min, max, scrollLeft, viewWidth, totalWidth, pxPerBeat, beatOffset, height]);

  const localPoint = (e: React.PointerEvent | React.MouseEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const dragRef = useRef<{ index: number; moved: boolean } | null>(null);

  const visible = lane.points
    .map((p, i) => ({ p, i, x: xOf(p.beat) }))
    .filter((q) => q.x >= scrollLeft - 20 && q.x <= scrollLeft + viewWidth + 20);

  return (
    <svg
      ref={svgRef}
      className={`tl-auto-svg${lane.enabled ? '' : ' is-disabled'}`}
      width={totalWidth}
      height={height}
      onPointerDown={(e) => {
        if (e.button !== 0 || e.target !== e.currentTarget) return;
        const { x, y } = localPoint(e);
        const beat = Math.max(0, snap(x / pxPerBeat, e.altKey) - beatOffset);
        const prev = [...lane.points].reverse().find((p) => p.beat <= beat);
        const next = [...lane.points.filter((p) => Math.abs(p.beat - beat) > 1e-9), { beat, value: vOf(y), curve: prev?.curve ?? 'linear' }];
        onCommit(next.sort((a, b) => a.beat - b.beat), 'Keyframe gesetzt');
      }}
      onPointerMove={(e) => {
        const d = dragRef.current;
        if (!d) return;
        d.moved = true;
        const { x, y } = localPoint(e);
        const beat = Math.max(0, snap(x / pxPerBeat, e.altKey) - beatOffset);
        const pts = lane.points.map((p, i) => (i === d.index ? { ...p, beat, value: vOf(y) } : p));
        onPreview(pts);
      }}
      onPointerUp={() => {
        const d = dragRef.current;
        dragRef.current = null;
        if (d?.moved) onCommitPreview('Keyframe verschoben');
      }}
    >
      <path d={path} fill="none" stroke={color} strokeWidth={1.6} />
      {visible.map(({ p, i, x }) => (
        <circle
          key={`${i}-${p.beat}`}
          cx={x}
          cy={yOf(p.value)}
          r={4.5}
          className={`tl-kf tl-kf-${p.curve}`}
          style={{ fill: color }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId);
            dragRef.current = { index: i, moved: false };
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onCommit(lane.points.filter((_, k) => k !== i), 'Keyframe gelöscht');
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const nextCurve = CURVE_CYCLE[(CURVE_CYCLE.indexOf(p.curve) + 1) % CURVE_CYCLE.length]!;
            onCommit(lane.points.map((q, k) => (k === i ? { ...q, curve: nextCurve } : q)), `Kurvenform: ${nextCurve}`);
          }}
        >
          <title>{`Beat ${(p.beat + beatOffset).toFixed(2)} · Wert ${p.value.toFixed(2)} · Form ${p.curve} (Rechtsklick = Form wechseln, Doppelklick = löschen)`}</title>
        </circle>
      ))}
    </svg>
  );
}
