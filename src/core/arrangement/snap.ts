/**
 * Magnetic grid for the timeline: bar lines follow the meter markers, note
 * values are in quarter-note beats. Candidate snapping (clip edges, playhead,
 * markers) is done in pixels by the UI via `snapToCandidates`.
 */
import type { SnapGrid } from './types';
import type { TempoMap } from './tempoMap';

export const SNAP_GRID_LABELS: Readonly<Record<SnapGrid, string>> = {
  off: 'Aus',
  bar: 'Takt',
  '1/2': '1/2',
  '1/4': 'Beat (1/4)',
  '1/8': '1/8',
  '1/16': '1/16',
  '1/32': '1/32',
  '1/4T': '1/4 Triole',
  '1/8T': '1/8 Triole',
  '1/16T': '1/16 Triole',
};

/** Grid step in beats for note-value grids (null for 'off' and 'bar'). */
export function gridStepBeats(grid: SnapGrid): number | null {
  switch (grid) {
    case '1/2':
      return 2;
    case '1/4':
      return 1;
    case '1/8':
      return 0.5;
    case '1/16':
      return 0.25;
    case '1/32':
      return 0.125;
    case '1/4T':
      return 2 / 3;
    case '1/8T':
      return 1 / 3;
    case '1/16T':
      return 1 / 6;
    default:
      return null;
  }
}

/** Snaps a beat to the grid (note values count from the start of the bar). */
export function snapBeat(beat: number, grid: SnapGrid, tempoMap: TempoMap): number {
  if (grid === 'off' || !Number.isFinite(beat)) return beat;
  const pos = tempoMap.barPosition(beat);
  const barStart = beat - pos.beatInBar;
  if (grid === 'bar') {
    const next = tempoMap.barStartBeat(pos.bar + 1);
    return beat - barStart <= next - beat ? barStart : next;
  }
  const step = gridStepBeats(grid)!;
  const snapped = barStart + Math.round(pos.beatInBar / step) * step;
  // Never snap past the next bar line (odd meters like 7/8).
  const next = tempoMap.barStartBeat(pos.bar + 1);
  return Math.min(snapped, next);
}

/** Size of one grid step at `beat` (used by arrow-key nudging). */
export function gridStepAt(beat: number, grid: SnapGrid, tempoMap: TempoMap): number {
  if (grid === 'bar') return tempoMap.beatsPerBarAt(beat);
  return gridStepBeats(grid) ?? 0.25;
}

/**
 * Snaps to the nearest candidate (clip edges, playhead, markers) if it is
 * within `toleranceBeats`, otherwise to the grid.
 */
export function snapToCandidates(
  beat: number,
  candidates: readonly number[],
  toleranceBeats: number,
  grid: SnapGrid,
  tempoMap: TempoMap,
): number {
  let best = beat;
  let bestDist = toleranceBeats;
  for (const c of candidates) {
    const d = Math.abs(c - beat);
    if (d <= bestDist) {
      bestDist = d;
      best = c;
    }
  }
  if (best !== beat) return best;
  return snapBeat(beat, grid, tempoMap);
}
