/**
 * Transition templates ("Übergangs-Vorlagen"). They only create ordinary,
 * editable things — keyframe lanes, fades, dedicated effect cards, clip edits —
 * all tagged with a run id (`generatedBy`, card ids prefixed with it), so a
 * template can be removed again as a group.
 */
import { defaultRegistry } from '../defaultRegistry';
import { buildDefaultParams } from '../registry/types';
import type { ProcessorCardConfig } from '../state/types';
import { removeGenerated, trimClipEnd, trimClipStart, updateClip, updateTrack, type IdFactory } from './edit';
import type { TempoMap } from './tempoMap';
import { clipEndBeat, type ArrangementClip, type ArrangementDoc, type AutomationLane, type Keyframe } from './types';

export type TransitionId =
  | 'crossfade'
  | 'fade'
  | 'filter-down'
  | 'filter-up'
  | 'highpass-build'
  | 'echo-out'
  | 'reverb-wash'
  | 'break'
  | 'tape-stop'
  | 'stutter'
  | 'riser';

export interface TransitionTemplate {
  readonly id: TransitionId;
  readonly label: string;
  readonly hint: string;
}

export const TRANSITIONS: readonly TransitionTemplate[] = [
  { id: 'crossfade', label: 'Überblenden', hint: 'Die Clips überlappen und blenden mit gleicher Lautheit ineinander.' },
  { id: 'fade', label: 'Aus- & Einblenden', hint: 'Der alte Clip blendet aus, der neue ein.' },
  { id: 'filter-down', label: 'Filter-Fahrt runter', hint: 'Tiefpass schließt sich bis zur Grenze, danach wieder offen.' },
  { id: 'filter-up', label: 'Filter-Fahrt rauf', hint: 'Der neue Teil startet dumpf und öffnet sich.' },
  { id: 'highpass-build', label: 'Hochpass-Aufbau', hint: 'Bässe verschwinden vor dem Drop und kommen schlagartig zurück.' },
  { id: 'echo-out', label: 'Echo-Ausklang', hint: 'Der alte Clip verschwindet im Echo.' },
  { id: 'reverb-wash', label: 'Hall-Wash', hint: 'Der Hall schwillt an und klingt nach der Grenze aus.' },
  { id: 'break', label: 'Break (Pause)', hint: 'Ein halber Takt Stille vor dem neuen Teil.' },
  { id: 'tape-stop', label: 'Bremse (Tape-Stop)', hint: 'Das Band läuft bis zur Grenze aus.' },
  { id: 'stutter', label: 'Stottern', hint: 'Die letzten Beats wiederholen ein kurzes Stück.' },
  { id: 'riser', label: 'Riser', hint: 'Ein Rausch-Riser steigt bis zur Grenze an (eigene Spur).' },
];

export interface Boundary {
  readonly beat: number;
  /** Clip that ends at the boundary (if any). */
  readonly before: ArrangementClip | null;
  /** Clip that starts at the boundary (if any). */
  readonly after: ArrangementClip | null;
}

/** Nearest clip edge on a track (start or end of any clip). */
export function findBoundary(doc: ArrangementDoc, trackId: string, nearBeat: number): Boundary | null {
  const track = doc.tracks.find((t) => t.id === trackId);
  if (!track || track.clips.length === 0) return null;
  let best = Infinity;
  let beat = 0;
  for (const c of track.clips) {
    for (const b of [c.startBeat, clipEndBeat(c)]) {
      const d = Math.abs(b - nearBeat);
      if (d < best) {
        best = d;
        beat = b;
      }
    }
  }
  const eps = 1e-6;
  const before = track.clips.find((c) => Math.abs(clipEndBeat(c) - beat) < eps) ?? null;
  const after = track.clips.find((c) => Math.abs(c.startBeat - beat) < eps) ?? null;
  return { beat, before, after };
}

function addCard(
  doc: ArrangementDoc,
  trackId: string,
  runId: string,
  moduleId: string,
  params: Record<string, number>,
): { doc: ArrangementDoc; cardId: string } {
  const mod = defaultRegistry.getProcessor(moduleId);
  const cardId = `${runId}:${moduleId}`;
  if (!mod) return { doc, cardId };
  const card: ProcessorCardConfig = {
    id: cardId,
    moduleId,
    version: mod.version,
    bypassed: false,
    params: { ...buildDefaultParams(mod), ...params },
  };
  const track = doc.tracks.find((t) => t.id === trackId)!;
  return { doc: updateTrack(doc, trackId, { fx: [...track.fx, card] }), cardId };
}

function addLane(
  doc: ArrangementDoc,
  trackId: string,
  cardId: string,
  paramId: string,
  points: Keyframe[],
  runId: string,
  makeId: IdFactory,
): ArrangementDoc {
  const lane: AutomationLane = {
    id: makeId('lane'),
    target: { scope: 'track-fx', trackId, cardId, paramId },
    enabled: true,
    points: points.filter((p) => p.beat >= 0).sort((a, b) => a.beat - b.beat),
    generatedBy: runId,
  };
  return { ...doc, automation: [...doc.automation, lane] };
}

const kf = (beat: number, value: number, curve: Keyframe['curve'] = 'linear'): Keyframe => ({ beat, value, curve });

export interface ApplyTransitionArgs {
  readonly template: TransitionId;
  readonly trackId: string;
  readonly boundary: Boundary;
  readonly lengthBeats: number;
  readonly runId: string;
  readonly tempoMap: TempoMap;
  readonly makeId: IdFactory;
}

/**
 * Applies a template at a clip boundary. Returns the new document (unchanged
 * when the template does not fit, with a message for the user).
 * The 'riser' needs a section and is assembled by the UI.
 */
export function applyTransition(args: ApplyTransitionArgs): (doc: ArrangementDoc) => { doc: ArrangementDoc; message: string | null } {
  return (doc) => {
    const { template, trackId, boundary, runId, tempoMap, makeId } = args;
    const B = boundary.beat;
    const L = Math.max(0.25, args.lengthBeats);
    const pre = Math.max(0, B - L);
    const tiny = 1 / 64;
    switch (template) {
      case 'crossfade': {
        const a = boundary.before;
        const b = boundary.after;
        if (!a || !b) return { doc, message: 'Überblenden braucht einen Clip, der an der Grenze endet, und einen, der dort beginnt.' };
        const half = L / 2;
        let next = trimClipEnd(doc, a.id, B + half);
        next = trimClipStart(next, b.id, B - half, tempoMap);
        return { doc: next, message: null };
      }
      case 'fade': {
        let next = doc;
        if (boundary.before) next = updateClip(next, boundary.before.id, { fadeOut: { beats: Math.min(L, boundary.before.lengthBeats), shape: 'equal-power' } });
        if (boundary.after) next = updateClip(next, boundary.after.id, { fadeIn: { beats: Math.min(L, boundary.after.lengthBeats), shape: 'equal-power' } });
        return { doc: next, message: next === doc ? 'Kein Clip an dieser Grenze.' : null };
      }
      case 'filter-down': {
        const r = addCard(doc, trackId, runId, 'card-tone-filter', { brightness: 1, focus: 0.15, filterMode: 0, tilt: 0 });
        return {
          doc: addLane(r.doc, trackId, r.cardId, 'brightness', [kf(pre, 1, 'smooth'), kf(B - tiny, 0.08, 'hold'), kf(B, 1)], runId, makeId),
          message: null,
        };
      }
      case 'filter-up': {
        const r = addCard(doc, trackId, runId, 'card-tone-filter', { brightness: 1, focus: 0.2, filterMode: 0, tilt: 0 });
        return {
          doc: addLane(r.doc, trackId, r.cardId, 'brightness', [kf(B, 0.08, 'smooth'), kf(B + L, 1)], runId, makeId),
          message: null,
        };
      }
      case 'highpass-build': {
        const r = addCard(doc, trackId, runId, 'card-tone-filter', { brightness: 0, focus: 0.2, filterMode: 2, tilt: 0 });
        return {
          doc: addLane(r.doc, trackId, r.cardId, 'brightness', [kf(pre, 0, 'smooth'), kf(B - tiny, 0.82, 'hold'), kf(B, 0)], runId, makeId),
          message: null,
        };
      }
      case 'echo-out': {
        let next = doc;
        if (boundary.before) {
          next = updateClip(next, boundary.before.id, { fadeOut: { beats: Math.min(L / 2, boundary.before.lengthBeats), shape: 'exp' } });
        }
        const r = addCard(next, trackId, runId, 'card-tempo-echo', { mix: 0, feedback: 0.38 });
        next = addLane(r.doc, trackId, r.cardId, 'mix', [kf(pre, 0), kf(B - L / 2, 0.65, 'hold'), kf(B + L, 0.65), kf(B + L + 1, 0)], runId, makeId);
        next = addLane(next, trackId, r.cardId, 'feedback', [kf(pre, 0.38), kf(B, 0.72, 'hold'), kf(B + L, 0.72), kf(B + L + 1, 0.38)], runId, makeId);
        return { doc: next, message: null };
      }
      case 'reverb-wash': {
        const r = addCard(doc, trackId, runId, 'card-ducking-hall', { mix: 0, size: 0.8, decay: 0.75, duckAmount: 0 });
        return {
          doc: addLane(r.doc, trackId, r.cardId, 'mix', [kf(pre, 0, 'smooth'), kf(B, 0.85, 'smooth'), kf(B + L, 0)], runId, makeId),
          message: null,
        };
      }
      case 'break': {
        const a = boundary.before;
        if (!a) return { doc, message: 'Break braucht einen Clip, der an der Grenze endet.' };
        const gap = Math.min(tempoMap.beatsPerBarAt(B) / 2, a.lengthBeats - tiny);
        return { doc: trimClipEnd(doc, a.id, B - gap), message: null };
      }
      case 'tape-stop': {
        const r = addCard(doc, trackId, runId, 'card-tape-stop', { stop: 0, curve: 0.6 });
        return {
          doc: addLane(r.doc, trackId, r.cardId, 'stop', [kf(pre, 0, 'smooth'), kf(B - tiny, 1, 'hold'), kf(B, 0)], runId, makeId),
          message: null,
        };
      }
      case 'stutter': {
        const r = addCard(doc, trackId, runId, 'card-beat-repeat', { repeat: 0, division: 2, decay: 0.05, mix: 1 });
        return {
          doc: addLane(r.doc, trackId, r.cardId, 'repeat', [kf(pre, 1, 'hold'), kf(B, 0, 'hold')], runId, makeId),
          message: null,
        };
      }
      case 'riser':
        return { doc, message: null };
    }
  };
}

/** Removes a template run: its lanes, clips and dedicated cards. */
export function removeTransition(doc: ArrangementDoc, runId: string): ArrangementDoc {
  const next = removeGenerated(doc, runId);
  return {
    ...next,
    tracks: next.tracks.map((t) =>
      t.fx.some((c) => c.id.startsWith(`${runId}:`)) ? { ...t, fx: t.fx.filter((c) => !c.id.startsWith(`${runId}:`)) } : t,
    ),
    automation: next.automation.filter((l) => !('cardId' in l.target) || !l.target.cardId.startsWith(`${runId}:`)),
  };
}

/** All template runs present in the document (for the "remove" list). */
export function listTransitionRuns(doc: ArrangementDoc): string[] {
  const ids = new Set<string>();
  for (const l of doc.automation) if (l.generatedBy) ids.add(l.generatedBy);
  for (const t of doc.tracks) for (const c of t.clips) if (c.generatedBy) ids.add(c.generatedBy);
  return [...ids];
}
