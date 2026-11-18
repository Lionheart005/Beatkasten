/**
 * Creation / migration of the timeline document. Old projects have no
 * `arrangement`: the first opening of the timeline creates an empty one with
 * the tempo and meter of the active snapshot.
 */
import { createSectionClip, createTrack, type IdFactory } from '../arrangement/edit';
import { beatsPerBarOf } from '../arrangement/tempoMap';
import type { ArrangementDoc } from '../arrangement/types';
import type { BeatSnapshot, ProjectDocument, SectionItem } from './types';

export const ARRANGEMENT_VERSION = 1;

export function createEmptyArrangement(snapshot: BeatSnapshot, makeId: IdFactory): ArrangementDoc {
  return {
    version: 1,
    tempoMarkers: [{ id: makeId('tempo'), beat: 0, bpm: snapshot.tempoBpm }],
    meterMarkers: [
      {
        id: makeId('meter'),
        beat: 0,
        numerator: snapshot.timeSignature.numerator,
        denominator: snapshot.timeSignature.denominator,
      },
    ],
    songMarkers: [],
    tracks: [createTrack('section', makeId, 0, 'Spur 1')],
    masterFx: [],
    masterGain: 1,
    masterGlue: snapshot.masterGlue,
    automation: [],
    snap: { enabled: true, grid: 'bar' },
  };
}

/** "Song-Kette → Timeline": sections back to back on one track (their export length). */
export function arrangementFromSongChain(
  sections: readonly SectionItem[],
  base: ArrangementDoc,
  makeId: IdFactory,
): ArrangementDoc {
  const track = createTrack('section', makeId, base.tracks.length, 'Song-Kette');
  let cursor = 0;
  const clips = sections.map((sec) => {
    const bars = Math.max(1, sec.exportBars || 4);
    const ts = sec.snapshot.timeSignature;
    // Length in the section's own bars, expressed in beats.
    const len = bars * beatsPerBarOf(ts.numerator, ts.denominator);
    const clip = createSectionClip(makeId, sec.id, cursor, len);
    cursor += len;
    return clip;
  });
  return { ...base, tracks: [...base.tracks, { ...track, clips }] };
}

/** Returns the project's arrangement, creating an empty one for old projects. */
export function ensureArrangement(project: ProjectDocument, makeId: IdFactory): ArrangementDoc {
  return project.arrangement ?? createEmptyArrangement(project.activeSnapshot, makeId);
}

/** Light repair of loaded documents (missing arrays / first markers). */
export function repairArrangement(doc: ArrangementDoc | undefined): ArrangementDoc | undefined {
  if (!doc || typeof doc !== 'object') return undefined;
  const tempo = Array.isArray(doc.tempoMarkers) && doc.tempoMarkers.length > 0 ? doc.tempoMarkers : [{ id: 'tempo-0', beat: 0, bpm: 130 }];
  const meter =
    Array.isArray(doc.meterMarkers) && doc.meterMarkers.length > 0
      ? doc.meterMarkers
      : [{ id: 'meter-0', beat: 0, numerator: 4, denominator: 4 }];
  return {
    version: 1,
    tempoMarkers: tempo,
    meterMarkers: meter,
    songMarkers: Array.isArray(doc.songMarkers) ? doc.songMarkers : [],
    tracks: Array.isArray(doc.tracks)
      ? doc.tracks.map((t) => ({ ...t, fx: Array.isArray(t.fx) ? t.fx : [], clips: Array.isArray(t.clips) ? t.clips : [] }))
      : [],
    masterFx: Array.isArray(doc.masterFx) ? doc.masterFx : [],
    masterGain: Number.isFinite(doc.masterGain) ? doc.masterGain : 1,
    masterGlue: Number.isFinite(doc.masterGlue) ? doc.masterGlue : 0.3,
    automation: Array.isArray(doc.automation) ? doc.automation : [],
    loop: doc.loop,
    snap: doc.snap ?? { enabled: true, grid: 'bar' },
  };
}

/** Applied to every loaded project. */
export function repairProjectArrangement(project: ProjectDocument): ProjectDocument {
  if (!project.arrangement) return project;
  const arrangement = repairArrangement(project.arrangement);
  return arrangement ? { ...project, arrangement } : project;
}
