import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Eraser, FlipHorizontal2 } from 'lucide-react';
import {
  euclidCells,
  GRID_ACCENT,
  GRID_HIT,
  GRID_MAX_STEPS,
  GRID_OFF,
  GRID_TIE,
  gridParamsFromCells,
  readGridCells,
  type GridCell,
} from '../../core/time/operators';

/** Klick-Werkzeuge des Rasters. */
type GridTool = typeof GRID_HIT | typeof GRID_ACCENT | typeof GRID_TIE;

const TOOLS: ReadonlyArray<{ value: GridTool; label: string; hint: string }> = [
  { value: GRID_HIT, label: 'Schlag', hint: 'Klick setzt einen normalen Schlag (nochmal klicken = aus)' },
  { value: GRID_ACCENT, label: 'Akzent', hint: 'Betonter, lauterer Schlag' },
  {
    value: GRID_TIE,
    label: 'Halten',
    hint: 'Haltebogen: der vorherige Ton klingt durch diesen Step weiter (kein neuer Anschlag)',
  },
];

const STEP_CHIPS = [4, 8, 12, 16, 24, 32, 48, 64];

function cellsFromPositions(steps: number, hits: readonly number[], accents: readonly number[] = []): GridCell[] {
  const out: GridCell[] = new Array<GridCell>(steps).fill(GRID_OFF);
  for (const h of hits) if (h < steps) out[h] = GRID_HIT;
  for (const a of accents) if (a < steps) out[a] = GRID_ACCENT;
  return out;
}

export interface GridTemplate {
  readonly label: string;
  readonly description: string;
  readonly steps: number;
  readonly cells: () => GridCell[];
}

export const GRID_TEMPLATES: readonly GridTemplate[] = [
  { label: 'Four-on-the-Floor', description: 'Gerader Schlag auf jeder Zählzeit', steps: 16, cells: () => cellsFromPositions(16, [0, 4, 8, 12], [0]) },
  { label: 'Offbeat', description: 'Zwischen den Zählzeiten (klassischer Offbeat-Bass / Hi-Hat)', steps: 16, cells: () => cellsFromPositions(16, [2, 6, 10, 14]) },
  { label: 'Backbeat 2 & 4', description: 'Clap/Snare auf Zählzeit 2 und 4', steps: 16, cells: () => cellsFromPositions(16, [4, 12]) },
  { label: 'Achtel', description: 'Jede Achtel', steps: 16, cells: () => cellsFromPositions(16, [0, 2, 4, 6, 8, 10, 12, 14], [0, 8]) },
  { label: 'Sechzehntel', description: 'Durchgehender 16tel-Teppich', steps: 16, cells: () => cellsFromPositions(16, Array.from({ length: 16 }, (_, i) => i), [0, 4, 8, 12]) },
  { label: 'Galopp', description: 'x.xx pro Zählzeit – rollender Bass', steps: 16, cells: () => cellsFromPositions(16, [0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15]) },
  { label: 'Triolen', description: 'Achtel-Triolen (12 Steps)', steps: 12, cells: () => cellsFromPositions(12, Array.from({ length: 12 }, (_, i) => i), [0, 3, 6, 9]) },
  { label: 'Tresillo 3/8', description: 'x..x..x. – Basis vieler Techno-Basslines', steps: 8, cells: () => euclidCells(8, 3) },
  { label: 'Cinquillo 5/8', description: 'x.xx.xx. – treibend', steps: 8, cells: () => euclidCells(8, 5) },
  { label: 'Clave 3-2', description: 'Son-Clave über einen Takt', steps: 16, cells: () => cellsFromPositions(16, [0, 3, 6, 10, 12]) },
  { label: 'Bossa 5/16', description: 'Weit verteilte, schwebende Akzente', steps: 16, cells: () => euclidCells(16, 5) },
  { label: 'Aksak 4/9', description: 'Hinkender 2-2-2-3-Rhythmus', steps: 9, cells: () => euclidCells(9, 4) },
  { label: 'Dauerton', description: 'Ein Anschlag, der den ganzen Zyklus gehalten wird', steps: 16, cells: () => [GRID_HIT, ...new Array<GridCell>(15).fill(GRID_TIE)] },
];

interface StepGridEditorProps {
  readonly params: Record<string, number>;
  readonly color: string;
  /** Länge des Layer-Zyklus in Beats (für die Beat-Markierungen). */
  readonly cycleBeats: number;
  readonly disabled?: boolean;
  readonly onCommit: (patch: Record<string, number>, label: string) => void;
}

export function StepGridEditor({ params, color, cycleBeats, disabled, onCommit }: StepGridEditorProps) {
  const steps = Math.max(1, Math.min(GRID_MAX_STEPS, Math.round(params.steps ?? 16)));
  const stored = readGridCells(params, steps);
  const [tool, setTool] = useState<GridTool>(GRID_HIT);
  const [draft, setDraft] = useState<GridCell[] | null>(null);
  const paintRef = useRef<{ value: GridCell } | null>(null);
  const draftRef = useRef<GridCell[] | null>(null);
  const [euclidK, setEuclidK] = useState(5);

  const cells = draft ?? stored;

  const commitCells = (next: GridCell[], label: string) => onCommit(gridParamsFromCells(next), label);

  // Malen per Ziehen: Ende der Geste (auch außerhalb des Rasters) übernimmt den Entwurf.
  useEffect(() => {
    const end = () => {
      if (!paintRef.current) return;
      paintRef.current = null;
      const d = draftRef.current;
      draftRef.current = null;
      setDraft(null);
      if (d) commitCells(d, 'Rhythmus gemalt');
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  });

  const paintAt = (idx: number) => {
    const p = paintRef.current;
    if (!p) return;
    const base = draftRef.current ?? stored;
    if (base[idx] === p.value) return;
    const next = [...base];
    next[idx] = p.value;
    draftRef.current = next;
    setDraft(next);
  };

  const startPaint = (idx: number) => {
    if (disabled) return;
    const value: GridCell = stored[idx] === tool ? GRID_OFF : tool;
    paintRef.current = { value };
    draftRef.current = [...stored];
    paintAt(idx);
  };

  const setSteps = (n: number) => {
    const next = Math.max(1, Math.min(GRID_MAX_STEPS, Math.round(n)));
    if (next === steps) return;
    // Muster bleibt erhalten (bei weniger Steps werden die hinteren ausgeblendet).
    onCommit({ steps: next }, `Unterteilungen: ${next}`);
  };

  const rotate = (dir: -1 | 1) => {
    const next = cells.map((_, i) => cells[(i - dir + steps) % steps]!);
    commitCells(next, dir > 0 ? 'Muster nach rechts' : 'Muster nach links');
  };

  const stepsPerBeat = cycleBeats > 0 ? steps / cycleBeats : 0;
  const groupSize =
    Number.isInteger(stepsPerBeat) && stepsPerBeat >= 2 && stepsPerBeat <= 16
      ? stepsPerBeat
      : steps % 4 === 0
        ? 4
        : steps % 3 === 0
          ? 3
          : steps;
  const rowSize = steps <= 16 ? steps : steps % 16 === 0 ? 16 : steps % 12 === 0 ? 12 : 16;
  const hitCount = cells.filter((c) => c === GRID_HIT || c === GRID_ACCENT).length;
  const stepLabel =
    stepsPerBeat > 0
      ? Number.isInteger(1 / stepsPerBeat)
        ? `1 Step = ${1 / stepsPerBeat} Beat${1 / stepsPerBeat === 1 ? '' : 's'}`
        : `${Number.isInteger(stepsPerBeat) ? stepsPerBeat : stepsPerBeat.toFixed(2)} Steps pro Beat`
      : '';

  return (
    <div className={`step-grid-editor${disabled ? ' is-disabled' : ''}`}>
      <div className="step-grid-row-controls">
        <span className="muted-note">Unterteilungen</span>
        <input
          type="number"
          min={1}
          max={GRID_MAX_STEPS}
          step={1}
          value={steps}
          style={{ width: 52 }}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) setSteps(v);
          }}
          title="Anzahl der Steps im Layer-Zyklus (1–64)"
        />
        <div className="preset-chips">
          {STEP_CHIPS.map((n) => (
            <button
              key={n}
              type="button"
              className={`preset-chip${n === steps ? ' is-active' : ''}`}
              onClick={() => setSteps(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="muted-note">
        {hitCount} Schläge auf {steps} Steps{stepLabel ? ` · ${stepLabel}` : ''}
      </div>

      <div className="step-grid-row-controls">
        <div className="segmented" role="group" aria-label="Klick-Werkzeug">
          {TOOLS.map((t) => (
            <button
              key={t.value}
              type="button"
              className={tool === t.value ? 'is-active' : undefined}
              onClick={() => setTool(t.value)}
              title={t.hint}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="muted-note">klicken oder ziehen</span>
      </div>

      <div
        className="step-grid"
        style={{ gridTemplateColumns: `repeat(${rowSize}, minmax(0, 1fr))` }}
      >
        {cells.map((c, i) => {
          const isGroupStart = i % groupSize === 0;
          const prevActive = i > 0 && cells[i - 1] !== GRID_OFF;
          const orphanTie = c === GRID_TIE && !prevActive && !(i === 0 && cells[steps - 1] !== GRID_OFF);
          const cls =
            c === GRID_ACCENT
              ? ' is-accent'
              : c === GRID_HIT
                ? ' is-hit'
                : c === GRID_TIE
                  ? orphanTie
                    ? ' is-tie is-orphan'
                    : ' is-tie'
                  : '';
          return (
            <button
              key={i}
              type="button"
              className={`step-cell${cls}${isGroupStart ? ' is-beat' : ''}`}
              style={c !== GRID_OFF ? ({ '--cell-color': color } as CSSProperties) : undefined}
              title={`Step ${i + 1}${
                c === GRID_ACCENT ? ' · Akzent' : c === GRID_HIT ? ' · Schlag' : c === GRID_TIE ? ' · Halten' : ''
              }${orphanTie ? ' (ohne vorherigen Ton – wirkungslos)' : ''}`}
              onPointerDown={(e) => {
                e.preventDefault();
                (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
                startPaint(i);
              }}
              onPointerEnter={() => paintAt(i)}
              disabled={disabled}
            >
              {c === GRID_TIE ? '–' : c === GRID_ACCENT ? '>' : ''}
            </button>
          );
        })}
      </div>

      <div className="step-grid-row-controls">
        <button type="button" className="btn-sm" onClick={() => rotate(-1)} title="Muster einen Step nach links">
          <ChevronLeft size={12} />
        </button>
        <button type="button" className="btn-sm" onClick={() => rotate(1)} title="Muster einen Step nach rechts">
          <ChevronRight size={12} />
        </button>
        <button
          type="button"
          className="btn-sm"
          onClick={() => commitCells(new Array<GridCell>(steps).fill(GRID_OFF), 'Raster geleert')}
          title="Alle Schläge entfernen"
        >
          <Eraser size={11} /> Leeren
        </button>
        <button
          type="button"
          className="btn-sm"
          onClick={() =>
            commitCells(
              cells.map((c) => (c === GRID_OFF ? GRID_HIT : c === GRID_TIE ? GRID_TIE : GRID_OFF)),
              'Raster umgekehrt',
            )
          }
          title="Schläge und Pausen tauschen"
        >
          <FlipHorizontal2 size={11} /> Umkehren
        </button>
        <span className="muted-note" style={{ marginLeft: 4 }}>Euklid</span>
        <input
          type="number"
          min={0}
          max={steps}
          value={Math.min(euclidK, steps)}
          style={{ width: 44 }}
          onChange={(e) => setEuclidK(Math.max(0, Math.min(GRID_MAX_STEPS, Number(e.target.value) || 0)))}
          title="Wie viele Schläge gleichmäßig verteilt werden sollen"
        />
        <button
          type="button"
          className="btn-sm"
          onClick={() => commitCells(euclidCells(steps, Math.min(euclidK, steps)), `Euklid ${euclidK}/${steps}`)}
          title="Verteilt die Schläge so gleichmäßig wie möglich auf die Steps (ersetzt das Muster)"
        >
          verteilen
        </button>
      </div>
    </div>
  );
}
