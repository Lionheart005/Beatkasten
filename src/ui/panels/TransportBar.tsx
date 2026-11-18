import { useEffect, useRef } from 'react';
import {
  Check,
  Download,
  FolderCheck,
  FolderPlus,
  FolderOpen,
  Music,
  Play,
  RotateCcw,
  Square,
} from 'lucide-react';
import type { LiveTelemetry } from '../../audio-host';
import {
  CHORD_CATEGORY_LABELS,
  CHORD_PRESETS,
  PROGRESSION_PRESETS,
  type ChordCategory,
} from '../../core/theory/harmony';
import { NOTE_NAMES, SCALE_DEFINITIONS } from '../../core/theory/scales';
import type { BeatSnapshot } from '../../core/state/types';
import { formatSaveTime } from '../components/ProjectModal';
import type { SaveState } from '../store/useStudioStore';

interface TransportBarProps {
  projectName: string;
  snapshot: BeatSnapshot;
  isPlaying: boolean;
  subscribeTelemetry: (cb: (t: LiveTelemetry) => void) => () => void;
  getTelemetry: () => LiveTelemetry;
  fsConnected: boolean;
  fsFolderName: string | null;
  pendingFolderName: string | null;
  saveState: SaveState;
  harmonyBuilderOpen: boolean;
  onToggleHarmonyBuilder: () => void;
  onTogglePlay: () => void;
  onRestart: () => void;
  onUpdateSnapshotLive: (
    updater: (snap: BeatSnapshot) => BeatSnapshot,
    label: string,
  ) => void;
  onCommitSnapshotImmediate: (
    updater: (snap: BeatSnapshot) => BeatSnapshot,
    label: string,
  ) => void;
  onApplyPreset: (
    key:
      | 'hypnotic-aminor'
      | 'triplet-riddle'
      | 'chord-offbeat-arp'
      | 'bells-organ'
      | 'nachtschicht-song'
      | 'stahlwerk-song',
  ) => void;
  onConnectFolder: () => void;
  onOpenProjectModal: () => void;
  onOpenExportModal: () => void;
}

const TIME_SIGNATURES = [
  { label: '4/4', numerator: 4, denominator: 4 },
  { label: '3/4', numerator: 3, denominator: 4 },
  { label: '5/4', numerator: 5, denominator: 4 },
  { label: '7/8', numerator: 7, denominator: 8 },
];

export function TransportBar({
  projectName,
  snapshot,
  isPlaying,
  subscribeTelemetry,
  getTelemetry,
  fsConnected,
  fsFolderName,
  pendingFolderName,
  saveState,
  harmonyBuilderOpen,
  onToggleHarmonyBuilder,
  onTogglePlay,
  onRestart,
  onUpdateSnapshotLive,
  onCommitSnapshotImmediate,
  onApplyPreset,
  onConnectFolder,
  onOpenProjectModal,
  onOpenExportModal,
}: TransportBarProps) {
  const sigValue = `${snapshot.timeSignature.numerator}/${snapshot.timeSignature.denominator}`;
  const meterFillRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const updateMeter = (t: LiveTelemetry) => {
      const el = meterFillRef.current;
      if (!el) return;
      const pct =
        isPlaying && t.isPlaying
          ? Math.min(100, Math.max(0, t.peakLevel * 100))
          : 0;
      el.style.width = `${pct}%`;
    };

    updateMeter(getTelemetry());
    return subscribeTelemetry(updateMeter);
  }, [getTelemetry, isPlaying, subscribeTelemetry]);

  return (
    <header className="transport-bar">
      {/* Brand + Play Controls */}
      <div className="transport-group">
        <div className="brand-badge">
          <span className="brand-dot" />
          <div>
            <div className="brand-title">Beatkasten</div>
            <div className="brand-sub">{projectName}</div>
          </div>
        </div>

        <button
          type="button"
          className={`btn-play${isPlaying ? ' is-playing' : ''}`}
          onClick={onTogglePlay}
          title="Wiedergabe starten oder stoppen"
        >
          {isPlaying ? <Square size={13} /> : <Play size={13} />}
          <span>{isPlaying ? 'Stop' : 'Play'}</span>
        </button>

        <button
          type="button"
          onClick={onRestart}
          title="Von Takt 1 neu starten"
        >
          <RotateCcw size={13} />
        </button>

        {/* Tempo & Time Signature */}
        <div className="field-chip" title="Geschwindigkeit in Schlägen pro Minute">
          <label>BPM</label>
          <input
            type="range"
            min={90}
            max={160}
            step={1}
            value={snapshot.tempoBpm}
            style={{ width: 78 }}
            onChange={(e) => {
              const nextBpm = Number(e.target.value);
              onUpdateSnapshotLive(
                (s) => ({ ...s, tempoBpm: nextBpm }),
                `Tempo: ${nextBpm} BPM`,
              );
            }}
          />
          <span className="schema-value" style={{ minWidth: 28 }}>
            {Math.round(snapshot.tempoBpm)}
          </span>
        </div>

        <div className="field-chip" title="Taktart des Projekts">
          <label>Takt</label>
          <select
            value={sigValue}
            onChange={(e) => {
              const chosen = TIME_SIGNATURES.find(
                (t) => t.label === e.target.value,
              );
              if (!chosen) return;
              onCommitSnapshotImmediate(
                (s) => ({
                  ...s,
                  timeSignature: {
                    numerator: chosen.numerator,
                    denominator: chosen.denominator,
                  },
                }),
                `Taktart: ${chosen.label}`,
              );
            }}
          >
            {TIME_SIGNATURES.map((t) => (
              <option key={t.label} value={t.label}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Global Harmony & Master */}
      <div className="transport-group">
        <div className="field-chip" title="Grundton der Tonart">
          <label>Ton</label>
          <select
            value={snapshot.harmony.rootNote}
            onChange={(e) => {
              const rootNote = Number(e.target.value);
              onCommitSnapshotImmediate(
                (s) => ({
                  ...s,
                  harmony: { ...s.harmony, rootNote },
                }),
                `Grundton: ${NOTE_NAMES[rootNote] ?? 'A'}`,
              );
            }}
          >
            {NOTE_NAMES.map((name, idx) => (
              <option key={name} value={idx}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="field-chip" title="Musikalische Skala für Bass & Melodie">
          <label>Skala</label>
          <select
            value={snapshot.harmony.scaleId}
            onChange={(e) => {
              const scaleId = e.target.value;
              onCommitSnapshotImmediate(
                (s) => ({
                  ...s,
                  harmony: { ...s.harmony, scaleId },
                }),
                `Skala gewechselt`,
              );
            }}
          >
            {(['minor', 'major'] as const).map((family) => (
              <optgroup key={family} label={family === 'minor' ? 'Moll & dunkle Modi' : 'Dur & helle Modi'}>
                {Object.values(SCALE_DEFINITIONS)
                  .filter((sc) => sc.family === family)
                  .map((sc) => (
                    <option key={sc.id} value={sc.id}>
                      {sc.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div
          className="field-chip"
          title="Akkord-Farbe: bei leitereigenen Kadenzen bestimmt sie, ob Dreiklänge, Septakkorde oder 9er-Akkorde gebildet werden"
        >
          <label>Akkord</label>
          <select
            value={snapshot.harmony.chordPreset}
            onChange={(e) => {
              const chordPreset = e.target.value;
              onCommitSnapshotImmediate(
                (s) => ({
                  ...s,
                  harmony: { ...s.harmony, chordPreset },
                }),
                `Akkord: ${chordPreset}`,
              );
            }}
          >
            {(Object.keys(CHORD_CATEGORY_LABELS) as ChordCategory[]).map((cat) => (
              <optgroup key={cat} label={CHORD_CATEGORY_LABELS[cat]}>
                {Object.values(CHORD_PRESETS)
                  .filter((ch) => ch.category === cat)
                  .map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="field-chip" title="Harmonische Bewegung über mehrere Takte">
          <label>Folge</label>
          <select
            value={
              snapshot.harmony.progressionMode === 'custom'
                ? '__custom__'
                : snapshot.harmony.progressionId
            }
            onChange={(e) => {
              const value = e.target.value;
              if (value === '__custom__') {
                onCommitSnapshotImmediate(
                  (s) => ({ ...s, harmony: { ...s.harmony, progressionMode: 'custom' } }),
                  'Eigene Akkordfolge aktiviert',
                );
                return;
              }
              onCommitSnapshotImmediate(
                (s) => ({
                  ...s,
                  harmony: { ...s.harmony, progressionId: value, progressionMode: 'preset' },
                }),
                `Fortschreitung: ${PROGRESSION_PRESETS[value as keyof typeof PROGRESSION_PRESETS]?.label ?? value}`,
              );
            }}
          >
            <optgroup label="Techno-Parallel (Akkordtyp bleibt gleich)">
              {Object.values(PROGRESSION_PRESETS)
                .filter((pr) => pr.group === 'techno')
                .map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    {pr.label}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Kadenzen (leitereigen)">
              {Object.values(PROGRESSION_PRESETS)
                .filter((pr) => pr.group === 'cadence')
                .map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    {pr.label}
                  </option>
                ))}
            </optgroup>
            {(snapshot.harmony.customSteps?.length ?? 0) > 0 && (
              <optgroup label="Baukasten">
                <option value="__custom__">
                  Eigene Folge ({snapshot.harmony.customSteps?.length} Akkorde)
                </option>
              </optgroup>
            )}
          </select>
          <button
            type="button"
            className={`btn-sm${harmonyBuilderOpen ? ' is-active' : ''}`}
            onClick={onToggleHarmonyBuilder}
            title="Akkord-Baukasten ein-/ausklappen: eigene Kadenzen aus Stufen zusammenstellen"
          >
            <Music size={11} /> Baukasten {harmonyBuilderOpen ? '▲' : '▼'}
            {snapshot.harmony.progressionMode === 'custom' && (
              <span className="badge-current" style={{ marginLeft: 4 }}>
                aktiv
              </span>
            )}
          </button>
        </div>

        <div className="field-chip" title="Master-Lautstärke & Analog-Glue">
          <label>Master</label>
          <input
            type="range"
            min={0}
            max={1.2}
            step={0.01}
            value={snapshot.masterGain}
            style={{ width: 62 }}
            onChange={(e) => {
              const masterGain = Number(e.target.value);
              onUpdateSnapshotLive(
                (s) => ({ ...s, masterGain }),
                'Master-Lautstärke',
              );
            }}
          />
          <label>Glue</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={snapshot.masterGlue}
            style={{ width: 52 }}
            onChange={(e) => {
              const masterGlue = Number(e.target.value);
              onUpdateSnapshotLive(
                (s) => ({ ...s, masterGlue }),
                'Analog-Glue',
              );
            }}
          />
          <div className="peak-meter-track" title="Ausgangspegel">
            <div
              ref={meterFillRef}
              className="peak-meter-fill"
              style={{ width: '0%' }}
            />
          </div>
        </div>
      </div>

      {/* Starter Presets + Storage + Export */}
      <div className="transport-group">
        <div className="preset-chips">
          <button
            type="button"
            className="preset-chip"
            onClick={() => onApplyPreset('hypnotic-aminor')}
            title="4-Layer A-Moll Club-Basis mit 5-Beat-Polyrhythmik"
          >
            Hypnotic A-Moll Club
          </button>
          <button
            type="button"
            className="preset-chip"
            onClick={() => onApplyPreset('triplet-riddle')}
            title="Polyrhythmisches 3 / 5 / 7-Beat Triolen-Rätsel"
          >
            Triolen-Rätsel 5/4
          </button>
          <button
            type="button"
            className="preset-chip"
            onClick={() => onApplyPreset('chord-offbeat-arp')}
            title="Stehender Akkord verwandelt sich in Offbeat-Arpeggio"
          >
            Akkord → Offbeat Arp
          </button>
          <button
            type="button"
            className="preset-chip"
            onClick={() => onApplyPreset('bells-organ')}
            title="4/4 Kick, Offbeat-Glockenspiel & kombinierte Orgelpipes"
          >
            Glocken & Orgel
          </button>
          <button
            type="button"
            className="preset-chip"
            onClick={() => onApplyPreset('nachtschicht-song')}
            title="Kompletter Demo-Song (D-Moll, 128 BPM, 6 Abschnitte): Hats, Clap, rollender Bass, Acid-Linie, Dub-Stab, Glocken-Motiv, Orgel-Break & Riser – als neues Projekt"
          >
            ★ Demo-Song „Nachtschicht“
          </button>
          <button
            type="button"
            className="preset-chip"
            onClick={() => onApplyPreset('stahlwerk-song')}
            title="Hardtechno-Demo (F-Phrygisch, 150 BPM, 4 Abschnitte): verzerrte Rumble-Kick, Industrie-Bass auf dem Offbeat, Acid-Kreischen, Reese-Break – als neues Projekt"
          >
            ★ Hardtechno „Stahlwerk“
          </button>
        </div>

        <button
          type="button"
          onClick={onConnectFolder}
          className={fsConnected ? 'btn-primary' : pendingFolderName ? 'btn-attention' : undefined}
          title={
            fsConnected
              ? `Projekte-Ordner: „${fsFolderName}“ (jedes Projekt = ein Unterordner)`
              : pendingFolderName
                ? `Zugriff auf „${pendingFolderName}“ mit einem Klick erneuern`
                : 'Lokalen Ordner für Projekte & Exports verbinden'
          }
        >
          {fsConnected ? <FolderCheck size={13} /> : <FolderPlus size={13} />}
          <span>
            {fsConnected
              ? fsFolderName
              : pendingFolderName
                ? `„${pendingFolderName}“ wieder verbinden`
                : 'Projekt-Ordner verbinden'}
          </span>
        </button>

        <button
          type="button"
          onClick={onOpenProjectModal}
          title={`Projekt „${projectName}“ umbenennen, kopieren oder anderes öffnen`}
        >
          <FolderOpen size={13} />
          <span>Projekt</span>
        </button>

        <span
          className={`save-chip is-${saveState.status}`}
          title={
            saveState.status === 'error'
              ? `Fehler: ${saveState.location}`
              : `Automatisches Speichern · ${saveState.location}`
          }
        >
          {saveState.status === 'saved' && (
            <>
              <Check size={11} /> Gespeichert {formatSaveTime(saveState.at).slice(0, 5)}
            </>
          )}
          {saveState.status === 'saving' && <>Speichert…</>}
          {saveState.status === 'error' && <>⚠ Nicht gespeichert</>}
          {saveState.status === 'idle' && <>Autosave an</>}
        </span>

        <button
          type="button"
          className="btn-primary"
          onClick={onOpenExportModal}
          title="Audio als WAV, MP3 oder Einzel-Spuren (Stems) exportieren"
        >
          <Download size={13} />
          <span>Exportieren</span>
        </button>
      </div>
    </header>
  );
}
