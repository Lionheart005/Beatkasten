import type { ReactNode } from 'react';
import { ListMusic } from 'lucide-react';
import { beatsPerBarOf } from '../../core/arrangement/tempoMap';
import type { SectionItem } from '../../core/state/types';
import { NOTE_NAMES } from '../../core/theory/scales';

export const SECTION_DRAG_TYPE = 'application/x-beatkasten-section';
export const ASSET_DRAG_TYPE = 'application/x-beatkasten-asset';

interface MediaBrowserProps {
  sections: readonly SectionItem[];
  usedSectionIds: ReadonlySet<string>;
  onAppendSection: (section: SectionItem) => void;
  audioPool?: ReactNode;
}

export function sectionLengthBeats(section: SectionItem): number {
  const ts = section.snapshot.timeSignature;
  return Math.max(1, section.exportBars || 4) * beatsPerBarOf(ts.numerator, ts.denominator);
}

export function MediaBrowser({ sections, usedSectionIds, onAppendSection, audioPool }: MediaBrowserProps) {
  return (
    <aside className="tl-media">
      <div className="tl-media-title">
        <ListMusic size={13} /> Abschnitte
      </div>
      {sections.length === 0 && (
        <div className="muted-note">
          Noch keine Abschnitte. Im Beatkasten rechts „Abschnitt speichern“ – dann hier in die Timeline ziehen.
        </div>
      )}
      <div className="tl-media-list">
        {sections.map((s) => {
          const h = s.snapshot.harmony;
          return (
            <div
              key={s.id}
              className="tl-media-item"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(SECTION_DRAG_TYPE, s.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onDoubleClick={() => onAppendSection(s)}
              title="In die Timeline ziehen · Doppelklick = hinten anhängen"
            >
              <span className="tl-media-swatch" style={{ background: s.color }} />
              <div className="tl-media-text">
                <span className="tl-media-name">
                  {s.name}
                  {usedSectionIds.has(s.id) && <span className="tl-media-used" title="Wird in der Timeline benutzt">●</span>}
                </span>
                <span className="tl-media-meta">
                  {s.exportBars} Takte · {Math.round(s.snapshot.tempoBpm)} BPM · {s.snapshot.timeSignature.numerator}/
                  {s.snapshot.timeSignature.denominator} · {NOTE_NAMES[((h.rootNote % 12) + 12) % 12]}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {audioPool}
    </aside>
  );
}
