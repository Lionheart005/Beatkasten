import type { ReactNode } from 'react';
import { ExternalLink, RotateCcw, Snowflake, Spline, Unlink } from 'lucide-react';
import { findLane, updateClip, updateTrack } from '../../core/arrangement/edit';
import { tempoMapOf } from '../../core/arrangement/tempoMap';
import type {
  ArrangementClip,
  ArrangementDoc,
  AudioClip,
  AutomationTarget,
  FadeShape,
  LayerOverride,
  SectionClip,
} from '../../core/arrangement/types';
import type { SectionItem } from '../../core/state/types';
import { NOTE_NAMES } from '../../core/theory/scales';
import { FxChainEditor } from './FxChainEditor';
import { layerParamSchema } from './automationMeta';
import { defaultRegistry } from '../../core/defaultRegistry';
import { LiveRange, formatPan, formatPercent } from './controls';
import { formatBeatsAsBars } from './geometry';
import type { ArrangementStore } from './useArrangementStore';

export const FADE_SHAPE_LABELS: Readonly<Record<FadeShape, string>> = {
  'equal-power': 'Gleiche Lautheit',
  linear: 'Linear',
  exp: 'Exponentiell',
  's-curve': 'S-Kurve',
};

interface InspectorProps {
  arr: ArrangementStore;
  doc: ArrangementDoc;
  sections: readonly SectionItem[];
  onOpenInBeatkasten: (sectionId: string) => void;
  onDetachVariant: (clip: SectionClip) => void;
  onAddLane: (target: AutomationTarget, label: string, value: number) => void;
  clipActions?: (clip: ArrangementClip) => ReactNode;
  selectionActions?: () => ReactNode;
  onFreezeTrack?: (trackId: string) => void;
}

export function TimelineInspector(props: InspectorProps) {
  const { arr, doc } = props;
  if (arr.inspectMaster) return <MasterInspector {...props} />;
  const clipId = arr.selectedClipIds.length === 1 ? arr.selectedClipIds[0] : null;
  if (clipId) {
    for (const t of doc.tracks) {
      const clip = t.clips.find((c) => c.id === clipId);
      if (clip) return <ClipInspector {...props} clip={clip} trackColor={t.color} />;
    }
  }
  if (arr.selectedClipIds.length > 1) {
    return (
      <div className="tl-inspector">
        <div className="muted-note">
          {arr.selectedClipIds.length} Clips ausgewählt · Entf = löschen · Strg+D = duplizieren · Pfeile = verschieben · S = am Playhead teilen
        </div>
        {props.selectionActions?.()}
      </div>
    );
  }
  const track = doc.tracks.find((t) => t.id === arr.selectedTrackId);
  if (track) return <TrackInspector {...props} trackId={track.id} />;
  return (
    <div className="tl-inspector">
      <div className="muted-note">
        Abschnitte links in die Timeline ziehen. Clip anklicken = Clip-Einstellungen (Layer an/aus, Pegel, Fades) ·
        Spurkopf anklicken = Spur-Effekte · „Master“ = Effekte auf den ganzen Song.
      </div>
    </div>
  );
}

function ClipInspector({
  arr,
  doc,
  sections,
  clip,
  trackColor,
  onOpenInBeatkasten,
  onDetachVariant,
  onAddLane,
  clipActions,
}: InspectorProps & { clip: ArrangementClip; trackColor: string }) {
  const tm = tempoMapOf(doc);
  const bpb = tm.beatsPerBarAt(clip.startBeat);
  const section = clip.kind === 'section' ? sections.find((s) => s.id === clip.sectionId) : undefined;
  const live = (patch: Partial<SectionClip> | Partial<AudioClip>) => arr.preview((b) => updateClip(b, clip.id, patch));
  const commit = (patch: Partial<SectionClip> | Partial<AudioClip>, label: string) =>
    arr.commit((d) => updateClip(d, clip.id, patch), label);

  return (
    <div className="tl-inspector">
      <div className="tl-inspector-col">
        <div className="tl-inspector-title" style={{ borderColor: section?.color ?? trackColor }}>
          {clip.kind === 'section' ? (section ? `Clip · ${section.name}` : 'Clip · Abschnitt fehlt') : 'Audio-Clip'}
        </div>
        <div className="muted-note">
          Start Takt {tm.formatPosition(clip.startBeat)} · Länge {formatBeatsAsBars(clip.lengthBeats, bpb)}
          {clip.kind === 'section' && clip.sourceOffsetBeats > 0 && ` · ab Beat ${clip.sourceOffsetBeats.toFixed(2).replace(/\.?0+$/, '')} des Abschnitts`}
        </div>
        <label className="tl-field">
          <span>Lautstärke</span>
          <LiveRange
            min={0}
            max={2}
            value={clip.gain}
            accent={trackColor}
            onLive={(v) => live({ gain: v })}
            onCommit={() => arr.commitPreview('Clip-Lautstärke')}
            onDoubleClick={() => commit({ gain: 1 }, 'Clip-Lautstärke zurückgesetzt')}
          />
          <span className="schema-value">{formatPercent(clip.gain)}</span>
        </label>
        {(['fadeIn', 'fadeOut'] as const).map((key) => (
          <label key={key} className="tl-field">
            <span>{key === 'fadeIn' ? 'Einblenden' : 'Ausblenden'}</span>
            <input
              type="number"
              min={0}
              max={clip.lengthBeats}
              step={0.25}
              value={Number(clip[key].beats.toFixed(3))}
              style={{ width: 62 }}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) commit({ [key]: { ...clip[key], beats: Math.max(0, Math.min(clip.lengthBeats, v)) } }, 'Fade-Länge');
              }}
              title="Länge in Beats"
            />
            <span className="muted-note">Beats</span>
            <select
              value={clip[key].shape}
              onChange={(e) => commit({ [key]: { ...clip[key], shape: e.target.value as FadeShape } }, 'Fade-Form')}
            >
              {(Object.keys(FADE_SHAPE_LABELS) as FadeShape[]).map((s) => (
                <option key={s} value={s}>
                  {FADE_SHAPE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        ))}
        {clip.kind === 'section' && (
          <>
            <label className="tl-field">
              <span>Transponieren</span>
              <input
                type="number"
                min={-12}
                max={12}
                step={1}
                value={clip.transposeSemitones ?? 0}
                style={{ width: 56 }}
                onChange={(e) => {
                  const v = Math.round(Number(e.target.value));
                  if (Number.isFinite(v)) commit({ transposeSemitones: Math.max(-12, Math.min(12, v)) }, 'Transponiert');
                }}
              />
              <span className="muted-note">
                Halbtöne
                {section &&
                  ` → Tonart ${NOTE_NAMES[(((section.snapshot.harmony.rootNote + (clip.transposeSemitones ?? 0)) % 12) + 12) % 12]}`}
              </span>
            </label>
            <label className="tl-field" title="Nach dem Clip-Ende laufen Hall und Echo noch so viele Beats weiter (Stimmen verstummen)">
              <span>Ausklang</span>
              <input
                type="number"
                min={0}
                max={32}
                step={1}
                value={clip.tailBeats ?? 0}
                style={{ width: 56 }}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) commit({ tailBeats: Math.max(0, Math.min(32, v)) }, 'Ausklang');
                }}
              />
              <span className="muted-note">Beats Hall &amp; Echo</span>
            </label>
          </>
        )}
        {clip.kind === 'audio' && (
          <label className="inline-check">
            <input type="checkbox" checked={clip.reversed === true} onChange={(e) => commit({ reversed: e.target.checked }, e.target.checked ? 'Rückwärts' : 'Vorwärts')} />
            Rückwärts abspielen
          </label>
        )}
        <div className="tl-btn-row">
          <label className="inline-check">
            <input type="checkbox" checked={clip.muted === true} onChange={(e) => commit({ muted: e.target.checked }, e.target.checked ? 'Clip stumm' : 'Clip an')} />
            Stumm
          </label>
          {clipActions?.(clip)}
          {clip.kind === 'section' && section && (
            <>
              <button type="button" className="btn-sm" onClick={() => onOpenInBeatkasten(section.id)} title="Wechselt in den Beatkasten und lädt diesen Abschnitt">
                <ExternalLink size={11} /> Im Beatkasten öffnen
              </button>
              <button
                type="button"
                className="btn-sm"
                onClick={() => onDetachVariant(clip)}
                title="Legt eine Kopie des Abschnitts (mit den Layer-Einstellungen dieses Clips) an und hängt den Clip daran – Änderungen wirken dann nur hier"
              >
                <Unlink size={11} /> Als Variante abkoppeln
              </button>
            </>
          )}
        </div>
      </div>

      {clip.kind === 'section' && section && (
        <div className="tl-inspector-col is-wide">
          <div className="tl-inspector-title">Layer in diesem Clip</div>
          <div className="tl-layer-table">
            {section.snapshot.layers.map((layer) => {
              const ov: LayerOverride = clip.layerOverrides[layer.id] ?? {};
              const setOv = (patch: LayerOverride | null, mode: 'live' | 'commit', label = 'Layer im Clip') => {
                const next = { ...clip.layerOverrides };
                if (patch === null) delete next[layer.id];
                else {
                  const merged: Record<string, unknown> = { ...ov, ...patch };
                  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
                  if (Object.keys(merged).length === 0) delete next[layer.id];
                  else next[layer.id] = merged as LayerOverride;
                }
                if (mode === 'live') live({ layerOverrides: next });
                else commit({ layerOverrides: next }, label);
              };
              const baseOn = layer.enabled && !layer.muted;
              const state = ov.enabled === undefined ? 'section' : ov.enabled ? 'on' : 'off';
              const level = ov.level ?? layer.level;
              const pan = ov.pan ?? layer.pan;
              const laneLevel = findLane(doc, { scope: 'clip-layer', clipId: clip.id, layerId: layer.id, param: 'level' });
              return (
                <div key={layer.id} className={`tl-layer-row${(state === 'off' || (state === 'section' && !baseOn)) ? ' is-off' : ''}`}>
                  <span className="tl-layer-dot" style={{ background: layer.color }} />
                  <span className="tl-layer-name" title={layer.name}>
                    {layer.name}
                  </span>
                  <div className="segmented tl-tri">
                    {(['section', 'on', 'off'] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={state === s ? 'is-active' : undefined}
                        onClick={() =>
                          setOv({ enabled: s === 'section' ? undefined : s === 'on' }, 'commit', `${layer.name}: ${s === 'on' ? 'an' : s === 'off' ? 'aus' : 'wie Abschnitt'}`)
                        }
                        title={s === 'section' ? `Wie im Abschnitt (${baseOn ? 'an' : 'aus'})` : s === 'on' ? 'In diesem Clip an' : 'In diesem Clip aus'}
                      >
                        {s === 'section' ? 'Abschn.' : s === 'on' ? 'An' : 'Aus'}
                      </button>
                    ))}
                  </div>
                  <LiveRange
                    min={0}
                    max={1.5}
                    value={level}
                    accent={layer.color}
                    style={{ width: 90 }}
                    title={`Pegel ${formatPercent(level)}${ov.level !== undefined ? ' (eigener Wert)' : ''}`}
                    onLive={(v) => setOv({ level: v }, 'live')}
                    onCommit={() => arr.commitPreview(`${layer.name}: Pegel`)}
                    onDoubleClick={() => setOv({ level: undefined }, 'commit', `${layer.name}: Pegel wie Abschnitt`)}
                  />
                  <LiveRange
                    min={-1}
                    max={1}
                    value={pan}
                    accent={layer.color}
                    style={{ width: 64 }}
                    title={`Pan ${formatPan(pan)}${ov.pan !== undefined ? ' (eigener Wert)' : ''}`}
                    onLive={(v) => setOv({ pan: v }, 'live')}
                    onCommit={() => arr.commitPreview(`${layer.name}: Pan`)}
                    onDoubleClick={() => setOv({ pan: undefined }, 'commit', `${layer.name}: Pan wie Abschnitt`)}
                  />
                  <button
                    type="button"
                    className={`tl-auto-btn${laneLevel ? ' is-active' : ''}`}
                    onClick={() =>
                      onAddLane({ scope: 'clip-layer', clipId: clip.id, layerId: layer.id, param: 'level' }, `${layer.name} · Pegel (Clip)`, level)
                    }
                    title="Pegel dieses Layers über die Clip-Dauer mit Keyframes steuern (z. B. Kick erst ab Takt 17)"
                  >
                    <Spline size={10} />
                  </button>
                  <button
                    type="button"
                    className={`tl-auto-btn${findLane(doc, { scope: 'clip-layer', clipId: clip.id, layerId: layer.id, param: 'enabled' }) ? ' is-active' : ''}`}
                    onClick={() =>
                      onAddLane(
                        { scope: 'clip-layer', clipId: clip.id, layerId: layer.id, param: 'enabled' },
                        `${layer.name} · An/Aus (Clip)`,
                        state === 'off' || (state === 'section' && !baseOn) ? 0 : 1,
                      )
                    }
                    title="An/Aus-Balken: Layer innerhalb des Clips ein- und ausschalten (Keyframes in Stufen)"
                  >
                    I/O
                  </button>
                  <select
                    className="tl-param-pick"
                    value=""
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      const [domain, cardId, paramId] = v.split('|') as ['voice' | 'processor', string, string];
                      const info = layerParamSchema(layer, domain, cardId, paramId);
                      if (!info) return;
                      onAddLane(
                        { scope: 'clip-layer-param', clipId: clip.id, layerId: layer.id, domain, cardId, paramId },
                        `${layer.name} · ${info.owner} ${info.schema.label} (Clip)`,
                        info.base,
                      );
                    }}
                    title="Beliebigen Regler dieses Layers im Clip mit Keyframes steuern (z. B. Filter über 16 Takte öffnen)"
                  >
                    <option value="">Regler …</option>
                    <optgroup label="Instrument">
                      {(defaultRegistry.getVoice(layer.voice.moduleId)?.parameters ?? [])
                        .filter((p) => p.modulatable && !p.hidden)
                        .map((p) => (
                          <option key={p.id} value={`voice|voice|${p.id}`}>
                            {p.label}
                          </option>
                        ))}
                    </optgroup>
                    {layer.processorChain.map((card) => {
                      const mod = defaultRegistry.getProcessor(card.moduleId);
                      if (!mod) return null;
                      return (
                        <optgroup key={card.id} label={mod.displayName}>
                          {mod.parameters
                            .filter((p) => p.modulatable && !p.hidden)
                            .map((p) => (
                              <option key={p.id} value={`processor|${card.id}|${p.id}`}>
                                {p.label}
                              </option>
                            ))}
                        </optgroup>
                      );
                    })}
                  </select>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={!clip.layerOverrides[layer.id]}
                    onClick={() => setOv(null, 'commit', `${layer.name}: wie Abschnitt`)}
                    title="Auf Abschnitt zurücksetzen"
                  >
                    <RotateCcw size={10} />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="muted-note">
            Tipp: Clip mit S am Playhead teilen und im zweiten Teil weitere Layer einschalten – die Musik läuft nahtlos weiter.
          </div>
        </div>
      )}
    </div>
  );
}

function TrackInspector({ arr, doc, trackId, onAddLane, onFreezeTrack }: InspectorProps & { trackId: string }) {
  const track = doc.tracks.find((t) => t.id === trackId)!;
  return (
    <div className="tl-inspector">
      <div className="tl-inspector-col">
        <div className="tl-inspector-title" style={{ borderColor: track.color }}>
          Spur · {track.name}
        </div>
        <label className="tl-field">
          <span>Name</span>
          <input
            type="text"
            value={track.name}
            onChange={(e) => arr.preview((b) => updateTrack(b, track.id, { name: e.target.value }))}
            onBlur={() => arr.commitPreview('Spur umbenannt')}
          />
        </label>
        <label className="tl-field">
          <span>Farbe</span>
          <input type="color" value={track.color} onChange={(e) => arr.commit((d) => updateTrack(d, track.id, { color: e.target.value }), 'Spurfarbe')} />
        </label>
        <label className="tl-field">
          <span>Höhe</span>
          <LiveRange
            min={36}
            max={160}
            step={2}
            value={track.heightPx ?? 62}
            onLive={(v) => arr.preview((b) => updateTrack(b, track.id, { heightPx: v }))}
            onCommit={() => arr.commitPreview('Spurhöhe')}
          />
        </label>
        <div className="muted-note">
          {track.kind === 'audio' ? 'Audio-Spur: Aufnahmen und Dateien.' : 'Abschnitts-Spur: Clips verweisen live auf Abschnitte des Beatkastens.'}
        </div>
        {track.kind === 'section' && onFreezeTrack && track.clips.length > 0 && (
          <button type="button" className="btn-sm" onClick={() => onFreezeTrack(track.id)} title="Alle Abschnitts-Clips dieser Spur als Audio vorberechnen (spart CPU)">
            <Snowflake size={11} /> Ganze Spur einfrieren
          </button>
        )}
      </div>
      <div className="tl-inspector-col is-wide">
        <div className="tl-inspector-title">Spur-Effekte</div>
        <FxChainEditor
          cards={track.fx}
          accent={track.color}
          onCommit={(fx, label) => arr.commit((d) => updateTrack(d, track.id, { fx }), label)}
          onLive={(fx) => arr.preview((b) => updateTrack(b, track.id, { fx }))}
          onLiveEnd={(label) => arr.commitPreview(label)}
          hasLane={(cardId, paramId) => !!findLane(doc, { scope: 'track-fx', trackId: track.id, cardId, paramId })}
          onAddLane={(cardId, paramId, label, value) =>
            onAddLane({ scope: 'track-fx', trackId: track.id, cardId, paramId }, `${track.name} · ${label}`, value)
          }
        />
      </div>
    </div>
  );
}

function MasterInspector({ arr, doc, onAddLane }: InspectorProps) {
  return (
    <div className="tl-inspector">
      <div className="tl-inspector-col">
        <div className="tl-inspector-title" style={{ borderColor: '#38bdf8' }}>
          Master (ganzer Song)
        </div>
        <label className="tl-field">
          <span>Lautstärke</span>
          <LiveRange
            min={0}
            max={2}
            value={doc.masterGain}
            onLive={(v) => arr.preview((b) => ({ ...b, masterGain: v }))}
            onCommit={() => arr.commitPreview('Master-Lautstärke')}
          />
          <span className="schema-value">{formatPercent(doc.masterGain)}</span>
          <button type="button" className={`tl-auto-btn${findLane(doc, { scope: 'master', param: 'gain' }) ? ' is-active' : ''}`} onClick={() => onAddLane({ scope: 'master', param: 'gain' }, 'Master · Lautstärke', doc.masterGain)}>
            <Spline size={10} />
          </button>
        </label>
        <label className="tl-field">
          <span>Glue</span>
          <LiveRange
            min={0}
            max={1}
            value={doc.masterGlue}
            onLive={(v) => arr.preview((b) => ({ ...b, masterGlue: v }))}
            onCommit={() => arr.commitPreview('Master-Glue')}
          />
          <span className="schema-value">{formatPercent(doc.masterGlue)}</span>
          <button type="button" className={`tl-auto-btn${findLane(doc, { scope: 'master', param: 'glue' }) ? ' is-active' : ''}`} onClick={() => onAddLane({ scope: 'master', param: 'glue' }, 'Master · Glue', doc.masterGlue)}>
            <Spline size={10} />
          </button>
        </label>
        <div className="muted-note">Glue (sanfte Verdichtung) und Limiter laufen einmal auf dem ganzen Song.</div>
      </div>
      <div className="tl-inspector-col is-wide">
        <div className="tl-inspector-title">Master-Effekte</div>
        <FxChainEditor
          cards={doc.masterFx}
          accent="#38bdf8"
          onCommit={(masterFx, label) => arr.commit((d) => ({ ...d, masterFx }), label)}
          onLive={(masterFx) => arr.preview((b) => ({ ...b, masterFx }))}
          onLiveEnd={(label) => arr.commitPreview(label)}
          hasLane={(cardId, paramId) => !!findLane(doc, { scope: 'master-fx', cardId, paramId })}
          onAddLane={(cardId, paramId, label, value) => onAddLane({ scope: 'master-fx', cardId, paramId }, `Master · ${label}`, value)}
        />
      </div>
    </div>
  );
}
