import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Mic, Play, Scissors, Square, Upload, Wand, X } from 'lucide-react';
import { recorderSingleton } from '../../audio-host/recorder';
import { detectRootMidi, detectTransients, findSilenceBounds } from '../../core/audio/analysis';
import type { LayerConfig, LayerSampleConfig } from '../../core/state/types';
import { NOTE_NAMES } from '../../core/theory/scales';
import type { AudioPool } from '../audio/useAudioPool';
import type { StudioStore } from '../store/useStudioStore';
import { loadLayoutPref } from './Splitter';
import { WaveformCanvas } from './WaveformCanvas';

const WAVE_W = 660;
const WAVE_H = 120;

export function midiLabel(m: number): string {
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

interface SampleSectionProps {
  layer: LayerConfig;
  pool: AudioPool;
  onOpen: () => void;
}

/** Compact summary in Säule 2 of the Beatkasten inspector. */
export function SampleSection({ layer, pool, onOpen }: SampleSectionProps) {
  const cfg = layer.sample;
  const meta = cfg ? pool.metas.find((m) => m.id === cfg.assetId) : undefined;
  const entry = cfg ? pool.get(cfg.assetId) : undefined;
  return (
    <div className="sample-section">
      {cfg && entry ? (
        <WaveformCanvas
          peaks={entry.peaks}
          startSample={cfg.startSec * entry.pcm.sampleRate}
          spanSamples={Math.max(1, (cfg.endSec - cfg.startSec) * entry.pcm.sampleRate)}
          width={220}
          height={34}
          color={layer.color}
        />
      ) : null}
      <div className="muted-note">
        {cfg ? (meta ? `${meta.name} · Grundton ${midiLabel(cfg.rootMidi)}${cfg.slices?.length ? ` · ${cfg.slices.length} Slices` : ''}` : '⚠ Sound fehlt im Audio-Pool – stumm') : 'Noch kein Sound gewählt'}
      </div>
      <button type="button" className="btn-sm btn-primary" onClick={onOpen}>
        Sound wählen / bearbeiten …
      </button>
    </div>
  );
}

interface SampleEditorProps {
  layer: LayerConfig;
  pool: AudioPool;
  studio: StudioStore;
  onApply: (cfg: LayerSampleConfig) => void;
  onClose: () => void;
}

type Marker = 'start' | 'end' | 'loopStart' | 'loopEnd' | { slice: number };

export function SampleEditor({ layer, pool, studio, onApply, onClose }: SampleEditorProps) {
  const init = layer.sample;
  const [assetId, setAssetId] = useState<string>(init?.assetId ?? pool.metas[0]?.id ?? '');
  const entry = assetId ? pool.get(assetId) : undefined;
  const durSec = entry ? entry.pcm.length / entry.pcm.sampleRate : 0;
  const [rootMidi, setRootMidi] = useState<number>(init?.rootMidi ?? 60);
  const [startSec, setStartSec] = useState<number>(init?.startSec ?? 0);
  const [endSec, setEndSec] = useState<number>(init?.endSec ?? 0);
  const [loopOn, setLoopOn] = useState<boolean>(!!init?.loop);
  const [loopStart, setLoopStart] = useState<number>(init?.loop?.startSec ?? 0);
  const [loopEnd, setLoopEnd] = useState<number>(init?.loop?.endSec ?? 0);
  const [slices, setSlices] = useState<number[]>(init?.slices ? [...init.slices] : []);
  const [sliceMode, setSliceMode] = useState(false);
  const [recording, setRecording] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const waveRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Marker | null>(null);
  const previewRef = useRef<AudioBufferSourceNode | null>(null);

  // New asset chosen: whole sound as region, detect root note.
  const lastAsset = useRef(init?.assetId ?? '');
  useEffect(() => {
    if (!entry || assetId === lastAsset.current) {
      if (entry && endSec <= 0) setEndSec(durSec);
      return;
    }
    lastAsset.current = assetId;
    setStartSec(0);
    setEndSec(durSec);
    setLoopStart(0);
    setLoopEnd(durSec);
    setSlices([]);
    const meta = pool.metas.find((m) => m.id === assetId);
    const root = meta?.rootMidi ?? detectRootMidi([entry.pcm.left, entry.pcm.right], entry.pcm.sampleRate);
    if (root !== null && root !== undefined) setRootMidi(root);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, entry]);

  const secToX = (s: number) => (durSec > 0 ? (s / durSec) * WAVE_W : 0);
  const xToSec = (x: number) => Math.max(0, Math.min(durSec, (x / WAVE_W) * durSec));

  const markers = useMemo(() => {
    if (!entry) return [];
    const sr = entry.pcm.sampleRate;
    const m = [
      { sample: startSec * sr, color: '#22c55e' },
      { sample: endSec * sr, color: '#ef4444' },
      ...slices.map((s) => ({ sample: s * sr, color: '#f59e0b' })),
    ];
    if (loopOn) m.push({ sample: loopStart * sr, color: '#38bdf8' }, { sample: loopEnd * sr, color: '#38bdf8' });
    return m;
  }, [entry, startSec, endSec, slices, loopOn, loopStart, loopEnd]);

  const nearestMarker = (x: number): Marker | null => {
    const cands: Array<{ m: Marker; x: number }> = [
      { m: 'start', x: secToX(startSec) },
      { m: 'end', x: secToX(endSec) },
      ...slices.map((s, i) => ({ m: { slice: i } as Marker, x: secToX(s) })),
    ];
    if (loopOn) cands.push({ m: 'loopStart', x: secToX(loopStart) }, { m: 'loopEnd', x: secToX(loopEnd) });
    let best: Marker | null = null;
    let bd = 8;
    for (const c of cands) {
      const d = Math.abs(c.x - x);
      if (d < bd) {
        bd = d;
        best = c.m;
      }
    }
    return best;
  };

  const setMarker = (m: Marker, sec: number) => {
    if (m === 'start') setStartSec(Math.min(sec, endSec - 0.005));
    else if (m === 'end') setEndSec(Math.max(sec, startSec + 0.005));
    else if (m === 'loopStart') setLoopStart(Math.min(sec, loopEnd - 0.005));
    else if (m === 'loopEnd') setLoopEnd(Math.max(sec, loopStart + 0.005));
    else setSlices((list) => list.map((s, i) => (i === m.slice ? sec : s)).sort((a, b) => a - b));
  };

  const stopPreview = () => {
    try {
      previewRef.current?.stop();
    } catch {
      // already stopped
    }
    previewRef.current = null;
  };

  const preview = async (fromSec = startSec, toSec = endSec) => {
    if (!entry) return;
    stopPreview();
    const ctx = await studio.audioBridge.getContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const sr = entry.pcm.sampleRate;
    const a = Math.floor(fromSec * sr);
    const b = Math.max(a + 1, Math.floor(toSec * sr));
    const buf = ctx.createBuffer(2, b - a, sr);
    buf.copyToChannel(entry.pcm.left.slice(a, b), 0);
    buf.copyToChannel(entry.pcm.right.slice(a, b), 1);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
    previewRef.current = src;
  };

  useEffect(() => () => stopPreview(), []);

  const toggleRecord = async () => {
    try {
      if (!recording) {
        const ctx = await studio.audioBridge.getContext();
        if (ctx.state === 'suspended') await ctx.resume();
        const rs = loadLayoutPref<{ deviceId?: string; stereo?: boolean }>('record', {});
        await recorderSingleton.open(ctx, rs.deviceId ?? '', rs.stereo ?? false);
        recorderSingleton.start();
        setRecording(true);
        return;
      }
      setRecording(false);
      const take = await recorderSingleton.stop();
      if (take.left.length < take.sampleRate * 0.05) {
        studio.showNotice('Aufnahme zu kurz');
        return;
      }
      // Silence at start and end is removed automatically.
      const b = findSilenceBounds(take.right === take.left ? [take.left] : [take.left, take.right]);
      const left = take.left.slice(b.start, b.end);
      const right = take.right === take.left ? left : take.right.slice(b.start, b.end);
      const root = detectRootMidi([left, right], take.sampleRate);
      const meta = await pool.addAsset({ left, right, sampleRate: take.sampleRate, length: left.length }, `Sample ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`, 'recording', root !== null ? { rootMidi: root } : {});
      setAssetId(meta.id);
    } catch (err) {
      setRecording(false);
      studio.showNotice(err instanceof Error ? `Aufnahme nicht möglich: ${err.message}` : 'Aufnahme nicht möglich');
    }
  };

  const apply = () => {
    if (!assetId || !entry) return;
    onApply({
      assetId,
      rootMidi,
      startSec,
      endSec: endSec > startSec ? endSec : durSec,
      ...(loopOn ? { loop: { startSec: loopStart, endSec: loopEnd, crossfadeSec: 0.01 } } : {}),
      ...(slices.length > 0 ? { slices } : {}),
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card sample-editor" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Sample-Instrument · {layer.name}</span>
          <button type="button" className="btn-ghost" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="modal-body sample-editor-body">
          <div className="sample-editor-pool">
            <div className="tl-btn-row">
              <button type="button" className="btn-sm" onClick={() => fileRef.current?.click()}>
                <Upload size={11} /> Datei laden
              </button>
              <button type="button" className={`btn-sm${recording ? ' is-active' : ''}`} onClick={() => void toggleRecord()} title="Kurz aufnehmen (Stille wird abgeschnitten)">
                {recording ? <Square size={11} /> : <Mic size={11} />} {recording ? 'Stopp' : 'Neu aufnehmen'}
              </button>
              {recording && <span className="tl-rec-badge">REC</span>}
              <input
                ref={fileRef}
                type="file"
                accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = '';
                  const added = await pool.importFiles(files);
                  if (added[0]) setAssetId(added[0].id);
                }}
              />
            </div>
            <div className="sample-editor-list">
              {pool.metas.length === 0 && <div className="muted-note">Der Audio-Pool ist leer.</div>}
              {pool.metas.map((m) => (
                <button key={m.id} type="button" className={`tl-pool-item${m.id === assetId ? ' is-active' : ''}`} onClick={() => setAssetId(m.id)}>
                  {m.source === 'recording' ? <Circle size={9} /> : null} {m.name}
                  <span className="tl-media-meta" style={{ marginLeft: 'auto' }}>
                    {(m.lengthSamples / m.sampleRate).toFixed(1)} s
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="sample-editor-main">
            {entry ? (
              <>
                <div
                  ref={waveRef}
                  className="sample-wave"
                  style={{ width: WAVE_W, height: WAVE_H }}
                  onPointerDown={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const m = nearestMarker(x);
                    if (m) {
                      dragRef.current = m;
                      e.currentTarget.setPointerCapture(e.pointerId);
                    } else if (sliceMode) {
                      setSlices((l) => [...l, xToSec(x)].sort((a, b) => a - b));
                    } else {
                      void preview(xToSec(x), endSec);
                    }
                  }}
                  onPointerMove={(e) => {
                    const m = dragRef.current;
                    if (!m) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    setMarker(m, xToSec(e.clientX - rect.left));
                  }}
                  onPointerUp={() => (dragRef.current = null)}
                  onDoubleClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const m = nearestMarker(e.clientX - rect.left);
                    if (m && typeof m === 'object') setSlices((l) => l.filter((_, i) => i !== m.slice));
                  }}
                  title="Marker ziehen: grün = Start, rot = Ende, blau = Loop, gelb = Slices · Klick = ab hier vorhören · Slice-Modus: Klick setzt Slice, Doppelklick löscht"
                >
                  <WaveformCanvas peaks={entry.peaks} startSample={0} spanSamples={entry.pcm.length} width={WAVE_W} height={WAVE_H} color={layer.color} markers={markers} />
                  <div className="sample-wave-dim" style={{ left: 0, width: secToX(startSec) }} />
                  <div className="sample-wave-dim" style={{ left: secToX(endSec), width: Math.max(0, WAVE_W - secToX(endSec)) }} />
                </div>
                <div className="muted-note">
                  Bereich {startSec.toFixed(3)} – {endSec.toFixed(3)} s von {durSec.toFixed(2)} s
                </div>
                <div className="tl-btn-row">
                  <button type="button" className="btn-sm" onClick={() => void preview()}>
                    <Play size={11} /> Vorhören
                  </button>
                  <button type="button" className="btn-sm" onClick={stopPreview}>
                    <Square size={11} />
                  </button>
                  <button
                    type="button"
                    className="btn-sm"
                    onClick={() => {
                      const sr = entry.pcm.sampleRate;
                      const a = Math.floor(startSec * sr);
                      const b = Math.floor(endSec * sr);
                      const bounds = findSilenceBounds([entry.pcm.left.subarray(a, b), entry.pcm.right.subarray(a, b)]);
                      setStartSec((a + bounds.start) / sr);
                      setEndSec((a + bounds.end) / sr);
                    }}
                    title="Stille am Anfang und Ende entfernen"
                  >
                    <Scissors size={11} /> Stille abschneiden
                  </button>
                  <button
                    type="button"
                    className="btn-sm"
                    onClick={() => {
                      const sr = entry.pcm.sampleRate;
                      const a = Math.floor(startSec * sr);
                      const b = Math.floor(endSec * sr);
                      const hits = detectTransients([entry.pcm.left.subarray(a, b), entry.pcm.right.subarray(a, b)], sr);
                      setSlices(hits.map((h) => (a + h) / sr));
                      studio.showNotice(`${hits.length} Slices an den Anschlägen gesetzt`);
                    }}
                    title="Slice-Marker an allen Anschlägen (Transienten) setzen"
                  >
                    <Wand size={11} /> Slices automatisch
                  </button>
                  <label className="inline-check">
                    <input type="checkbox" checked={sliceMode} onChange={(e) => setSliceMode(e.target.checked)} />
                    Slices von Hand
                  </label>
                  {slices.length > 0 && (
                    <button type="button" className="btn-sm btn-ghost" onClick={() => setSlices([])}>
                      Slices löschen ({slices.length})
                    </button>
                  )}
                </div>
                <div className="tl-btn-row">
                  <label className="tl-field">
                    <span>Grundton</span>
                    <select value={((rootMidi % 12) + 12) % 12} onChange={(e) => setRootMidi(Math.floor(rootMidi / 12) * 12 + Number(e.target.value))}>
                      {NOTE_NAMES.map((n, i) => (
                        <option key={n} value={i}>
                          {n}
                        </option>
                      ))}
                    </select>
                    <select value={Math.floor(rootMidi / 12) - 1} onChange={(e) => setRootMidi((Number(e.target.value) + 1) * 12 + (((rootMidi % 12) + 12) % 12))}>
                      {[0, 1, 2, 3, 4, 5, 6, 7].map((o) => (
                        <option key={o} value={o}>
                          Oktave {o}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn-sm"
                    onClick={() => {
                      const sr = entry.pcm.sampleRate;
                      const a = Math.floor(startSec * sr);
                      const b = Math.floor(endSec * sr);
                      const r = detectRootMidi([entry.pcm.left.subarray(a, b), entry.pcm.right.subarray(a, b)], sr);
                      if (r === null) studio.showNotice('Keine klare Tonhöhe erkannt – Grundton von Hand wählen');
                      else setRootMidi(r);
                    }}
                    title="Tonhöhe automatisch erkennen"
                  >
                    Erkennen ({midiLabel(rootMidi)})
                  </button>
                  <label className="inline-check" title="Schleife für lange Töne (Spielweise: Schleife an)">
                    <input
                      type="checkbox"
                      checked={loopOn}
                      onChange={(e) => {
                        setLoopOn(e.target.checked);
                        if (e.target.checked && loopEnd <= loopStart) {
                          setLoopStart(startSec + (endSec - startSec) * 0.3);
                          setLoopEnd(endSec);
                        }
                      }}
                    />
                    Loop-Bereich
                  </label>
                </div>
              </>
            ) : (
              <div className="muted-note" style={{ padding: 20 }}>
                Links einen Sound wählen, eine Datei laden oder neu aufnehmen.
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn-primary" disabled={!entry} onClick={apply}>
            Übernehmen
          </button>
        </div>
      </div>
    </div>
  );
}
