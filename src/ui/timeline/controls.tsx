import type { CSSProperties } from 'react';

interface LiveRangeProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  title?: string;
  accent?: string;
  style?: CSSProperties;
  /** Called on every movement (preview, no undo step). */
  onLive: (v: number) => void;
  /** Called once when the drag / key press ends (one undo step). */
  onCommit: () => void;
  onDoubleClick?: () => void;
}

/** Range slider: live preview while dragging, a single undo step at the end. */
export function LiveRange({
  value,
  min,
  max,
  step = 0.01,
  title,
  accent,
  style,
  onLive,
  onCommit,
  onDoubleClick,
}: LiveRangeProps) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      title={title}
      style={{ ...(accent ? ({ '--slider-accent': accent } as CSSProperties) : {}), ...style }}
      onChange={(e) => onLive(Number(e.target.value))}
      onPointerUp={onCommit}
      onKeyUp={onCommit}
      onBlur={onCommit}
      onDoubleClick={onDoubleClick}
    />
  );
}

export function formatPan(p: number): string {
  if (Math.abs(p) < 0.02) return 'Mitte';
  return p < 0 ? `L ${Math.round(-p * 100)}` : `R ${Math.round(p * 100)}`;
}

export function formatPercent(v: number): string {
  return `${Math.round(v * 100)} %`;
}
