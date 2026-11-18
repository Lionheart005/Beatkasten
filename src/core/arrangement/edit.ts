/**
 * Pure, immutable editing operations on an ArrangementDoc (split, trim, move,
 * duplicate, markers …). Keeps undo, tests and the UI simple.
 */
import type { ProcessorCardConfig } from '../state/types';
import type { TempoMap } from './tempoMap';
import {
  clipEndBeat,
  DEFAULT_FADE,
  TRACK_COLORS,
  type ArrangementClip,
  type ArrangementDoc,
  type ArrangementTrack,
  type AudioClip,
  type AutomationLane,
  type AutomationTarget,
  type Keyframe,
  type MeterMarker,
  type SectionClip,
  type SongMarker,
  type TempoMarker,
  type TrackKind,
} from './types';

export type IdFactory = (prefix: string) => string;

export const MIN_CLIP_BEATS = 1 / 32;

const EPS = 1e-9;

export function createTrack(
  kind: TrackKind,
  makeId: IdFactory,
  index: number,
  name?: string,
): ArrangementTrack {
  return {
    id: makeId('track'),
    name: name ?? (kind === 'audio' ? `Audio ${index + 1}` : `Spur ${index + 1}`),
    color: TRACK_COLORS[index % TRACK_COLORS.length]!,
    kind,
    muted: false,
    solo: false,
    level: 1,
    pan: 0,
    fx: [],
    clips: [],
  };
}

export function createSectionClip(
  makeId: IdFactory,
  sectionId: string,
  startBeat: number,
  lengthBeats: number,
): SectionClip {
  return {
    id: makeId('clip'),
    kind: 'section',
    sectionId,
    startBeat: Math.max(0, startBeat),
    lengthBeats: Math.max(MIN_CLIP_BEATS, lengthBeats),
    sourceOffsetBeats: 0,
    gain: 1,
    fadeIn: DEFAULT_FADE,
    fadeOut: DEFAULT_FADE,
    layerOverrides: {},
  };
}

export function findClip(
  doc: ArrangementDoc,
  clipId: string,
): { track: ArrangementTrack; clip: ArrangementClip; trackIndex: number } | null {
  for (let t = 0; t < doc.tracks.length; t++) {
    const track = doc.tracks[t]!;
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip, trackIndex: t };
  }
  return null;
}

export function songEndBeat(doc: ArrangementDoc): number {
  let end = 0;
  for (const t of doc.tracks) {
    for (const c of t.clips) end = Math.max(end, clipEndBeat(c) + ((c.kind === 'section' && c.tailBeats) || 0));
  }
  return end;
}

const sortClips = (clips: readonly ArrangementClip[]): ArrangementClip[] =>
  [...clips].sort((a, b) => a.startBeat - b.startBeat);

function mapTracks(
  doc: ArrangementDoc,
  fn: (track: ArrangementTrack) => ArrangementTrack,
): ArrangementDoc {
  let changed = false;
  const tracks = doc.tracks.map((t) => {
    const n = fn(t);
    if (n !== t) changed = true;
    return n;
  });
  return changed ? { ...doc, tracks } : doc;
}

// --- tracks -------------------------------------------------------------

export function addTrack(doc: ArrangementDoc, track: ArrangementTrack, index?: number): ArrangementDoc {
  const tracks = [...doc.tracks];
  tracks.splice(index ?? tracks.length, 0, track);
  return { ...doc, tracks };
}

export function removeTrack(doc: ArrangementDoc, trackId: string): ArrangementDoc {
  return {
    ...doc,
    tracks: doc.tracks.filter((t) => t.id !== trackId),
    automation: doc.automation.filter(
      (l) => !('trackId' in l.target) || l.target.trackId !== trackId,
    ),
  };
}

export function updateTrack(
  doc: ArrangementDoc,
  trackId: string,
  patch: Partial<Omit<ArrangementTrack, 'id' | 'clips' | 'kind'>>,
): ArrangementDoc {
  return mapTracks(doc, (t) => (t.id === trackId ? { ...t, ...patch } : t));
}

export function moveTrack(doc: ArrangementDoc, trackId: string, toIndex: number): ArrangementDoc {
  const from = doc.tracks.findIndex((t) => t.id === trackId);
  if (from < 0) return doc;
  const tracks = [...doc.tracks];
  const [t] = tracks.splice(from, 1);
  tracks.splice(Math.max(0, Math.min(tracks.length, toIndex)), 0, t!);
  return { ...doc, tracks };
}

export function setTrackFx(
  doc: ArrangementDoc,
  trackId: string,
  fx: readonly ProcessorCardConfig[],
): ArrangementDoc {
  return mapTracks(doc, (t) => (t.id === trackId ? { ...t, fx } : t));
}

// --- clips --------------------------------------------------------------

export function addClip(doc: ArrangementDoc, trackId: string, clip: ArrangementClip): ArrangementDoc {
  return mapTracks(doc, (t) =>
    t.id === trackId && t.kind === clip.kind ? { ...t, clips: sortClips([...t.clips, clip]) } : t,
  );
}

export function updateClip(
  doc: ArrangementDoc,
  clipId: string,
  patch: Partial<SectionClip> | Partial<AudioClip>,
): ArrangementDoc {
  return mapTracks(doc, (t) => {
    if (!t.clips.some((c) => c.id === clipId)) return t;
    return {
      ...t,
      clips: sortClips(
        t.clips.map((c) => (c.id === clipId ? ({ ...c, ...patch, id: c.id, kind: c.kind } as ArrangementClip) : c)),
      ),
    };
  });
}

export function removeClips(doc: ArrangementDoc, clipIds: readonly string[]): ArrangementDoc {
  const ids = new Set(clipIds);
  const next = mapTracks(doc, (t) =>
    t.clips.some((c) => ids.has(c.id)) ? { ...t, clips: t.clips.filter((c) => !ids.has(c.id)) } : t,
  );
  if (next === doc) return doc;
  return {
    ...next,
    automation: next.automation.filter(
      (l) => !('clipId' in l.target) || !ids.has(l.target.clipId),
    ),
  };
}

/** Moves clips by `deltaBeats` (and optionally to another track of the same kind). */
export function moveClips(
  doc: ArrangementDoc,
  clipIds: readonly string[],
  deltaBeats: number,
  toTrackId?: string,
): ArrangementDoc {
  const ids = new Set(clipIds);
  // Never move a clip before beat 0: clamp the whole group.
  let minStart = Infinity;
  for (const t of doc.tracks) for (const c of t.clips) if (ids.has(c.id)) minStart = Math.min(minStart, c.startBeat);
  if (!Number.isFinite(minStart)) return doc;
  const delta = Math.max(-minStart, deltaBeats);
  const target = toTrackId ? doc.tracks.find((t) => t.id === toTrackId) : undefined;
  const moved: ArrangementClip[] = [];
  let next = mapTracks(doc, (t) => {
    if (!t.clips.some((c) => ids.has(c.id))) return t;
    const keep: ArrangementClip[] = [];
    for (const c of t.clips) {
      if (!ids.has(c.id)) {
        keep.push(c);
        continue;
      }
      const m = { ...c, startBeat: c.startBeat + delta };
      if (target && target.id !== t.id && target.kind === c.kind) moved.push(m);
      else keep.push(m);
    }
    return { ...t, clips: sortClips(keep) };
  });
  if (target && moved.length > 0) {
    next = mapTracks(next, (t) => (t.id === target.id ? { ...t, clips: sortClips([...t.clips, ...moved]) } : t));
  }
  return next;
}

/**
 * Splits a clip at `atBeat`. The right part continues exactly where the left
 * one stops (offset), so playback runs on seamlessly.
 */
export function splitClip(
  doc: ArrangementDoc,
  clipId: string,
  atBeat: number,
  makeId: IdFactory,
  tempoMap?: TempoMap,
): { doc: ArrangementDoc; rightId: string | null } {
  const found = findClip(doc, clipId);
  if (!found) return { doc, rightId: null };
  const { clip } = found;
  const end = clipEndBeat(clip);
  if (atBeat <= clip.startBeat + MIN_CLIP_BEATS - EPS || atBeat >= end - MIN_CLIP_BEATS + EPS) {
    return { doc, rightId: null };
  }
  const leftLen = atBeat - clip.startBeat;
  const rightId = makeId('clip');
  const left: ArrangementClip = { ...clip, lengthBeats: leftLen, fadeOut: DEFAULT_FADE };
  let right: ArrangementClip;
  if (clip.kind === 'section') {
    right = {
      ...clip,
      id: rightId,
      startBeat: atBeat,
      lengthBeats: end - atBeat,
      sourceOffsetBeats: clip.sourceOffsetBeats + leftLen,
      fadeIn: DEFAULT_FADE,
    };
  } else {
    const secShift = tempoMap ? tempoMap.beatToSec(atBeat) - tempoMap.beatToSec(clip.startBeat) : 0;
    right = {
      ...clip,
      id: rightId,
      startBeat: atBeat,
      lengthBeats: end - atBeat,
      sourceOffsetSec: clip.sourceOffsetSec + secShift,
      fadeIn: DEFAULT_FADE,
    };
  }
  const next = mapTracks(doc, (t) =>
    t.id === found.track.id
      ? { ...t, clips: sortClips([...t.clips.filter((c) => c.id !== clipId), left, right]) }
      : t,
  );
  return { doc: next, rightId };
}

/** Moves the left edge (content stays in place: the offset changes too). */
export function trimClipStart(
  doc: ArrangementDoc,
  clipId: string,
  newStartBeat: number,
  tempoMap?: TempoMap,
): ArrangementDoc {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  const { clip } = found;
  const end = clipEndBeat(clip);
  let start = Math.min(end - MIN_CLIP_BEATS, Math.max(0, newStartBeat));
  if (clip.kind === 'section') {
    // The left edge can reveal the loop back to its beginning (offset 0), not further.
    start = Math.max(start, clip.startBeat - clip.sourceOffsetBeats);
    const delta = start - clip.startBeat;
    return updateClip(doc, clipId, {
      startBeat: start,
      lengthBeats: end - start,
      sourceOffsetBeats: Math.max(0, clip.sourceOffsetBeats + delta),
    });
  }
  const secDelta = tempoMap ? tempoMap.beatToSec(start) - tempoMap.beatToSec(clip.startBeat) : 0;
  if (clip.sourceOffsetSec + secDelta < 0 && tempoMap) {
    // Cannot reveal audio before the file start.
    const minStartSec = tempoMap.beatToSec(clip.startBeat) - clip.sourceOffsetSec;
    start = tempoMap.secToBeat(minStartSec);
  }
  const secShift = tempoMap ? tempoMap.beatToSec(start) - tempoMap.beatToSec(clip.startBeat) : 0;
  return updateClip(doc, clipId, {
    startBeat: start,
    lengthBeats: end - start,
    sourceOffsetSec: Math.max(0, clip.sourceOffsetSec + secShift),
  });
}

export function trimClipEnd(doc: ArrangementDoc, clipId: string, newEndBeat: number): ArrangementDoc {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  const len = Math.max(MIN_CLIP_BEATS, newEndBeat - found.clip.startBeat);
  return updateClip(doc, clipId, { lengthBeats: len });
}

export function duplicateClips(
  doc: ArrangementDoc,
  clipIds: readonly string[],
  makeId: IdFactory,
  offsetBeats?: number,
): { doc: ArrangementDoc; newIds: string[] } {
  const ids = new Set(clipIds);
  let groupStart = Infinity;
  let groupEnd = -Infinity;
  for (const t of doc.tracks)
    for (const c of t.clips)
      if (ids.has(c.id)) {
        groupStart = Math.min(groupStart, c.startBeat);
        groupEnd = Math.max(groupEnd, clipEndBeat(c));
      }
  if (!Number.isFinite(groupStart)) return { doc, newIds: [] };
  const shift = offsetBeats ?? groupEnd - groupStart;
  const newIds: string[] = [];
  const next = mapTracks(doc, (t) => {
    const copies = t.clips
      .filter((c) => ids.has(c.id))
      .map((c) => {
        const id = makeId('clip');
        newIds.push(id);
        return { ...c, id, startBeat: c.startBeat + shift };
      });
    return copies.length > 0 ? { ...t, clips: sortClips([...t.clips, ...copies]) } : t;
  });
  return { doc: next, newIds };
}

/** Pastes copied clips (relative positions kept) at `atBeat` onto their tracks. */
export function pasteClips(
  doc: ArrangementDoc,
  items: ReadonlyArray<{ trackId: string; clip: ArrangementClip }>,
  atBeat: number,
  makeId: IdFactory,
): { doc: ArrangementDoc; newIds: string[] } {
  if (items.length === 0) return { doc, newIds: [] };
  const base = Math.min(...items.map((i) => i.clip.startBeat));
  let next = doc;
  const newIds: string[] = [];
  for (const it of items) {
    const id = makeId('clip');
    newIds.push(id);
    next = addClip(next, it.trackId, { ...it.clip, id, startBeat: atBeat + it.clip.startBeat - base });
  }
  return { doc: next, newIds };
}

// --- markers ------------------------------------------------------------

export function setTempoMarker(doc: ArrangementDoc, beat: number, bpm: number, makeId: IdFactory): ArrangementDoc {
  const b = Math.max(0, beat);
  const others = doc.tempoMarkers.filter((m) => Math.abs(m.beat - b) > EPS);
  const existing = doc.tempoMarkers.find((m) => Math.abs(m.beat - b) <= EPS);
  const marker: TempoMarker = { id: existing?.id ?? makeId('tempo'), beat: b, bpm };
  return { ...doc, tempoMarkers: [...others, marker].sort((x, y) => x.beat - y.beat) };
}

export function removeTempoMarker(doc: ArrangementDoc, markerId: string): ArrangementDoc {
  const m = doc.tempoMarkers.find((x) => x.id === markerId);
  if (!m || m.beat <= EPS) return doc; // the first marker stays
  return { ...doc, tempoMarkers: doc.tempoMarkers.filter((x) => x.id !== markerId) };
}

export function setMeterMarker(
  doc: ArrangementDoc,
  beat: number,
  numerator: number,
  denominator: number,
  makeId: IdFactory,
): ArrangementDoc {
  const b = Math.max(0, beat);
  const others = doc.meterMarkers.filter((m) => Math.abs(m.beat - b) > EPS);
  const existing = doc.meterMarkers.find((m) => Math.abs(m.beat - b) <= EPS);
  const marker: MeterMarker = { id: existing?.id ?? makeId('meter'), beat: b, numerator, denominator };
  return { ...doc, meterMarkers: [...others, marker].sort((x, y) => x.beat - y.beat) };
}

export function removeMeterMarker(doc: ArrangementDoc, markerId: string): ArrangementDoc {
  const m = doc.meterMarkers.find((x) => x.id === markerId);
  if (!m || m.beat <= EPS) return doc;
  return { ...doc, meterMarkers: doc.meterMarkers.filter((x) => x.id !== markerId) };
}

export function addSongMarker(doc: ArrangementDoc, marker: SongMarker): ArrangementDoc {
  return { ...doc, songMarkers: [...doc.songMarkers, marker].sort((a, b) => a.beat - b.beat) };
}

export function updateSongMarker(doc: ArrangementDoc, id: string, patch: Partial<SongMarker>): ArrangementDoc {
  return {
    ...doc,
    songMarkers: doc.songMarkers
      .map((m) => (m.id === id ? { ...m, ...patch, id } : m))
      .sort((a, b) => a.beat - b.beat),
  };
}

export function removeSongMarker(doc: ArrangementDoc, id: string): ArrangementDoc {
  return { ...doc, songMarkers: doc.songMarkers.filter((m) => m.id !== id) };
}

/** IDs of all sections referenced by clips. */
export function referencedSectionIds(doc: ArrangementDoc): Set<string> {
  const out = new Set<string>();
  for (const t of doc.tracks) for (const c of t.clips) if (c.kind === 'section') out.add(c.sectionId);
  return out;
}

// --- automation ---------------------------------------------------------

export function sameAutomationTarget(a: AutomationTarget, b: AutomationTarget): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function findLane(doc: ArrangementDoc, target: AutomationTarget): AutomationLane | undefined {
  return doc.automation.find((l) => sameAutomationTarget(l.target, target));
}

/** Creates a lane for the target if none exists (with one point holding `initialValue`). */
export function ensureAutomationLane(
  doc: ArrangementDoc,
  target: AutomationTarget,
  initialValue: number,
  makeId: IdFactory,
  atBeat = 0,
  curve: Keyframe['curve'] = target.scope === 'clip-layer' && target.param === 'enabled' ? 'hold' : 'linear',
): { doc: ArrangementDoc; laneId: string } {
  const existing = findLane(doc, target);
  if (existing) return { doc, laneId: existing.id };
  const lane: AutomationLane = {
    id: makeId('lane'),
    target,
    enabled: true,
    points: [{ beat: Math.max(0, atBeat), value: initialValue, curve }],
  };
  return { doc: { ...doc, automation: [...doc.automation, lane] }, laneId: lane.id };
}

export function updateLane(
  doc: ArrangementDoc,
  laneId: string,
  patch: Partial<Omit<AutomationLane, 'id' | 'target'>>,
): ArrangementDoc {
  return {
    ...doc,
    automation: doc.automation.map((l) =>
      l.id === laneId
        ? { ...l, ...patch, points: patch.points ? [...patch.points].sort((a, b) => a.beat - b.beat) : l.points }
        : l,
    ),
  };
}

export function removeLane(doc: ArrangementDoc, laneId: string): ArrangementDoc {
  return { ...doc, automation: doc.automation.filter((l) => l.id !== laneId) };
}

/** Removes everything a transition template generated (keyframes lanes + clips). */
export function removeGenerated(doc: ArrangementDoc, generatedBy: string): ArrangementDoc {
  return {
    ...doc,
    automation: doc.automation.filter((l) => l.generatedBy !== generatedBy),
    tracks: doc.tracks.map((t) =>
      t.clips.some((c) => c.generatedBy === generatedBy)
        ? { ...t, clips: t.clips.filter((c) => c.generatedBy !== generatedBy) }
        : t,
    ),
  };
}

export function createAudioClip(
  makeId: IdFactory,
  assetId: string,
  startBeat: number,
  lengthBeats: number,
  sourceOffsetSec = 0,
): AudioClip {
  return {
    id: makeId('clip'),
    kind: 'audio',
    assetId,
    startBeat: Math.max(0, startBeat),
    lengthBeats: Math.max(MIN_CLIP_BEATS, lengthBeats),
    sourceOffsetSec: Math.max(0, sourceOffsetSec),
    gain: 1,
    fadeIn: DEFAULT_FADE,
    fadeOut: DEFAULT_FADE,
  };
}

/** Length in beats of `seconds` of audio placed at `startBeat` (no time-stretch). */
export function secondsToBeatsAt(tempoMap: TempoMap, startBeat: number, seconds: number): number {
  return tempoMap.secToBeat(tempoMap.beatToSec(startBeat) + seconds) - startBeat;
}

/** IDs of all assets referenced by clips (incl. frozen section clips). */
export function referencedAssetIds(doc: ArrangementDoc): Set<string> {
  const out = new Set<string>();
  for (const t of doc.tracks)
    for (const c of t.clips) {
      if (c.kind === 'audio') out.add(c.assetId);
      else if (c.frozenAssetId) out.add(c.frozenAssetId);
    }
  return out;
}
