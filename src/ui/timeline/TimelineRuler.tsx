import { useEffect, useRef } from 'react';
import type { TempoMap } from '../../core/arrangement/tempoMap';
import type { ArrangementDoc } from '../../core/arrangement/types';
import { RULER_HEIGHT } from './geometry';

interface GridView {
  readonly scrollLeft: number;
  readonly width: number;
  readonly pxPerBeat: number;
}

/** Iterates the visible bar lines (calls fn with beat, bar index). */
export function forEachVisibleBar(
  tm: TempoMap,
  view: GridView,
  fn: (beat: number, bar: number, beatsPerBar: number) => void,
): void {
  const b0 = Math.max(0, view.scrollLeft / view.pxPerBeat);
  const b1 = (view.scrollLeft + view.width) / view.pxPerBeat;
  let bar = tm.barPosition(b0).bar;
  for (let guard = 0; guard < 20000; guard++) {
    const beat = tm.barStartBeat(bar);
    if (beat > b1) break;
    fn(beat, bar, tm.beatsPerBarAt(beat));
    bar++;
  }
}

/** Grid lines behind the lanes. */
export function drawLaneGrid(
  ctx: CanvasRenderingContext2D,
  tm: TempoMap,
  view: GridView,
  height: number,
): void {
  const { scrollLeft, pxPerBeat } = view;
  const barPx = pxPerBeat * 4;
  const labelEvery = barPx < 6 ? 16 : barPx < 12 ? 8 : barPx < 24 ? 4 : 1;
  forEachVisibleBar(tm, view, (beat, bar, bpb) => {
    const x = Math.round(beat * pxPerBeat - scrollLeft) + 0.5;
    const strong = bar % 4 === 0;
    if (bar % labelEvery === 0) {
      ctx.strokeStyle = strong ? 'rgba(148,163,184,0.22)' : 'rgba(148,163,184,0.12)';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    if (pxPerBeat >= 10) {
      ctx.strokeStyle = 'rgba(148,163,184,0.05)';
      for (let b = 1; b < bpb; b++) {
        const xb = Math.round((beat + b) * pxPerBeat - scrollLeft) + 0.5;
        ctx.beginPath();
        ctx.moveTo(xb, 0);
        ctx.lineTo(xb, height);
        ctx.stroke();
      }
    }
  });
}

interface TimelineRulerProps {
  doc: ArrangementDoc;
  tempoMap: TempoMap;
  scrollLeft: number;
  width: number;
  pxPerBeat: number;
  startBeat: number;
  onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>, beat: number, row: 'markers' | 'bars') => void;
  onDoubleClick: (beat: number, row: 'markers' | 'bars') => void;
  onContextMenu: (e: React.MouseEvent, beat: number) => void;
}

export function TimelineRuler({
  doc,
  tempoMap,
  scrollLeft,
  width,
  pxPerBeat,
  startBeat,
  onPointerDown,
  onDoubleClick,
  onContextMenu,
}: TimelineRulerProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(width));
    if (cv.width !== w * dpr || cv.height !== RULER_HEIGHT * dpr) {
      cv.width = w * dpr;
      cv.height = RULER_HEIGHT * dpr;
      cv.style.width = `${w}px`;
      cv.style.height = `${RULER_HEIGHT}px`;
    }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, RULER_HEIGHT);
    ctx.fillStyle = '#10141e';
    ctx.fillRect(0, 0, w, RULER_HEIGHT);
    const view = { scrollLeft, width: w, pxPerBeat };
    const xOf = (beat: number) => beat * pxPerBeat - scrollLeft;

    // Loop range
    if (doc.loop && doc.loop.endBeat > doc.loop.startBeat) {
      const x0 = xOf(doc.loop.startBeat);
      const x1 = xOf(doc.loop.endBeat);
      ctx.fillStyle = doc.loop.enabled ? 'rgba(56,189,248,0.28)' : 'rgba(148,163,184,0.14)';
      ctx.fillRect(x0, 15, x1 - x0, RULER_HEIGHT - 15);
    }

    // Bars
    const barPx = pxPerBeat * 4;
    const labelEvery = barPx < 6 ? 16 : barPx < 12 ? 8 : barPx < 24 ? 4 : barPx < 40 ? 2 : 1;
    ctx.font = '10px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    forEachVisibleBar(tempoMap, view, (beat, bar, bpb) => {
      const x = Math.round(xOf(beat)) + 0.5;
      if (bar % labelEvery === 0) {
        ctx.strokeStyle = 'rgba(203,213,225,0.55)';
        ctx.beginPath();
        ctx.moveTo(x, 18);
        ctx.lineTo(x, RULER_HEIGHT);
        ctx.stroke();
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(String(bar + 1), x + 3, 27);
      }
      if (pxPerBeat >= 8) {
        ctx.strokeStyle = 'rgba(148,163,184,0.35)';
        for (let b = 1; b < bpb; b++) {
          const xb = Math.round(xOf(beat + b)) + 0.5;
          ctx.beginPath();
          ctx.moveTo(xb, RULER_HEIGHT - 6);
          ctx.lineTo(xb, RULER_HEIGHT);
          ctx.stroke();
        }
      }
    });

    // Marker row (top 15 px): tempo, meter, song markers
    ctx.fillStyle = '#0b0e15';
    ctx.fillRect(0, 0, w, 15);
    ctx.font = '9.5px ui-sans-serif, system-ui, sans-serif';
    for (const m of doc.tempoMarkers) {
      const x = xOf(m.beat);
      if (x < -60 || x > w) continue;
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(x, 0, 2, 15);
      ctx.fillText(`♩=${Math.round(m.bpm)}`, x + 4, 7.5);
    }
    for (const m of doc.meterMarkers) {
      const x = xOf(m.beat);
      if (x < -40 || x > w) continue;
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(x, 8, 2, 7);
      ctx.fillText(`${m.numerator}/${m.denominator}`, x + 4, m.beat === 0 ? 7.5 : 11);
    }
    for (const m of doc.songMarkers) {
      const x = xOf(m.beat);
      if (x < -120 || x > w) continue;
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.moveTo(x, 15);
      ctx.lineTo(x, 2);
      ctx.lineTo(x + 7, 5);
      ctx.lineTo(x, 8);
      ctx.fill();
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(m.name, x + 9, 7.5);
    }

    // Start position (where Play begins)
    const xs = xOf(startBeat);
    if (xs >= -6 && xs <= w + 6) {
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.moveTo(xs - 5, 15);
      ctx.lineTo(xs + 5, 15);
      ctx.lineTo(xs, 22);
      ctx.fill();
    }
  }, [doc, tempoMap, scrollLeft, width, pxPerBeat, startBeat]);

  const beatAt = (clientX: number): number => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, (clientX - rect.left + scrollLeft) / pxPerBeat);
  };
  const rowAt = (clientY: number): 'markers' | 'bars' => {
    const rect = ref.current?.getBoundingClientRect();
    return rect && clientY - rect.top < 15 ? 'markers' : 'bars';
  };

  return (
    <canvas
      ref={ref}
      className="timeline-ruler-canvas"
      onPointerDown={(e) => onPointerDown(e, beatAt(e.clientX), rowAt(e.clientY))}
      onDoubleClick={(e) => onDoubleClick(beatAt(e.clientX), rowAt(e.clientY))}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e, beatAt(e.clientX));
      }}
      title="Klicken/Ziehen = Startposition · Shift+Ziehen = Loop-Bereich · Doppelklick oben = Marker bearbeiten · Rechtsklick = Marker-Menü"
    />
  );
}
