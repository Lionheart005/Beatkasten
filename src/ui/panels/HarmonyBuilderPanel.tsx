import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Copy, CopyPlus, Music, Ruler, Trash2, X } from 'lucide-react';
import type { LiveTelemetry } from '../../audio-host';
import type { BeatSnapshot } from '../../core/state/types';
import { PROGRESSION_PRESETS } from '../../core/theory/harmony';
import {
  getHeptatonicIntervals,
  NOTE_NAMES,
  normalizePitchClass,
} from '../../core/theory/scales';
import {
  BASS_MODE_LABELS,
  buildHarmonyTimeline,
  DIATONIC_TRIAD,
  findStepIndexAtBeat,
  MAX_CUSTOM_STEPS,
  MAX_STEP_BEATS,
  midiToNoteLabel,
  MIN_STEP_BEATS,
  offsetToDegree,
  presetToCustomSteps,
  previewDegreeChord,
  type BassMode,
  type ChordStepConfig,
  type ChordTransitionType,
} from '../../core/theory/progression';
import { getClassicalTemplate } from '../../core/theory/classicalChords';
import {
  buildChordMenu,
  chordFunctionSymbol,
  findChordMenuOption,
  groupChordMenu,
  type ChordMenuOption,
} from '../../core/theory/chordMenu';
import { nextUiId } from '../store/useStudioStore';

interface HarmonyBuilderPanelProps {
  snapshot: BeatSnapshot;
  isPlaying: boolean;
  subscribeTelemetry: (cb: (t: LiveTelemetry) => void) => () => void;
  onCommitSnapshotImmediate: (
    updater: (snap: BeatSnapshot) => BeatSnapshot,
    label: string,
  ) => void;
  onClose: () => void;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const QUICK_BUTTONS: Array<{ degree: number; accidental: -1 | 0 | 1 }> = [
  { degree: 0, accidental: 0 },
  { degree: 1, accidental: 0 },
  { degree: 2, accidental: 0 },
  { degree: 3, accidental: 0 },
  { degree: 4, accidental: 0 },
  { degree: 5, accidental: 0 },
  { degree: 6, accidental: 0 },
  { degree: 1, accidental: -1 },
  { degree: 2, accidental: -1 },
  { degree: 5, accidental: -1 },
  { degree: 6, accidental: -1 },
];
const TRANSITIONS: Array<{ value: ChordTransitionType; label: string; hint: string }> = [
  { value: 'cut', label: 'Schnitt', hint: 'Sauberer Akkordwechsel genau auf dem Schlag' },
  { value: 'glide', label: 'Glide', hint: 'Die Stimmen gleiten in die Töne des nächsten Akkords' },
  {
    value: 'crossfade',
    label: 'Blende',
    hint: 'Sich ändernde Stimmen blenden aus, gemeinsame Töne bleiben liegen',
  },
];

const NEW_LENGTH_OPTIONS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 64];

function formatBars(beats: number, beatsPerBar: number): string {
  const bars = beats / beatsPerBar;
  const label = Number.isInteger(bars) ? `${bars}` : bars.toFixed(2).replace(/\.?0+$/, '');
  return `${label} ${bars === 1 ? 'Takt' : 'Takte'}`;
}

function formatBeats(beats: number, beatsPerBar: number): string {
  const bars = beats / beatsPerBar;
  const barsLabel = Number.isInteger(bars) ? `${bars}` : bars.toFixed(2).replace(/\.?0+$/, '');
  return `${beats} Beats · ${barsLabel} ${bars === 1 ? 'Takt' : 'Takte'}`;
}

export function HarmonyBuilderPanel({
  snapshot,
  isPlaying,
  subscribeTelemetry,
  onCommitSnapshotImmediate,
  onClose,
}: HarmonyBuilderPanelProps) {
  const harmony = snapshot.harmony;
  const beatsPerBar =
    (snapshot.timeSignature.numerator || 4) * (4 / (snapshot.timeSignature.denominator || 4));
  const isCustom = harmony.progressionMode === 'custom';
  const customSteps = harmony.customSteps ?? [];
  const voiceLeading = harmony.voiceLeadingEnabled !== false;

  const timeline = useMemo(
    () => buildHarmonyTimeline(harmony, beatsPerBar),
    [harmony, beatsPerBar],
  );

  // Length used for newly appended chords (they are plain diatonic triads).
  const [newDuration, setNewDuration] = useState<number>(beatsPerBar);

  // Playhead highlight: only re-render when the active chord changes.
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  useEffect(() => {
    if (!isPlaying) {
      setActiveIdx(-1);
      return undefined;
    }
    return subscribeTelemetry((t) => {
      const idx = t.isPlaying ? findStepIndexAtBeat(timeline, t.currentBeat) : -1;
      setActiveIdx((prev) => (prev === idx ? prev : idx));
    });
  }, [isPlaying, subscribeTelemetry, timeline]);

  const commitSteps = (steps: ChordStepConfig[], label: string) => {
    onCommitSnapshotImmediate(
      (s) => ({
        ...s,
        harmony: { ...s.harmony, progressionMode: 'custom', customSteps: steps },
      }),
      label,
    );
  };

  const updateStep = (idx: number, patch: Partial<ChordStepConfig>, label: string) => {
    // Editing degree / accidental / colour by hand detaches a function template.
    const detach =
      patch.templateId === undefined &&
      ('degree' in patch || 'accidental' in patch || 'chordType' in patch);
    const next = customSteps.map((st, i) => {
      if (i !== idx) return st;
      const merged = { ...st, ...patch };
      if (!detach) return merged;
      const { templateId: _drop, ...rest } = merged;
      return rest;
    });
    commitSteps(next, label);
  };

  // Combined "function + chord" menu per root (cached while the key stays the same).
  const menuFor = useMemo(() => {
    const cache = new Map<string, ChordMenuOption[]>();
    const h = { ...harmony };
    return (degree: number, accidental: -1 | 0 | 1): ChordMenuOption[] => {
      const key = `${degree}|${accidental}`;
      let menu = cache.get(key);
      if (!menu) {
        menu = buildChordMenu(h, { degree, accidental });
        cache.set(key, menu);
      }
      return menu;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [harmony.rootNote, harmony.scaleId, harmony.chordPreset]);

  const applyMenuOption = (idx: number, cfg: ChordStepConfig, opt: ChordMenuOption | undefined) => {
    if (!opt) return;
    const f = opt.fields;
    const prevTpl = getClassicalTemplate(cfg.templateId);
    // A template's special bass (N⁶ = third in the bass) goes away with the template.
    const resetBass =
      !f.templateId && prevTpl?.bass && prevTpl.bass !== 'root' && (cfg.bass ?? 'root') === prevTpl.bass;
    const patch: Partial<ChordStepConfig> = {
      degree: f.degree,
      accidental: f.accidental,
      chordType: f.chordType,
      ...(f.templateId ? { templateId: f.templateId, bass: f.bass ?? 'root' } : {}),
      ...(resetBass ? { bass: 'root' as const } : {}),
    };
    updateStep(idx, patch, `Akkord: ${opt.label}`);
  };

  const appendStep = (degree: number, accidental: -1 | 0 | 1) => {
    if (customSteps.length >= MAX_CUSTOM_STEPS) return;
    // Appends to the stored custom progression (and switches to it).
    const base = customSteps;
    const step: ChordStepConfig = {
      id: nextUiId('chord'),
      degree,
      accidental,
      chordType: DIATONIC_TRIAD,
      durationBeats: newDuration,
      transitionType: 'cut',
      transitionBeats: 0,
    };
    const preview = previewDegreeChord(harmony, degree, accidental, DIATONIC_TRIAD);
    commitSteps([...base, step], `Akkord hinzugefügt: ${preview.roman} ${preview.name}`);
  };

  const loadTemplate = (progressionId: string) => {
    const steps = presetToCustomSteps({ ...harmony, progressionId }, beatsPerBar, () =>
      nextUiId('chord'),
    );
    const label = PROGRESSION_PRESETS[progressionId as keyof typeof PROGRESSION_PRESETS]?.label;
    commitSteps(steps, `Vorlage in Baukasten geladen: ${label ?? progressionId}`);
  };

  const keyPc = normalizePitchClass(harmony.rootNote);
  const keyScale = getHeptatonicIntervals(harmony.scaleId);
  const degreeNoteName = (degree: number, accidental: number): string =>
    NOTE_NAMES[(((keyPc + (keyScale[degree] ?? 0) + accidental) % 12) + 12) % 12] ?? '';

  const moveStep = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= customSteps.length) return;
    const next = [...customSteps];
    const tmp = next[idx]!;
    next[idx] = next[j]!;
    next[j] = tmp;
    commitSteps(next, 'Akkord verschoben');
  };

  return (
    <section className="harmony-builder">
      <div className="harmony-builder-head">
        <span className="harmony-builder-title">
          <Music size={14} color="#a855f7" /> Akkord-Baukasten
        </span>

        <div className="segmented">
          <button
            type="button"
            className={!isCustom ? 'is-active' : undefined}
            onClick={() =>
              onCommitSnapshotImmediate(
                (s) => ({ ...s, harmony: { ...s.harmony, progressionMode: 'preset' } }),
                'Harmonie: Preset-Folge',
              )
            }
            title="Die oben gewählte Folge spielen"
          >
            Preset-Folge
          </button>
          <button
            type="button"
            className={isCustom ? 'is-active' : undefined}
            disabled={customSteps.length === 0}
            onClick={() =>
              onCommitSnapshotImmediate(
                (s) => ({ ...s, harmony: { ...s.harmony, progressionMode: 'custom' } }),
                'Harmonie: Eigener Baukasten',
              )
            }
            title={
              customSteps.length === 0
                ? 'Erst Akkorde hinzufügen oder eine Vorlage laden'
                : 'Die eigene Akkordfolge spielen'
            }
          >
            Eigener Baukasten
          </button>
        </div>

        <label className="inline-check" title="Stimmen bewegen sich auf kürzestem Weg zum nächsten Akkord (gemeinsame Töne bleiben liegen)">
          <input
            type="checkbox"
            checked={voiceLeading}
            onChange={(e) =>
              onCommitSnapshotImmediate(
                (s) => ({
                  ...s,
                  harmony: { ...s.harmony, voiceLeadingEnabled: e.target.checked },
                }),
                `Stimmführung ${e.target.checked ? 'an' : 'aus'}`,
              )
            }
          />
          Stimmführung
        </label>

        <select
          value=""
          onChange={(e) => {
            if (e.target.value) loadTemplate(e.target.value);
          }}
          title="Kadenz als Startpunkt in den Baukasten laden (überschreibt die eigene Folge)"
        >
          <option value="">Vorlage laden…</option>
          <optgroup label="Kadenzen (leitereigen)">
            {Object.values(PROGRESSION_PRESETS)
              .filter((p) => p.group === 'cadence')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
          </optgroup>
          <optgroup label="Klassische Kadenzen">
            {Object.values(PROGRESSION_PRESETS)
              .filter((p) => p.group === 'classical')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
          </optgroup>
          <optgroup label="Techno-Parallel">
            {Object.values(PROGRESSION_PRESETS)
              .filter((p) => p.group === 'techno')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
          </optgroup>
        </select>

        {customSteps.length > 0 && (
          <>
            <button
              type="button"
              className="btn-sm"
              onClick={() =>
                commitSteps(
                  customSteps.map((st) => ({
                    ...st,
                    durationBeats: newDuration,
                    transitionBeats: Math.min(st.transitionBeats, newDuration / 2),
                  })),
                  `Alle Akkorde: ${newDuration} Beats`,
                )
              }
              title={`Alle Akkorde der Folge auf die gewählte Länge setzen (${newDuration} Beats)`}
            >
              <Ruler size={11} /> Alle = {newDuration} Beats
            </button>
            <button
              type="button"
              className="btn-sm"
              disabled={customSteps.length * 2 > MAX_CUSTOM_STEPS}
              onClick={() =>
                commitSteps(
                  [...customSteps, ...customSteps.map((st) => ({ ...st, id: nextUiId('chord') }))],
                  'Folge verdoppelt',
                )
              }
              title="Hängt die ganze Folge noch einmal an (zum Variieren der zweiten Hälfte)"
            >
              <CopyPlus size={11} /> Folge ×2
            </button>
          </>
        )}

        {customSteps.length > 0 && (
          <button
            type="button"
            className="btn-sm btn-ghost btn-danger"
            onClick={() =>
              onCommitSnapshotImmediate(
                (s) => ({
                  ...s,
                  harmony: { ...s.harmony, customSteps: [], progressionMode: 'preset' },
                }),
                'Baukasten geleert',
              )
            }
            title="Alle eigenen Akkorde entfernen"
          >
            <Trash2 size={11} /> Leeren
          </button>
        )}

        <span className="muted-note" style={{ marginLeft: 'auto' }}>
          {timeline.steps.length} Akkorde · Gesamt: {formatBeats(timeline.totalBeats, beatsPerBar)}
          {isCustom && ` (max. ${MAX_CUSTOM_STEPS})`}
        </span>
        <button type="button" className="btn-ghost btn-sm" onClick={onClose} title="Einklappen">
          <X size={13} />
        </button>
      </div>

      <div className="degree-bar">
        <span className="muted-note">Neue Akkorde:</span>
        <select
          value={NEW_LENGTH_OPTIONS.includes(newDuration) ? newDuration : 'custom'}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) setNewDuration(v);
          }}
          title="Wie viele Beats neue Akkorde gehalten werden"
        >
          {NEW_LENGTH_OPTIONS.map((b) => (
            <option key={b} value={b}>
              {b} Beats ({formatBars(b, beatsPerBar)})
            </option>
          ))}
          {!NEW_LENGTH_OPTIONS.includes(newDuration) && (
            <option value="custom">{newDuration} Beats</option>
          )}
        </select>
        <input
          type="number"
          min={MIN_STEP_BEATS}
          max={MAX_STEP_BEATS}
          step={0.5}
          value={newDuration}
          style={{ width: 58 }}
          title="Freie Länge in Beats für neue Akkorde"
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) setNewDuration(Math.max(MIN_STEP_BEATS, Math.min(MAX_STEP_BEATS, v)));
          }}
        />
        <span
          className="muted-note"
          style={{ marginLeft: 6 }}
          title="Hängt den leitereigenen Dreiklang an. Septimen, Sexten, klassische Akkorde usw. danach im Akkord-Menü der Kachel auswählen."
        >
          Dreiklang anhängen:
        </span>
        {QUICK_BUTTONS.map(({ degree, accidental }) => {
          const p = previewDegreeChord(harmony, degree, accidental, DIATONIC_TRIAD);
          return (
            <button
              key={`${accidental}${degree}`}
              type="button"
              className={`degree-btn${accidental !== 0 ? ' is-borrowed' : ''}`}
              disabled={customSteps.length >= MAX_CUSTOM_STEPS}
              onClick={() => appendStep(degree, accidental)}
              title={
                accidental !== 0
                  ? `Geborgter Akkord ${p.roman} (${p.name}) – leiterfremde Farbe`
                  : `${p.roman} (${p.name}) anhängen`
              }
            >
              <span className="degree-roman">{p.roman}</span>
              <span className="degree-name">{p.name}</span>
            </button>
          );
        })}
      </div>

      {!isCustom && (
        <div className="muted-note" style={{ padding: '0 2px' }}>
          Es läuft die Preset-Folge „
          {PROGRESSION_PRESETS[harmony.progressionId as keyof typeof PROGRESSION_PRESETS]?.label ??
            harmony.progressionId}
          “. Klicke eine Stufe oder lade eine Vorlage, um eine eigene Folge zu bauen.
          {customSteps.length > 0 && ' (Deine eigene Folge ist gespeichert – „Eigener Baukasten“ wählen.)'}
        </div>
      )}

      {timeline.steps.length > 1 && (
        <div className="chord-overview-lane">
          <span className="chord-overview-lane-label">Akkord</span>
          <div className="chord-overview" title="Übersicht der ganzen Folge (Breite = Haltedauer)">
            {timeline.steps.map((st, idx) => (
              <div
                key={`ov-${idx}`}
                className={`chord-overview-seg${idx === activeIdx ? ' is-playing' : ''}`}
                style={{ flexGrow: st.durationBeats }}
                title={`#${idx + 1} ${st.degreeLabel} · ${st.chordName} · ${formatBeats(st.durationBeats, beatsPerBar)}`}
              >
                {st.chordName}
              </div>
            ))}
          </div>
        </div>
      )}
      {timeline.steps.length > 0 && (isCustom || timeline.steps.length > 1) && (
        <div className="chord-overview-lane">
          <span className="chord-overview-lane-label">Bass</span>
          <div
            className="chord-overview is-bass"
            title="Bass-Spur: welcher Ton die Bass-Instrumente (Sub, Acid, Reese, FM) unter jedem Akkord spielen"
          >
            {timeline.steps.map((st, idx) => (
              <div
                key={`bass-${idx}`}
                className={`chord-overview-seg${st.bassPc < 0 ? ' is-rest' : ''}${idx === activeIdx ? ' is-playing' : ''}`}
                style={{ flexGrow: st.durationBeats }}
                title={
                  st.bassPc < 0
                    ? `#${idx + 1}: Bass pausiert`
                    : `#${idx + 1}: Bass ${NOTE_NAMES[st.bassPc] ?? ''}${st.bassPc !== st.rootPc ? ' (Umkehrung / Slash-Akkord)' : ''}`
                }
              >
                {st.bassPc < 0 ? '–' : NOTE_NAMES[st.bassPc]}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="chord-step-row">
        {timeline.steps.map((st, idx) => {
          const cfg = isCustom ? customSteps[idx] : undefined;
          const isActive = idx === activeIdx;
          const voicing = st.frame.chordNotesMidi.map(midiToNoteLabel).join(' · ');
          const rootDeg = cfg
            ? { degree: cfg.degree, accidental: cfg.accidental }
            : offsetToDegree(harmony.scaleId, st.rootOffset);
          const fnLabel =
            st.functionLabel ??
            (st.parallelScale
              ? null
              : chordFunctionSymbol(harmony.scaleId, rootDeg.degree, rootDeg.accidental, st.intervals));
          return (
            <div
              key={cfg?.id ?? `preset-${idx}`}
              className={`chord-step-card${isActive ? ' is-playing' : ''}${cfg ? '' : ' is-readonly'}`}
            >
              <div className="chord-step-head">
                <span className="chord-step-label">
                  <span className="chord-step-index">#{idx + 1}</span>{' '}
                  {fnLabel && <span className="chord-step-fn">{fnLabel}</span>}{' '}
                  <b>{st.degreeLabel}</b> · {st.chordName}
                </span>
                {cfg && (
                  <div style={{ display: 'flex', gap: 2 }}>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={idx === 0}
                      onClick={() => moveStep(idx, -1)}
                      title="Nach links"
                    >
                      <ArrowLeft size={11} />
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={idx === customSteps.length - 1}
                      onClick={() => moveStep(idx, 1)}
                      title="Nach rechts"
                    >
                      <ArrowRight size={11} />
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={customSteps.length >= MAX_CUSTOM_STEPS}
                      onClick={() => {
                        const next = [...customSteps];
                        next.splice(idx + 1, 0, { ...cfg, id: nextUiId('chord') });
                        commitSteps(next, `Akkord dupliziert: ${st.chordName}`);
                      }}
                      title="Duplizieren"
                    >
                      <Copy size={11} />
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-sm btn-danger"
                      onClick={() => {
                        const next = customSteps.filter((_, i) => i !== idx);
                        if (next.length === 0) {
                          onCommitSnapshotImmediate(
                            (s) => ({
                              ...s,
                              harmony: { ...s.harmony, customSteps: [], progressionMode: 'preset' },
                            }),
                            'Letzten Akkord gelöscht',
                          );
                        } else {
                          commitSteps(next, `Akkord gelöscht: ${st.chordName}`);
                        }
                      }}
                      title="Löschen"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                )}
              </div>

              {cfg ? (
                <>
                  <div className="chord-step-fields">
                    <select
                      value={cfg.accidental}
                      onChange={(e) =>
                        updateStep(
                          idx,
                          { accidental: Number(e.target.value) as -1 | 0 | 1 },
                          'Alteration geändert',
                        )
                      }
                      title="Alteration: b = tiefer (geborgter Akkord), # = höher"
                    >
                      <option value={-1}>b</option>
                      <option value={0}>♮</option>
                      <option value={1}>#</option>
                    </select>
                    <select
                      value={cfg.degree}
                      onChange={(e) =>
                        updateStep(idx, { degree: Number(e.target.value) }, 'Stufe geändert')
                      }
                      title="Grundton (Skalenstufe) – die Akkord-Farbe bleibt erhalten"
                    >
                      {ROMAN.map((r, d) => (
                        <option key={r} value={d}>
                          {r}
                        </option>
                      ))}
                    </select>
                    {(() => {
                      const menu = menuFor(cfg.degree, cfg.accidental);
                      const selected = findChordMenuOption(menu, harmony, cfg);
                      return (
                        <select
                          className="chord-menu-select"
                          value={selected?.key ?? '__current'}
                          onChange={(e) =>
                            applyMenuOption(idx, cfg, menu.find((o) => o.key === e.target.value))
                          }
                          title={
                            selected?.hint ??
                            'Funktion & Akkord – nach Funktion sortiert, oben die einfachen leitereigenen Dreiklänge, je mehr Zusatztöne desto weiter unten'
                          }
                          style={{ flex: 1, minWidth: 0 }}
                        >
                          {!selected && (
                            <option value="__current">
                              {fnLabel ?? st.degreeLabel} · {st.chordName.split('/')[0]}
                            </option>
                          )}
                          {groupChordMenu(menu).map((g) => (
                            <optgroup
                              key={g.group}
                              label={g.group === 'colours' ? `${g.label} (${ROMAN[cfg.degree] ?? ''}${cfg.accidental === -1 ? ' b' : cfg.accidental === 1 ? ' #' : ''})` : g.label}
                            >
                              {g.options.map((o) => (
                                <option key={o.key} value={o.key} title={o.hint}>
                                  {o.label}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      );
                    })()}
                  </div>

                  <div className="chord-bass-row">
                    <span className="chord-bass-label">Bass</span>
                    <div className="chord-step-fields">
                      <select
                        value={cfg.bass ?? 'root'}
                        onChange={(e) => {
                          const bass = e.target.value as BassMode;
                          updateStep(
                            idx,
                            bass === 'degree'
                              ? { bass, bassDegree: cfg.bassDegree ?? cfg.degree, bassAccidental: cfg.bassAccidental ?? 0 }
                              : { bass },
                            `Bass: ${BASS_MODE_LABELS[bass]}`,
                          );
                        }}
                        title="Welcher Ton im Bass liegt – Umkehrungen legen Terz, Quinte oder Septime nach unten"
                        style={{ flex: '1 1 100%', minWidth: 0 }}
                      >
                        {(Object.keys(BASS_MODE_LABELS) as BassMode[]).map((m) => (
                          <option key={m} value={m}>
                            {BASS_MODE_LABELS[m]}
                          </option>
                        ))}
                      </select>
                      {cfg.bass === 'degree' && (
                        <>
                          <select
                            value={cfg.bassAccidental ?? 0}
                            onChange={(e) =>
                              updateStep(
                                idx,
                                { bassAccidental: Number(e.target.value) as -1 | 0 | 1 },
                                'Basston-Alteration geändert',
                              )
                            }
                            title="Basston erniedrigen / erhöhen"
                          >
                            <option value={-1}>b</option>
                            <option value={0}>♮</option>
                            <option value={1}>#</option>
                          </select>
                          <select
                            value={cfg.bassDegree ?? 0}
                            onChange={(e) =>
                              updateStep(idx, { bassDegree: Number(e.target.value) }, 'Basston geändert')
                            }
                            title="Freier Basston (Skalenstufe)"
                          >
                            {ROMAN.map((r, d) => (
                              <option key={r} value={d}>
                                {r} · {degreeNoteName(d, cfg.bassAccidental ?? 0)}
                              </option>
                            ))}
                          </select>
                        </>
                      )}
                    </div>
                    <label
                      className="inline-check"
                      title="Grundtonloses Voicing: Akkord-Instrumente lassen den Grundton weg (er liegt z. B. nur im Bass oder fehlt ganz)"
                    >
                      <input
                        type="checkbox"
                        checked={cfg.omitRoot === true}
                        onChange={(e) =>
                          updateStep(
                            idx,
                            { omitRoot: e.target.checked },
                            e.target.checked ? 'Akkord ohne Grundton' : 'Akkord mit Grundton',
                          )
                        }
                      />
                      Akkord ohne Grundton
                    </label>
                  </div>

                  <div className="chord-step-fields">
                    <span className="muted-note">Halten</span>
                    {[1, 2, 4, 8, 16].map((b) => (
                      <button
                        key={b}
                        type="button"
                        className={`preset-chip${cfg.durationBeats === b ? ' is-active' : ''}`}
                        onClick={() => updateStep(idx, { durationBeats: b }, `Länge: ${b} Beats`)}
                      >
                        {b}
                      </button>
                    ))}
                    <input
                      type="number"
                      min={MIN_STEP_BEATS}
                      max={MAX_STEP_BEATS}
                      step={0.5}
                      value={cfg.durationBeats}
                      style={{ width: 54 }}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (!Number.isFinite(v)) return;
                        updateStep(
                          idx,
                          { durationBeats: Math.max(MIN_STEP_BEATS, Math.min(MAX_STEP_BEATS, v)) },
                          `Länge: ${v} Beats`,
                        );
                      }}
                      title="Haltedauer in Beats (0,5 – 128)"
                    />
                    <span className="muted-note">
                      Beats = {formatBars(cfg.durationBeats, beatsPerBar)}
                    </span>
                  </div>

                  <div className="chord-step-fields">
                    <span className="muted-note">Übergang</span>
                    <select
                      value={cfg.transitionType}
                      onChange={(e) => {
                        const t = e.target.value as ChordTransitionType;
                        updateStep(
                          idx,
                          {
                            transitionType: t,
                            transitionBeats:
                              t === 'cut' ? 0 : cfg.transitionBeats > 0 ? cfg.transitionBeats : 0.5,
                          },
                          `Übergang: ${t}`,
                        );
                      }}
                      title={TRANSITIONS.find((t) => t.value === cfg.transitionType)?.hint}
                    >
                      {TRANSITIONS.map((t) => (
                        <option key={t.value} value={t.value} title={t.hint}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    {cfg.transitionType !== 'cut' && (
                      <>
                        <input
                          type="number"
                          min={0.25}
                          max={2}
                          step={0.25}
                          value={cfg.transitionBeats}
                          style={{ width: 50 }}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (!Number.isFinite(v)) return;
                            updateStep(
                              idx,
                              { transitionBeats: Math.max(0.25, Math.min(2, v)) },
                              'Übergangsdauer geändert',
                            );
                          }}
                          title="Dauer des Übergangs am Ende dieses Akkords (Beats)"
                        />
                        <span className="muted-note">Beats</span>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <div className="muted-note">{formatBeats(st.durationBeats, beatsPerBar)}</div>
              )}

              <div className="chord-voicing" title="Berechnete Töne dieses Akkords">
                Bass{' '}
                {st.bassPc < 0
                  ? '– (Pause)'
                  : midiToNoteLabel(st.frame.bassMidi ?? st.frame.rootMidi)}{' '}
                · {voicing}
                {st.omitRoot ? ' (ohne Grundton)' : ''}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
