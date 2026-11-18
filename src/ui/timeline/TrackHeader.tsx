import { memo } from 'react';
import { AudioWaveform, ChevronDown, ChevronRight, Circle, ListMusic, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { ArrangementTrack } from '../../core/arrangement/types';
import { LiveRange, formatPan, formatPercent } from './controls';

interface TrackHeaderProps {
  track: ArrangementTrack;
  height: number;
  selected: boolean;
  automationOpen: boolean;
  laneCount: number;
  meterRef: (el: HTMLDivElement | null) => void;
  onSelect: () => void;
  onToggle: (key: 'muted' | 'solo' | 'armed') => void;
  onLive: (patch: Partial<Pick<ArrangementTrack, 'level' | 'pan'>>) => void;
  onLiveEnd: (label: string) => void;
  onToggleAutomation: () => void;
  onAddLevelLane: () => void;
  onDelete: () => void;
}

function TrackHeaderImpl({
  track,
  height,
  selected,
  automationOpen,
  laneCount,
  meterRef,
  onSelect,
  onToggle,
  onLive,
  onLiveEnd,
  onToggleAutomation,
  onAddLevelLane,
  onDelete,
}: TrackHeaderProps) {
  const compact = height < 54;
  return (
    <div
      className={`tl-track-head${selected ? ' is-selected' : ''}`}
      style={{ height, ['--track-color' as string]: track.color }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button, input, select')) return;
        onSelect();
      }}
    >
      <div className="tl-track-head-row">
        <button
          type="button"
          className="btn-ghost btn-sm tl-auto-toggle"
          onClick={onToggleAutomation}
          title={automationOpen ? 'Automationsspuren zuklappen' : `Automationsspuren aufklappen (${laneCount})`}
        >
          {automationOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        {track.kind === 'audio' ? <AudioWaveform size={11} /> : <ListMusic size={11} />}
        <span className="tl-track-name" title={track.name}>
          {track.name}
        </span>
        <button type="button" className={`tl-ms${track.muted ? ' is-mute' : ''}`} onClick={() => onToggle('muted')} title="Stumm">
          M
        </button>
        <button type="button" className={`tl-ms${track.solo ? ' is-solo' : ''}`} onClick={() => onToggle('solo')} title="Solo">
          S
        </button>
        {track.kind === 'audio' && (
          <button
            type="button"
            className={`tl-ms${track.armed ? ' is-armed' : ''}`}
            onClick={() => onToggle('armed')}
            title="Aufnahme scharf schalten"
          >
            <Circle size={9} />
          </button>
        )}
      </div>
      {!compact && (
        <div className="tl-track-head-row">
          <LiveRange
            min={0}
            max={1.5}
            value={track.level}
            accent={track.color}
            style={{ flex: 1, minWidth: 0 }}
            title={`Pegel ${formatPercent(track.level)} (Doppelklick = Keyframes)`}
            onLive={(v) => onLive({ level: v })}
            onCommit={() => onLiveEnd('Spur-Pegel')}
            onDoubleClick={onAddLevelLane}
          />
          <LiveRange
            min={-1}
            max={1}
            value={track.pan}
            accent={track.color}
            style={{ width: 44 }}
            title={`Pan ${formatPan(track.pan)}`}
            onLive={(v) => onLive({ pan: v })}
            onCommit={() => onLiveEnd('Spur-Pan')}
            onDoubleClick={() => {
              onLive({ pan: 0 });
              onLiveEnd('Pan Mitte');
            }}
          />
          <button type="button" className={`btn-ghost btn-sm${track.fx.length ? ' is-active' : ''}`} onClick={onSelect} title="Spur-Effekte (unten im Inspektor)">
            <SlidersHorizontal size={11} />
            {track.fx.length > 0 && <span className="tl-fx-count">{track.fx.length}</span>}
          </button>
          <button type="button" className="btn-ghost btn-sm btn-danger" onClick={onDelete} title="Spur löschen">
            <Trash2 size={11} />
          </button>
        </div>
      )}
      <div className="tl-meter">
        <div ref={meterRef} className="tl-meter-fill" />
      </div>
    </div>
  );
}

export const TrackHeader = memo(TrackHeaderImpl);
