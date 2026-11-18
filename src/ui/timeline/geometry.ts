import type { ArrangementDoc, AutomationLane, AutomationTarget } from '../../core/arrangement/types';

export const HEADER_WIDTH = 196;
export const RULER_HEIGHT = 40;
export const DEFAULT_TRACK_HEIGHT = 62;
export const LANE_HEIGHT = 48;
export const MASTER_ROW_HEIGHT = 34;
export const EDGE_GRAB_PX = 6;
export const MIN_PX_PER_BEAT = 2;
export const MAX_PX_PER_BEAT = 240;
export const DEFAULT_PX_PER_BEAT = 16;

export type TimelineRow =
  | { readonly kind: 'track'; readonly trackId: string; readonly index: number; readonly top: number; readonly height: number }
  | {
      readonly kind: 'lane';
      readonly lane: AutomationLane;
      readonly trackId: string | null;
      readonly top: number;
      readonly height: number;
    }
  | { readonly kind: 'master'; readonly top: number; readonly height: number };

/** Track id an automation target belongs to (null = master). */
export function laneOwnerTrackId(doc: ArrangementDoc, target: AutomationTarget): string | null {
  if (target.scope === 'track' || target.scope === 'track-fx') return target.trackId;
  if (target.scope === 'clip-layer' || target.scope === 'clip-layer-param') {
    for (const t of doc.tracks) if (t.clips.some((c) => c.id === target.clipId)) return t.id;
  }
  return null;
}

/** Vertical layout of all rows (tracks, their open automation lanes, master). */
export function computeRows(
  doc: ArrangementDoc,
  openAutomation: ReadonlySet<string>,
  masterOpen: boolean,
): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let top = 0;
  doc.tracks.forEach((t, index) => {
    const h = t.heightPx ?? DEFAULT_TRACK_HEIGHT;
    rows.push({ kind: 'track', trackId: t.id, index, top, height: h });
    top += h;
    if (openAutomation.has(t.id)) {
      for (const lane of doc.automation) {
        if (laneOwnerTrackId(doc, lane.target) !== t.id) continue;
        rows.push({ kind: 'lane', lane, trackId: t.id, top, height: LANE_HEIGHT });
        top += LANE_HEIGHT;
      }
    }
  });
  rows.push({ kind: 'master', top, height: MASTER_ROW_HEIGHT });
  top += MASTER_ROW_HEIGHT;
  if (masterOpen) {
    for (const lane of doc.automation) {
      if (lane.target.scope !== 'master' && lane.target.scope !== 'master-fx') continue;
      rows.push({ kind: 'lane', lane, trackId: null, top, height: LANE_HEIGHT });
      top += LANE_HEIGHT;
    }
  }
  return rows;
}

export function rowsHeight(rows: readonly TimelineRow[]): number {
  const last = rows[rows.length - 1];
  return last ? last.top + last.height : 0;
}

/** Track row at a y position inside the lanes area (or null). */
export function trackAtY(rows: readonly TimelineRow[], y: number): string | null {
  for (const r of rows) {
    if (y >= r.top && y < r.top + r.height) return r.kind === 'track' ? r.trackId : null;
  }
  return null;
}

export function formatBeatsAsBars(beats: number, beatsPerBar: number): string {
  const bars = beats / beatsPerBar;
  const v = Number.isInteger(bars) ? `${bars}` : bars.toFixed(2).replace(/\.?0+$/, '');
  return `${v} ${Math.abs(bars - 1) < 1e-9 ? 'Takt' : 'Takte'}`;
}
