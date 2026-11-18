import { useMemo, useState } from 'react';
import { Download, FolderCheck, X } from 'lucide-react';
import {
  exportAudioAsync,
  type ExportRequest,
  type ExportResult,
} from '../../audio-host';
import { computeFullRepeatBars } from '../../core/engine/cycleMath';
import type { BeatSnapshot, SectionItem } from '../../core/state/types';
import type { BrowserFsAdapter } from '../../storage';
import type { ArrangementDoc } from '../../core/arrangement/types';
import type { ArrangementExportSpec } from '../../audio-host/ExportWorker';
import { songEndBeat } from '../../core/arrangement/edit';
import { TempoMap } from '../../core/arrangement/tempoMap';

interface ExportModalProps {
  isOpen: boolean;
  projectName: string;
  snapshot: BeatSnapshot;
  fsConnected: boolean;
  fsAdapter: BrowserFsAdapter;
  sections?: readonly SectionItem[];
  isPlaying?: boolean;
  /** Stoppt die Live-Wiedergabe (Export rendert sonst parallel und ruckelt). */
  onStopPlayback?: () => Promise<void> | void;
  onClose: () => void;
  onNotice: (msg: string) => void;
  /** Timeline document (export tab „Timeline“). */
  arrangement?: ArrangementDoc | null;
  /** PCM of all audio assets used by the timeline. */
  getArrangementAssets?: () => Promise<NonNullable<ArrangementExportSpec['assets']>>;
  /** Opened from the timeline workspace → preselect the timeline tab. */
  preferTimeline?: boolean;
}

function triggerBrowserDownload(
  fileName: string,
  bytes: Uint8Array,
  mimeType: string,
) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 2500);
}

const MAX_EXPORT_BARS = 256;

export function ExportModal({
  isOpen,
  projectName,
  snapshot,
  fsConnected,
  fsAdapter,
  sections = [],
  isPlaying = false,
  onStopPlayback,
  onClose,
  onNotice,
  arrangement = null,
  getArrangementAssets,
  preferTimeline = false,
}: ExportModalProps) {
  const [exportModeRaw, setExportMode] = useState<'loop' | 'song' | 'timeline' | null>(null);
  const exportMode = exportModeRaw ?? (preferTimeline && arrangement ? 'timeline' : 'loop');
  const [timelineRange, setTimelineRange] = useState<'song' | 'loop'>('song');
  const [tailSeconds, setTailSeconds] = useState<number>(2);
  const [tailBars, setTailBars] = useState<number>(2);
  const [format, setFormat] = useState<ExportRequest['format']>('wav-24');
  const [bars, setBars] = useState<number>(8);
  const [preRollBars, setPreRollBars] = useState<number>(2);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ExportResult | null>(null);

  const fullRepeatBars = useMemo(() => computeFullRepeatBars(snapshot), [snapshot]);
  const beatsPerBar =
    (snapshot.timeSignature.numerator || 4) * (4 / (snapshot.timeSignature.denominator || 4));
  const songBars = sections.reduce((sum, s) => sum + Math.max(0, s.exportBars || 0), 0);
  const songSec = sections.reduce((sum, s) => {
    const bpb =
      (s.snapshot.timeSignature.numerator || 4) * (4 / (s.snapshot.timeSignature.denominator || 4));
    return sum + (Math.max(0, s.exportBars || 0) * bpb * 60) / Math.max(20, s.snapshot.tempoBpm);
  }, 0);
  const isSong = exportMode === 'song' && sections.length > 0;
  const tlEnd = arrangement ? songEndBeat(arrangement) : 0;
  const isTimeline = exportMode === 'timeline' && !!arrangement && tlEnd > 0;
  const tlLoop = arrangement?.loop && arrangement.loop.endBeat > arrangement.loop.startBeat ? arrangement.loop : null;
  const tlTempo = useMemo(
    () => (arrangement ? new TempoMap(arrangement.tempoMarkers, arrangement.meterMarkers) : null),
    [arrangement],
  );
  const tlStart = timelineRange === 'loop' && tlLoop ? tlLoop.startBeat : 0;
  const tlStop = timelineRange === 'loop' && tlLoop ? tlLoop.endBeat : tlEnd;
  const durationSec = isTimeline
    ? (tlTempo ? tlTempo.beatToSec(tlStop) - tlTempo.beatToSec(tlStart) : 0) + tailSeconds
    : isSong
    ? songSec
    : (bars * beatsPerBar * 60) / Math.max(20, snapshot.tempoBpm);
  const durationLabel = `${Math.floor(durationSec / 60)}:${String(
    Math.round(durationSec % 60),
  ).padStart(2, '0')} min`;

  if (!isOpen) return null;

  const handleRunExport = async () => {
    setIsExporting(true);
    setErrorMsg(null);
    setLastResult(null);

    try {
      if (isPlaying && onStopPlayback) await onStopPlayback();
      const poolAssets = getArrangementAssets ? await getArrangementAssets() : [];
      const arrangementSpec: ArrangementExportSpec | undefined =
        isTimeline && arrangement
          ? {
              doc: arrangement,
              sections: sections.map((sec) => ({ id: sec.id, snapshot: sec.snapshot })),
              startBeat: tlStart,
              endBeat: tlStop,
              tailSeconds,
            }
          : undefined;
      const request: ExportRequest = {
        assets: poolAssets,
        ...(arrangementSpec ? { arrangement: arrangementSpec } : {}),
        snapshot,
        bars,
        preRollBars,
        sampleRate: 48000,
        format,
        ...(isSong
          ? {
              songChain: sections
                .filter((s) => s.exportBars > 0)
                .map((s) => ({ snapshot: s.snapshot, bars: s.exportBars, name: s.name })),
              tailBars,
            }
          : {}),
      };
      const result = await exportAudioAsync(request, projectName);
      setLastResult(result);

      if (fsConnected && fsAdapter.hasRootDirectory()) {
        if (result.mainFile) {
          await fsAdapter.saveExportedAudio(
            projectName,
            result.mainFile.fileName,
            result.mainFile.bytes,
          );
        }
        if (result.stemFiles) {
          for (const stem of result.stemFiles) {
            await fsAdapter.saveExportedAudio(
              projectName,
              stem.fileName,
              stem.bytes,
              'stems',
            );
          }
        }
        onNotice(
          `Export gespeichert in ${fsAdapter.describeProjectLocation(projectName)}/exports/`,
        );
      } else {
        if (result.mainFile) {
          triggerBrowserDownload(
            result.mainFile.fileName,
            result.mainFile.bytes,
            result.mainFile.mimeType,
          );
        }
        if (result.stemFiles) {
          for (const stem of result.stemFiles) {
            triggerBrowserDownload(stem.fileName, stem.bytes, 'audio/wav');
          }
        }
        onNotice('Export-Download gestartet!');
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Export ist fehlgeschlagen.',
      );
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Audio & Stems exportieren</span>
          <button type="button" className="btn-ghost" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div className="preset-chips" style={{ flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`preset-chip${isTimeline ? ' is-active' : ''}`}
              disabled={!arrangement || tlEnd <= 0}
              title={!arrangement || tlEnd <= 0 ? 'Erst in der Timeline Clips anlegen' : 'Den Song genau so rendern, wie er in der Timeline klingt'}
              onClick={() => setExportMode('timeline')}
            >
              Timeline
            </button>
            <button
              type="button"
              className={`preset-chip${!isSong && !isTimeline ? ' is-active' : ''}`}
              onClick={() => setExportMode('loop')}
            >
              Aktueller Beat (Loop)
            </button>
            <button
              type="button"
              className={`preset-chip${isSong ? ' is-active' : ''}`}
              disabled={sections.length === 0}
              title={
                sections.length === 0
                  ? 'Erst Abschnitte (Sections) speichern'
                  : 'Alle Abschnitte in ihrer Reihenfolge hintereinander rendern'
              }
              onClick={() => setExportMode('song')}
            >
              Ganzer Song ({sections.length} Abschnitte · {songBars} Takte)
            </button>
          </div>

          {isTimeline && (
            <div className="muted-note" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="preset-chips">
                <button type="button" className={`preset-chip${timelineRange === 'song' ? ' is-active' : ''}`} onClick={() => setTimelineRange('song')}>
                  Ganzer Song
                </button>
                <button
                  type="button"
                  className={`preset-chip${timelineRange === 'loop' ? ' is-active' : ''}`}
                  disabled={!tlLoop}
                  onClick={() => setTimelineRange('loop')}
                  title={tlLoop ? 'Nur den Loop-Bereich der Timeline' : 'In der Timeline erst einen Loop-Bereich setzen (Shift + Ziehen im Lineal)'}
                >
                  Loop-Bereich
                </button>
              </div>
              <label style={{ fontSize: 12 }}>
                Ausklang am Ende: {tailSeconds} s
                <input type="range" min={0} max={10} step={0.5} value={tailSeconds} onChange={(e) => setTailSeconds(Number(e.target.value))} />
              </label>
              <span>Länge ≈ {durationLabel}. Stems = eine Datei pro Timeline-Spur (plus Gesamtmix).</span>
            </div>
          )}

          {isSong && (
            <div className="muted-note" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {sections.map((s, i) => (
                <span key={s.id}>
                  {i + 1}. {s.name} — {s.exportBars} Takte
                  {s.exportBars <= 0 ? ' (wird übersprungen)' : ''}
                </span>
              ))}
              <span>
                Länge pro Abschnitt = „Export-Takte“ in der Abschnitts-Liste. Die Übergänge laufen
                nahtlos (Hall & Echo klingen in den nächsten Abschnitt hinein).
              </span>
              <label style={{ fontSize: 12 }}>
                Ausklang am Ende: {tailBars} Takte
                <input
                  type="range"
                  min={0}
                  max={8}
                  step={1}
                  value={tailBars}
                  onChange={(e) => setTailBars(Number(e.target.value))}
                />
              </label>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Format & Qualität
            </label>
            <select
              value={format}
              onChange={(e) =>
                setFormat(e.target.value as ExportRequest['format'])
              }
            >
              <option value="wav-24">WAV 24-Bit (Studio Loop)</option>
              <option value="wav-16">WAV 16-Bit (CD / Standard)</option>
              <option value="mp3-320">MP3 320 kbps (Hohe Qualität)</option>
              <option value="mp3-192">MP3 192 kbps (Kompakt)</option>
              <option value="stems-wav-24">
                Einzel-Spuren (Stems WAV 24-Bit + Mix)
              </option>
              <option value="stems-wav-16">
                Einzel-Spuren (Stems WAV 16-Bit + Mix)
              </option>
            </select>
          </div>

          {isSong && (
            <div className="muted-note">Song-Länge ≈ {durationLabel}. Bei Stems wird im Song-Modus nur der Gesamtmix exportiert.</div>
          )}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 10,
              ...(isSong || isTimeline ? { opacity: 0.45, pointerEvents: 'none' as const } : {}),
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Loop-Länge in Takten (≈ {durationLabel})
              </label>
              <input
                type="number"
                min={1}
                max={MAX_EXPORT_BARS}
                step={1}
                value={bars}
                onChange={(e) => {
                  const v = Math.round(Number(e.target.value));
                  if (Number.isFinite(v)) setBars(Math.max(1, Math.min(MAX_EXPORT_BARS, v)));
                }}
              />
              <div className="preset-chips" style={{ flexWrap: 'wrap' }}>
                {[8, 16, 32, 64, 128].map((b) => (
                  <button
                    key={b}
                    type="button"
                    className={`preset-chip${bars === b ? ' is-active' : ''}`}
                    onClick={() => setBars(b)}
                  >
                    {b}
                  </button>
                ))}
                <button
                  type="button"
                  className={`preset-chip${bars === fullRepeatBars ? ' is-active' : ''}`}
                  title="Länge, nach der sich alle Layer, Bewegungen und die Akkordfolge exakt wiederholen (kgV) – ergibt einen perfekt nahtlosen Loop."
                  disabled={fullRepeatBars > MAX_EXPORT_BARS}
                  onClick={() => setBars(Math.min(MAX_EXPORT_BARS, fullRepeatBars))}
                >
                  Volle Wiederholung ({fullRepeatBars})
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Vorlauf / Pre-Roll ({preRollBars} Takte)
              </label>
              <input
                type="range"
                min={0}
                max={4}
                step={1}
                value={preRollBars}
                onChange={(e) => setPreRollBars(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="muted-note">
            Der Vorlauf schwingt Hall & Tempo-Echo vor Takt 1 ein und wird
            danach sauber abgeschnitten — so entsteht ein nahtloser DAW-Loop.
          </div>

          <div
            className="field-chip"
            style={{ justifyContent: 'space-between', padding: '7px 10px' }}
          >
            <span style={{ fontSize: 11.5 }}>
              Ziel:{' '}
              {fsConnected
                ? `Projekt-Ordner (${fsAdapter.describeProjectLocation(projectName)}/exports/)`
                : 'Direkter Browser-Download'}
            </span>
            {fsConnected && <FolderCheck size={14} color="#22c55e" />}
          </div>

          {errorMsg && (
            <div
              style={{
                color: '#fecaca',
                background: 'rgba(239, 68, 68, 0.16)',
                border: '1px solid rgba(239, 68, 68, 0.45)',
                padding: '7px 9px',
                borderRadius: 6,
                fontSize: 12,
              }}
            >
              {errorMsg}
            </div>
          )}

          {lastResult && (
            <div
              style={{
                color: '#bbf7d0',
                background: 'rgba(34, 197, 94, 0.14)',
                border: '1px solid rgba(34, 197, 94, 0.45)',
                padding: '7px 9px',
                borderRadius: 6,
                fontSize: 12,
              }}
            >
              Fertig gerendert ({lastResult.durationSeconds.toFixed(1)} s Audio
              {lastResult.stemFiles
                ? `, ${lastResult.stemFiles.length} Stems`
                : ''}
              ).
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" onClick={onClose} disabled={isExporting}>
            Schließen
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleRunExport}
            disabled={isExporting}
          >
            <Download size={14} />
            {isExporting
              ? 'Rendere Audio… (Wiedergabe pausiert)'
              : isTimeline
                ? 'Timeline exportieren'
                : isSong
                ? 'Song exportieren'
                : 'Jetzt exportieren'}
          </button>
        </div>
      </div>
    </div>
  );
}
