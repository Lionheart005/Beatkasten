import { useState } from 'react';
import { WandSparkles, X } from 'lucide-react';
import { addClip, addTrack, createSectionClip, createTrack } from '../../core/arrangement/edit';
import {
  applyTransition,
  findBoundary,
  listTransitionRuns,
  removeTransition,
  TRANSITIONS,
  type TransitionId,
} from '../../core/arrangement/transitions';
import { createDefaultLayer } from '../../core/state/presets';
import type { StudioStore } from '../store/useStudioStore';
import { makeTimelineId, type ArrangementStore } from './useArrangementStore';

interface TransitionPaletteProps {
  arr: ArrangementStore;
  studio: StudioStore;
}

const LENGTHS = [1, 2, 4, 8];

/** „Übergang …“: applies a template at the clip edge nearest to the start position. */
export function TransitionPalette({ arr, studio }: TransitionPaletteProps) {
  const [open, setOpen] = useState(false);
  const [bars, setBars] = useState(2);
  const doc = arr.doc;
  if (!doc) return null;
  const runs = listTransitionRuns(doc);

  const apply = (id: TransitionId) => {
    const trackId =
      arr.selectedTrackId ??
      (arr.selectedClipIds[0] ? doc.tracks.find((t) => t.clips.some((c) => c.id === arr.selectedClipIds[0]))?.id : undefined) ??
      doc.tracks.find((t) => t.clips.length > 0)?.id;
    if (!trackId) {
      studio.showNotice('Erst eine Spur mit Clips auswählen');
      return;
    }
    const boundary = findBoundary(doc, trackId, arr.startBeat);
    if (!boundary) {
      studio.showNotice('Auf dieser Spur gibt es keine Clip-Grenze');
      return;
    }
    const lengthBeats = bars * arr.tempoMap.beatsPerBarAt(boundary.beat);
    const runId = makeTimelineId('tr');
    const label = TRANSITIONS.find((t) => t.id === id)?.label ?? id;

    if (id === 'riser') {
      const start = Math.max(0, boundary.beat - lengthBeats);
      const len = boundary.beat - start;
      if (len <= 0) return;
      const riserLayer = { ...createDefaultLayer('Riser', 'noise-riser', len, 'beats'), level: 0.7 };
      const base = studio.project.activeSnapshot;
      const sectionId = studio.addSectionFromSnapshot(
        { ...base, layers: [riserLayer], curves: [], harmony: base.harmony },
        `Riser (${bars} Takte)`,
        bars,
      );
      arr.commit((d) => {
        let next = d;
        let riserTrack = next.tracks.find((t) => t.kind === 'section' && t.name === 'Riser');
        if (!riserTrack) {
          riserTrack = createTrack('section', makeTimelineId, next.tracks.length, 'Riser');
          next = addTrack(next, riserTrack);
        }
        const clip = { ...createSectionClip(makeTimelineId, sectionId, start, len), generatedBy: runId };
        return addClip(next, riserTrack.id, clip);
      }, `Übergang: ${label}`);
      setOpen(false);
      return;
    }

    let message: string | null = null;
    arr.commit((d) => {
      const r = applyTransition({ template: id, trackId, boundary, lengthBeats, runId, tempoMap: arr.tempoMap, makeId: makeTimelineId })(d);
      message = r.message;
      return r.doc;
    }, `Übergang: ${label}`);
    if (message) studio.showNotice(message);
    else studio.showNotice(`${label} bei Takt ${arr.tempoMap.formatPosition(boundary.beat)} – Keyframes sind frei bearbeitbar`);
    setOpen(false);
  };

  return (
    <div className="tl-palette-wrap">
      <button type="button" className={`btn-sm${open ? ' is-active' : ''}`} onClick={() => setOpen((o) => !o)} title="Übergangs-Vorlagen an der Clip-Grenze nahe der Startposition">
        <WandSparkles size={11} /> Übergang
      </button>
      {open && (
        <div className="tl-palette">
          <div className="tl-palette-head">
            <span>Übergang an der nächsten Clip-Grenze (gewählte Spur, nahe der Startposition)</span>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)}>
              <X size={11} />
            </button>
          </div>
          <div className="preset-chips">
            <span className="muted-note">Länge:</span>
            {LENGTHS.map((b) => (
              <button key={b} type="button" className={`preset-chip${bars === b ? ' is-active' : ''}`} onClick={() => setBars(b)}>
                {b} {b === 1 ? 'Takt' : 'Takte'}
              </button>
            ))}
          </div>
          <div className="tl-palette-grid">
            {TRANSITIONS.map((t) => (
              <button key={t.id} type="button" className="btn-sm" onClick={() => apply(t.id)} title={t.hint}>
                {t.label}
              </button>
            ))}
          </div>
          {runs.length > 0 && (
            <div className="tl-palette-runs">
              <span className="muted-note">Angewendete Vorlagen ({runs.length}):</span>
              {runs.map((r, i) => (
                <button key={r} type="button" className="btn-sm btn-ghost btn-danger" onClick={() => arr.commit((d) => removeTransition(d, r), 'Vorlage entfernt')} title="Diese Vorlage (Keyframes, Effekt, Clip) wieder entfernen">
                  × Vorlage {i + 1}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
