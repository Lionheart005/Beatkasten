import { useCallback, useRef, type ReactNode } from 'react';
import { AudioWaveform, Snowflake, Sun, Trash2, Upload, Wand } from 'lucide-react';
import { freezeKeyForDoc } from '../../core/arrangement/clipSnapshot';
import {
  addClip,
  addTrack,
  createAudioClip,
  createTrack,
  findClip,
  referencedAssetIds,
  removeClips,
  secondsToBeatsAt,
  updateClip,
} from '../../core/arrangement/edit';
import { renderArrangement, sectionMapOf } from '../../core/arrangement/renderArrangement';
import { clipEndBeat, DEFAULT_FADE, type ArrangementClip, type ArrangementDoc, type SectionClip } from '../../core/arrangement/types';
import { detectRootMidi, peakOf } from '../../core/audio/analysis';
import { createDefaultLayer } from '../../core/state/presets';
import { WaveformCanvas } from '../components/WaveformCanvas';
import type { AudioPool } from '../audio/useAudioPool';
import type { StudioStore } from '../store/useStudioStore';
import { ASSET_DRAG_TYPE } from './MediaBrowser';
import { makeTimelineId, type ArrangementStore } from './useArrangementStore';

/**
 * Audio features of the timeline (phase D): pool panel, waveforms, file drops,
 * normalize, bounce, freeze / unfreeze.
 */
export function useTimelineAudio(studio: StudioStore, arr: ArrangementStore, pool: AudioPool) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const doc = arr.doc;
  const metas = pool.metas;

  /** Audio track to place on: the given one if it is an audio track, else first / new. */
  const audioTrackFor = (d: ArrangementDoc, trackId: string | null): { doc: ArrangementDoc; trackId: string } => {
    const given = trackId ? d.tracks.find((t) => t.id === trackId && t.kind === 'audio') : undefined;
    if (given) return { doc: d, trackId: given.id };
    const t = createTrack('audio', makeTimelineId, d.tracks.length);
    return { doc: addTrack(d, t), trackId: t.id };
  };

  const placeAssets = useCallback(
    (assetIds: readonly string[], trackId: string | null, beat: number) => {
      arr.commit((d) => {
        let { doc: next, trackId: tid } = audioTrackFor(d, trackId);
        let cursor = beat;
        const tm = arr.tempoMap;
        for (const id of assetIds) {
          const meta = (studio.project.assets ?? []).find((a) => a.id === id) ?? null;
          const entry = pool.get(id);
          const seconds = meta ? meta.lengthSamples / meta.sampleRate : entry ? entry.pcm.length / entry.pcm.sampleRate : 4;
          const len = secondsToBeatsAt(tm, cursor, seconds);
          next = addClip(next, tid, createAudioClip(makeTimelineId, id, cursor, len));
          cursor += len;
        }
        return next;
      }, 'Audio platziert');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [arr, pool, studio.project.assets],
  );

  const onDropAsset = useCallback(
    (assetId: string, trackId: string | null, beat: number) => placeAssets([assetId], trackId, beat),
    [placeAssets],
  );

  const onDropFiles = useCallback(
    async (files: File[], trackId: string | null, beat: number) => {
      const audio = files.filter((f) => f.type.startsWith('audio/') || /\.(wav|mp3|ogg|flac|m4a|aac|aif|aiff)$/i.test(f.name));
      if (audio.length === 0) return;
      const added = await pool.importFiles(audio);
      if (added.length > 0) placeAssets(added.map((a) => a.id), trackId, beat);
    },
    [placeAssets, pool],
  );

  const renderWaveform = useCallback(
    (clip: ArrangementClip, width: number, height: number): ReactNode => {
      const assetId = clip.kind === 'audio' ? clip.assetId : clip.frozenAssetId;
      if (!assetId) return null;
      const entry = pool.get(assetId);
      if (!entry) return <span className="tl-clip-badge" style={{ position: 'absolute', top: 18, left: 4 }}>lädt …</span>;
      const tm = arr.tempoMap;
      const durSec = tm.beatToSec(clipEndBeat(clip)) - tm.beatToSec(clip.startBeat);
      const sr = entry.pcm.sampleRate;
      return (
        <WaveformCanvas
          className="tl-wave"
          peaks={entry.peaks}
          startSample={(clip.kind === 'audio' ? clip.sourceOffsetSec : 0) * sr}
          spanSamples={Math.max(1, durSec * sr)}
          width={width}
          height={Math.max(4, height - 18)}
          reversed={clip.kind === 'audio' && clip.reversed === true}
        />
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pool.tick, arr.tempoMap],
  );

  const normalizeClip = useCallback(
    (clip: ArrangementClip) => {
      if (clip.kind !== 'audio') return;
      const entry = pool.get(clip.assetId);
      if (!entry) return;
      const tm = arr.tempoMap;
      const sr = entry.pcm.sampleRate;
      const s0 = Math.floor(clip.sourceOffsetSec * sr);
      const s1 = s0 + Math.ceil((tm.beatToSec(clipEndBeat(clip)) - tm.beatToSec(clip.startBeat)) * sr);
      const pk = peakOf([entry.pcm.left, entry.pcm.right], s0, s1);
      if (pk < 1e-5) return;
      arr.commit((d) => updateClip(d, clip.id, { gain: Math.min(2, 0.98 / pk) }), 'Normalisiert');
    },
    [arr, pool],
  );

  const sectionsMap = () => sectionMapOf(studio.project.sections);

  const freezeClip = useCallback(
    async (clip: SectionClip, silent = false): Promise<boolean> => {
      const d = arr.doc;
      const found = d ? findClip(d, clip.id) : null;
      const section = studio.project.sections.find((s) => s.id === clip.sectionId);
      if (!d || !found || !section) return false;
      const key = freezeKeyForDoc(d, clip, section.snapshot);
      const single: ArrangementDoc = {
        ...d,
        tracks: [
          {
            ...found.track,
            fx: [],
            muted: false,
            solo: false,
            level: 1,
            pan: 0,
            clips: [{ ...clip, gain: 1, fadeIn: DEFAULT_FADE, fadeOut: DEFAULT_FADE, frozenAssetId: undefined, frozenKey: undefined, tailBeats: 0 }],
          },
        ],
        masterFx: [],
        automation: d.automation.filter(
          (l) => (l.target.scope === 'clip-layer' || l.target.scope === 'clip-layer-param') && l.target.clipId === clip.id,
        ),
      };
      const r = renderArrangement(single, sectionsMap(), {
        startBeat: clip.startBeat,
        endBeat: clipEndBeat(clip),
        tailSeconds: 0,
        outputStage: 'raw-clips',
      });
      const meta = await pool.addAsset(
        { left: r.left, right: r.right, sampleRate: r.sampleRate, length: r.numSamples },
        `${section.name} (eingefroren)`,
        'freeze',
        { freezeKey: key },
      );
      arr.commit((x) => updateClip(x, clip.id, { frozenAssetId: meta.id, frozenKey: key }), 'Clip eingefroren');
      if (!silent) studio.showNotice(`„${section.name}“ eingefroren – spielt jetzt als Audio (entlastet die CPU)`);
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [arr, pool, studio],
  );

  const unfreezeClip = useCallback(
    (clip: SectionClip) => arr.commit((d) => updateClip(d, clip.id, { frozenAssetId: undefined, frozenKey: undefined }), 'Clip aufgetaut'),
    [arr],
  );

  const freezeTrack = useCallback(
    async (trackId: string) => {
      const t = arr.doc?.tracks.find((x) => x.id === trackId);
      if (!t) return;
      let n = 0;
      for (const c of t.clips) if (c.kind === 'section' && !c.frozenAssetId && (await freezeClip(c, true))) n++;
      studio.showNotice(`${n} Clip(s) eingefroren`);
    },
    [arr.doc, freezeClip, studio],
  );

  const bounceSelection = useCallback(async () => {
    const d = arr.doc;
    if (!d || arr.selectedClipIds.length === 0) return;
    const ids = new Set(arr.selectedClipIds);
    const clips = d.tracks.flatMap((t) => t.clips.filter((c) => ids.has(c.id)));
    const start = Math.min(...clips.map((c) => c.startBeat));
    const end = Math.max(...clips.map(clipEndBeat));
    const sub: ArrangementDoc = {
      ...d,
      tracks: d.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => ids.has(c.id)) })).filter((t) => t.clips.length > 0),
    };
    const assets = new Map(pool.collect(referencedAssetIds(sub)).map((a) => [a.id, { ...a, length: Math.min(a.left.length, a.right.length) }]));
    const r = renderArrangement(sub, sectionsMap(), {
      startBeat: start,
      endBeat: end,
      tailSeconds: 0,
      outputStage: 'pre-master',
      assets: (id) => assets.get(id),
    });
    const meta = await pool.addAsset(
      { left: r.left, right: r.right, sampleRate: r.sampleRate, length: r.numSamples },
      `Bounce ${arr.tempoMap.formatPosition(start)}`,
      'bounce',
    );
    const firstTrack = d.tracks.find((t) => t.clips.some((c) => ids.has(c.id)));
    let newId = '';
    arr.commit((x) => {
      let next = removeClips(x, [...ids]);
      const placed = audioTrackFor(next, firstTrack?.kind === 'audio' ? firstTrack.id : null);
      next = placed.doc;
      const clip = createAudioClip(makeTimelineId, meta.id, start, end - start);
      newId = clip.id;
      return addClip(next, placed.trackId, clip);
    }, 'Auswahl zusammengefügt (Bounce)');
    arr.setSelectedClipIds(newId ? [newId] : []);
    studio.showNotice('Auswahl zu einer Audio-Datei zusammengefügt');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arr, pool, studio]);

  const getExportAssets = useCallback(async () => {
    const p = studio.project;
    const ids = new Set<string>(p.arrangement ? referencedAssetIds(p.arrangement) : []);
    for (const l of p.activeSnapshot.layers) if (l.sample) ids.add(l.sample.assetId);
    for (const sec of p.sections) for (const l of sec.snapshot.layers) if (l.sample) ids.add(l.sample.assetId);
    return pool.collect(ids);
  }, [pool, studio.project]);

  /** Audio clip → new sample-instrument layer in the Beatkasten. */
  const instrumentFromClip = useCallback(
    (clip: ArrangementClip) => {
      if (clip.kind !== 'audio') return;
      const entry = pool.get(clip.assetId);
      if (!entry) return;
      const tm = arr.tempoMap;
      const dur = tm.beatToSec(clipEndBeat(clip)) - tm.beatToSec(clip.startBeat);
      const sr = entry.pcm.sampleRate;
      const a = Math.floor(clip.sourceOffsetSec * sr);
      const b = Math.min(entry.pcm.length, a + Math.floor(dur * sr));
      const root = detectRootMidi([entry.pcm.left.subarray(a, b), entry.pcm.right.subarray(a, b)], sr) ?? 60;
      const name = (studio.project.assets ?? []).find((m) => m.id === clip.assetId)?.name ?? 'Sample';
      const layer = {
        ...createDefaultLayer(name, 'sample-player', 4, 'beats'),
        sample: { assetId: clip.assetId, rootMidi: root, startSec: clip.sourceOffsetSec, endSec: clip.sourceOffsetSec + dur },
      };
      studio.commitSnapshotImmediate((snap) => ({ ...snap, layers: [...snap.layers, layer] }), `Sample-Instrument: ${name}`);
      studio.showNotice(`„${name}“ ist jetzt ein Instrument im Beatkasten (neuer Layer)`);
    },
    [arr.tempoMap, pool, studio],
  );

  const used = doc ? referencedAssetIds(doc) : new Set<string>();

  const audioPoolNode = (
    <div className="tl-pool">
      <div className="tl-media-title" style={{ marginTop: 8 }}>
        <AudioWaveform size={13} /> Audio-Pool
      </div>
      <div className="tl-btn-row">
        <button type="button" className="btn-sm" onClick={() => fileInputRef.current?.click()} title="WAV, MP3, OGG, FLAC, M4A vom PC laden (oder Dateien direkt auf die Timeline ziehen)">
          <Upload size={11} /> Datei laden
        </button>
        <button type="button" className="btn-sm btn-ghost" onClick={() => void pool.removeUnused()} title="Aufnahmen und Dateien entfernen, die nirgends benutzt werden">
          <Trash2 size={11} /> Aufräumen
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length) void pool.importFiles(files);
          }}
        />
      </div>
      {metas.length === 0 && <div className="muted-note">Noch keine Aufnahmen. Dateien laden, aufnehmen oder auf eine Audio-Spur ziehen.</div>}
      {metas.map((m) => {
        const entry = pool.get(m.id);
        return (
          <div
            key={m.id}
            className="tl-pool-item"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(ASSET_DRAG_TYPE, m.id);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onDoubleClick={() => {
              const d = arr.doc;
              if (!d) return;
              const t = d.tracks.find((x) => x.id === arr.selectedTrackId && x.kind === 'audio') ?? d.tracks.find((x) => x.kind === 'audio');
              const end = t ? t.clips.reduce((mx, c) => Math.max(mx, clipEndBeat(c)), 0) : arr.startBeat;
              placeAssets([m.id], t?.id ?? null, t ? end : arr.startBeat);
            }}
            title={`${m.name} · ${(m.lengthSamples / m.sampleRate).toFixed(1)} s · ${m.channels === 1 ? 'Mono' : 'Stereo'} — ziehen = platzieren, Doppelklick = anhängen`}
          >
            {entry ? (
              <WaveformCanvas peaks={entry.peaks} startSample={0} spanSamples={Math.max(1, entry.pcm.length)} width={46} height={20} color="#38bdf8" />
            ) : (
              <span className="muted-note">…</span>
            )}
            <span className="tl-media-name" style={{ flex: 1 }}>
              {m.name}
            </span>
            <span className="tl-media-meta">
              {m.source === 'recording' ? '🎙' : m.source === 'freeze' ? '❄' : m.source === 'bounce' ? '⇲' : ''}
              {used.has(m.id) ? ' ●' : ''}
            </span>
          </div>
        );
      })}
    </div>
  );

  const clipActions = (clip: ArrangementClip): ReactNode => {
    if (clip.kind === 'audio') {
      return (
        <>
          <button type="button" className="btn-sm" onClick={() => normalizeClip(clip)} title="Clip-Lautstärke so setzen, dass die lauteste Stelle knapp unter Vollaussteuerung liegt">
            <Wand size={11} /> Normalisieren
          </button>
          <button type="button" className="btn-sm" onClick={() => instrumentFromClip(clip)} title="Diesen Ausschnitt als Sample-Instrument im Beatkasten spielen (neuer Layer)">
            🎹 Als Instrument verwenden
          </button>
        </>
      );
    }
    const frozen = !!clip.frozenAssetId;
    const section = studio.project.sections.find((s) => s.id === clip.sectionId);
    const stale = frozen && section && doc ? freezeKeyForDoc(doc, clip, section.snapshot) !== clip.frozenKey : false;
    return frozen ? (
      <>
        <button type="button" className="btn-sm is-active" onClick={() => unfreezeClip(clip)} title="Wieder live mit der Klang-Engine spielen">
          <Sun size={11} /> Auftauen
        </button>
        {stale && <span className="tl-hint">Abschnitt geändert – spielt live, neu einfrieren?</span>}
      </>
    ) : (
      <button type="button" className="btn-sm" onClick={() => void freezeClip(clip)} title="Clip als Audio vorberechnen: spart CPU, wenn viele Abschnitte gleichzeitig laufen">
        <Snowflake size={11} /> Einfrieren
      </button>
    );
  };

  const selectionActions = (): ReactNode => (
    <button type="button" className="btn-sm" onClick={() => void bounceSelection()} title="Ausgewählte Clips (mit Spur-Effekten) zu einer neuen Audio-Datei zusammenfügen">
      ⇲ Auswahl zusammenfügen (Bounce)
    </button>
  );

  return {
    audioPoolNode,
    renderWaveform,
    onDropAsset,
    onDropFiles,
    clipActions,
    selectionActions,
    freezeTrack,
    getExportAssets,
    placeAssets,
    audioTrackFor,
  };
}
