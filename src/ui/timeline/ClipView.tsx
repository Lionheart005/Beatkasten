import { memo, type ReactNode } from 'react';
import type { ArrangementClip } from '../../core/arrangement/types';
import type { SectionItem } from '../../core/state/types';
import { EDGE_GRAB_PX } from './geometry';

export type ClipZone = 'move' | 'trim-start' | 'trim-end' | 'fade-in' | 'fade-out';

interface ClipViewProps {
  clip: ArrangementClip;
  left: number;
  width: number;
  height: number;
  pxPerBeat: number;
  color: string;
  label: string;
  section?: SectionItem;
  missing: boolean;
  selected: boolean;
  scissors: boolean;
  waveform?: ReactNode;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>, clip: ArrangementClip, zone: ClipZone) => void;
  onDoubleClick: (clip: ArrangementClip) => void;
  onContextMenu: (e: React.MouseEvent, clip: ArrangementClip) => void;
}

const FADE_HANDLE = 9;

function zoneAt(x: number, y: number, width: number, fadeInPx: number, fadeOutPx: number): ClipZone {
  if (y <= FADE_HANDLE + 2) {
    if (Math.abs(x - Math.max(FADE_HANDLE, fadeInPx)) <= FADE_HANDLE && x > EDGE_GRAB_PX) return 'fade-in';
    if (Math.abs(x - Math.min(width - FADE_HANDLE, width - fadeOutPx)) <= FADE_HANDLE && x < width - EDGE_GRAB_PX) return 'fade-out';
  }
  if (x <= EDGE_GRAB_PX) return 'trim-start';
  if (x >= width - EDGE_GRAB_PX) return 'trim-end';
  return 'move';
}

function ClipViewImpl({
  clip,
  left,
  width,
  height,
  pxPerBeat,
  color,
  label,
  section,
  missing,
  selected,
  scissors,
  waveform,
  onPointerDown,
  onDoubleClick,
  onContextMenu,
}: ClipViewProps) {
  const fadeInPx = Math.min(width, clip.fadeIn.beats * pxPerBeat);
  const fadeOutPx = Math.min(width, clip.fadeOut.beats * pxPerBeat);
  const layers = clip.kind === 'section' && section ? section.snapshot.layers.slice(0, 10) : [];
  const overrides = clip.kind === 'section' ? clip.layerOverrides : {};
  const transpose = clip.kind === 'section' ? clip.transposeSemitones ?? 0 : 0;
  const hasOverrides = Object.keys(overrides).length > 0;

  return (
    <div
      className={`tl-clip${selected ? ' is-selected' : ''}${missing ? ' is-missing' : ''}${clip.muted ? ' is-muted' : ''}${scissors ? ' is-scissors' : ''}`}
      style={{ left, width: Math.max(2, width), height, ['--clip-color' as string]: color }}
      data-clip-id={clip.id}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const rect = e.currentTarget.getBoundingClientRect();
        onPointerDown(e, clip, zoneAt(e.clientX - rect.left, e.clientY - rect.top, rect.width, fadeInPx, fadeOutPx));
      }}
      onPointerMove={(e) => {
        if (scissors) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const z = zoneAt(e.clientX - rect.left, e.clientY - rect.top, rect.width, fadeInPx, fadeOutPx);
        e.currentTarget.style.cursor =
          z === 'trim-start' || z === 'trim-end' ? 'ew-resize' : z === 'move' ? 'grab' : 'pointer';
      }}
      onDoubleClick={() => onDoubleClick(clip)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e, clip);
      }}
    >
      {waveform}
      <div className="tl-clip-head">
        <span className="tl-clip-name">
          {missing ? '⚠ Abschnitt fehlt' : label}
          {transpose !== 0 && <span className="tl-clip-badge">{transpose > 0 ? `+${transpose}` : transpose} HT</span>}
          {hasOverrides && <span className="tl-clip-badge" title="Eigene Layer-Einstellungen in diesem Clip">✎</span>}
          {clip.gain !== 1 && <span className="tl-clip-badge">×{clip.gain.toFixed(2)}</span>}
        </span>
      </div>
      {layers.length > 0 && width > 18 && (
        <div className="tl-clip-layers">
          {layers.map((l) => {
            const ov = overrides[l.id];
            const off = ov?.enabled === false || (!l.enabled && ov?.enabled !== true) || (l.muted && ov?.enabled !== true);
            return (
              <div
                key={l.id}
                className={`tl-clip-layer${off ? ' is-off' : ''}`}
                style={{ background: l.color }}
                title={`${l.name}${off ? ' (aus)' : ''}`}
              />
            );
          })}
        </div>
      )}
      {(fadeInPx > 0 || fadeOutPx > 0) && (
        <svg className="tl-clip-fades" width="100%" height="100%" preserveAspectRatio="none">
          {fadeInPx > 0 && <polygon points={`0,0 ${fadeInPx},0 0,${height}`} />}
          {fadeOutPx > 0 && <polygon points={`${width},0 ${width - fadeOutPx},0 ${width},${height}`} />}
        </svg>
      )}
      {width > 30 && !scissors && (
        <>
          <span className="tl-fade-handle" style={{ left: Math.max(FADE_HANDLE, fadeInPx) - 4 }} title="Ziehen = Einblenden" />
          <span className="tl-fade-handle" style={{ left: Math.min(width - FADE_HANDLE, width - fadeOutPx) - 4 }} title="Ziehen = Ausblenden" />
        </>
      )}
    </div>
  );
}

export const ClipView = memo(ClipViewImpl);
