import { useEffect, useRef, useState } from 'react';
import { Circle, Headphones, Timer as MetronomeIcon, Settings2, Square } from 'lucide-react';
import { recorderSingleton, type InputDevice } from '../../audio-host/recorder';
import { addClip, createAudioClip, secondsToBeatsAt } from '../../core/arrangement/edit';
import { loadLayoutPref, saveLayoutPref } from '../components/Splitter';
import type { AudioPool } from '../audio/useAudioPool';
import type { StudioStore } from '../store/useStudioStore';
import { makeTimelineId, type ArrangementStore } from './useArrangementStore';

interface RecordSettings {
  deviceId: string;
  stereo: boolean;
  countInBars: number;
  clickWhileRecording: boolean;
  monitor: boolean;
  /** Extra manual offset (ms), added to the automatic / calibrated latency. */
  offsetMs: number;
  /** Measured round trip (s) or null = automatic estimate. */
  calibratedSec: number | null;
}

const DEFAULTS: RecordSettings = {
  deviceId: '',
  stereo: false,
  countInBars: 1,
  clickWhileRecording: true,
  monitor: false,
  offsetMs: 0,
  calibratedSec: null,
};

interface RecordControlsProps {
  studio: StudioStore;
  arr: ArrangementStore;
  pool: AudioPool;
}

interface Session {
  recStartBeat: number;
  playFrom: number;
  playFrame: number | null;
  playBeat: number;
  loop: { startBeat: number; endBeat: number } | null;
  trackId: string;
}

export function RecordControls({ studio, arr, pool }: RecordControlsProps) {
  const bridge = studio.audioBridge;
  const [settings, setSettings] = useState<RecordSettings>(() => ({ ...DEFAULTS, ...loadLayoutPref('record', DEFAULTS) }));
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [metronome, setMetronome] = useState(false);
  const levelRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const update = (patch: Partial<RecordSettings>) =>
    setSettings((s) => {
      const n = { ...s, ...patch };
      saveLayoutPref('record', n);
      return n;
    });

  useEffect(() => recorderSingleton.onLevel((p) => {
    if (levelRef.current) levelRef.current.style.width = `${Math.min(100, p * 100)}%`;
  }), []);

  useEffect(
    () =>
      bridge.onPlayStarted((frame, songBeat) => {
        const s = sessionRef.current;
        if (s && s.playFrame === null) {
          s.playFrame = frame;
          s.playBeat = songBeat;
        }
      }),
    [bridge],
  );

  // Playback stopped elsewhere (space bar) → finish the recording.
  useEffect(() => {
    if (recording && !arr.isPlaying && !busy) void finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arr.isPlaying]);

  const openInput = async () => {
    const ctx = await bridge.getContext();
    await recorderSingleton.open(ctx, settingsRef.current.deviceId, settingsRef.current.stereo);
    recorderSingleton.setMonitoring(settingsRef.current.monitor);
    setDevices(await recorderSingleton.listDevices());
  };

  const latencySec = () =>
    (settingsRef.current.calibratedSec ?? recorderSingleton.estimatedLatency()) + settingsRef.current.offsetMs / 1000;

  const start = async () => {
    const doc = arr.doc;
    if (!doc) return;
    const armed = doc.tracks.find((t) => t.kind === 'audio' && t.armed);
    if (!armed) {
      studio.showNotice('Erst eine Audio-Spur scharf schalten (● im Spurkopf)');
      return;
    }
    try {
      setBusy(true);
      await openInput();
      const tm = arr.tempoMap;
      const loop = doc.loop && doc.loop.enabled && doc.loop.endBeat > doc.loop.startBeat ? doc.loop : null;
      const recStartBeat = loop ? loop.startBeat : arr.startBeat;
      const countIn = settingsRef.current.countInBars * tm.beatsPerBarAt(recStartBeat);
      const playFrom = Math.max(0, recStartBeat - countIn);
      sessionRef.current = {
        recStartBeat,
        playFrom,
        playFrame: null,
        playBeat: playFrom,
        loop: loop ? { startBeat: loop.startBeat, endBeat: loop.endBeat } : null,
        trackId: armed.id,
      };
      bridge.setMetronome(settingsRef.current.clickWhileRecording || metronome ? Infinity : recStartBeat);
      recorderSingleton.start();
      await arr.play(playFrom);
      setRecording(true);
    } catch (err) {
      sessionRef.current = null;
      studio.showNotice(err instanceof Error ? `Aufnahme nicht möglich: ${err.message}` : 'Aufnahme nicht möglich');
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    const s = sessionRef.current;
    sessionRef.current = null;
    setRecording(false);
    if (!s) return;
    setBusy(true);
    try {
      const take = await recorderSingleton.stop();
      if (arr.isPlaying) await arr.stop();
      bridge.setMetronome(metronome ? Infinity : -1);
      if (s.playFrame === null || take.left.length === 0) {
        studio.showNotice('Keine Aufnahme-Daten erhalten');
        return;
      }
      const tm = arr.tempoMap;
      const sr = take.sampleRate;
      // Recorded sample i was played at song time beatToSec(playBeat) + (startFrame + i - playFrame)/sr − latency.
      const i0 = Math.round(
        (tm.beatToSec(s.recStartBeat) - tm.beatToSec(s.playBeat)) * sr + (s.playFrame - take.startFrame) + latencySec() * sr,
      );
      const from = Math.max(0, i0);
      const left = take.left.slice(from);
      const right = take.right === take.left ? left : take.right.slice(from);
      if (left.length < sr * 0.05) {
        studio.showNotice('Aufnahme zu kurz');
        return;
      }
      const name = `Aufnahme ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
      const meta = await pool.addAsset({ left, right, sampleRate: sr, length: left.length }, name, 'recording');
      const totalSec = left.length / sr;
      arr.commit((d) => {
        let next = d;
        if (s.loop) {
          // Loop recording: one take per pass, all at the loop start; only the last one is audible.
          const loopSec = tm.beatToSec(s.loop.endBeat) - tm.beatToSec(s.loop.startBeat);
          const loopBeats = s.loop.endBeat - s.loop.startBeat;
          const takes = Math.max(1, Math.floor(totalSec / loopSec + 0.75));
          for (let k = 0; k < takes; k++) {
            const remain = totalSec - k * loopSec;
            const len = remain >= loopSec ? loopBeats : secondsToBeatsAt(tm, s.loop.startBeat, remain);
            if (len <= 0) continue;
            const clip = { ...createAudioClip(makeTimelineId, meta.id, s.loop.startBeat, len, k * loopSec), muted: k < takes - 1 };
            next = addClip(next, s.trackId, clip);
          }
        } else {
          next = addClip(next, s.trackId, createAudioClip(makeTimelineId, meta.id, s.recStartBeat, secondsToBeatsAt(tm, s.recStartBeat, totalSec)));
        }
        return next;
      }, 'Aufnahme');
      studio.showNotice(s.loop ? 'Aufnahme fertig – ältere Takes liegen stumm darunter (Clip → „Stumm“ umschalten)' : 'Aufnahme fertig');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tl-rec">
      <button
        type="button"
        className={`btn-sm tl-rec-btn${recording ? ' is-recording' : ''}`}
        disabled={busy}
        onClick={() => void (recording ? finish() : start())}
        title={recording ? 'Aufnahme beenden' : 'Aufnahme auf der scharf geschalteten Audio-Spur (mit Vorzähler)'}
      >
        {recording ? <Square size={11} /> : <Circle size={11} fill="currentColor" />}
        {recording ? <span className="tl-rec-badge">REC</span> : 'Aufnahme'}
      </button>
      <button
        type="button"
        className={`btn-sm${metronome ? ' is-active' : ''}`}
        onClick={() => {
          const on = !metronome;
          setMetronome(on);
          bridge.setMetronome(on ? Infinity : -1);
        }}
        title="Metronom beim Abspielen"
      >
        <MetronomeIcon size={12} />
      </button>
      <button
        type="button"
        className={`btn-sm${settings.monitor ? ' is-active' : ''}`}
        onClick={() => {
          const on = !settings.monitor;
          if (on && !window.confirm('Mithören: Bitte Kopfhörer benutzen (sonst Rückkopplung). Das Mithören hat etwas Verzögerung. Einschalten?')) return;
          update({ monitor: on });
          recorderSingleton.setMonitoring(on);
        }}
        title="Eingang mithören (Kopfhörer!)"
      >
        <Headphones size={12} />
      </button>
      <div className="tl-input-meter" title="Eingangspegel">
        <div ref={levelRef} className="tl-meter-fill" />
      </div>
      <button type="button" className={`btn-sm btn-ghost${open ? ' is-active' : ''}`} onClick={() => { setOpen((o) => !o); void openInput().catch(() => undefined); }} title="Aufnahme-Einstellungen">
        <Settings2 size={12} />
      </button>
      {open && (
        <div className="tl-palette tl-rec-settings">
          <label className="tl-field">
            <span>Eingang</span>
            <select value={settings.deviceId} onChange={(e) => { update({ deviceId: e.target.value }); void openInput().catch(() => undefined); }}>
              <option value="">Standard-Eingang</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="tl-field">
            <span>Kanäle</span>
            <select value={settings.stereo ? 'stereo' : 'mono'} onChange={(e) => update({ stereo: e.target.value === 'stereo' })}>
              <option value="mono">Mono (Gesang, Instrument)</option>
              <option value="stereo">Stereo</option>
            </select>
          </label>
          <label className="tl-field">
            <span>Vorzähler</span>
            <select value={settings.countInBars} onChange={(e) => update({ countInBars: Number(e.target.value) })}>
              <option value={0}>aus</option>
              <option value={1}>1 Takt</option>
              <option value={2}>2 Takte</option>
            </select>
          </label>
          <label className="inline-check">
            <input type="checkbox" checked={settings.clickWhileRecording} onChange={(e) => update({ clickWhileRecording: e.target.checked })} />
            Metronom auch während der Aufnahme
          </label>
          <div className="muted-note">
            Latenz-Ausgleich: {settings.calibratedSec !== null ? `gemessen ${(settings.calibratedSec * 1000).toFixed(1)} ms` : `automatisch ≈ ${(recorderSingleton.estimatedLatency() * 1000).toFixed(1)} ms`}
            {settings.offsetMs !== 0 && ` ${settings.offsetMs > 0 ? '+' : ''}${settings.offsetMs} ms`}
          </div>
          <label className="tl-field">
            <span>Feinversatz</span>
            <input type="number" step={1} min={-200} max={200} value={settings.offsetMs} style={{ width: 64 }} onChange={(e) => update({ offsetMs: Number(e.target.value) || 0 })} />
            <span className="muted-note">ms (+ = Aufnahme früher)</span>
          </label>
          <div className="tl-btn-row">
            <button
              type="button"
              className="btn-sm"
              onClick={async () => {
                try {
                  await openInput();
                  const r = await recorderSingleton.calibrate();
                  if (r === null) studio.showNotice('Klick nicht erkannt – Lautsprecher lauter stellen und Mikrofon davor halten');
                  else {
                    update({ calibratedSec: r });
                    studio.showNotice(`Latenz gemessen: ${(r * 1000).toFixed(1)} ms`);
                  }
                } catch (err) {
                  studio.showNotice(err instanceof Error ? err.message : 'Kalibrierung fehlgeschlagen');
                }
              }}
              title="Spielt einen Klick über die Lautsprecher und misst, wann er im Mikrofon ankommt"
            >
              Latenz messen
            </button>
            {settings.calibratedSec !== null && (
              <button type="button" className="btn-sm btn-ghost" onClick={() => update({ calibratedSec: null })}>
                Automatisch
              </button>
            )}
          </div>
          <div className="muted-note">Tipp: Kopfhörer benutzen, damit die Musik nicht mit aufgenommen wird.</div>
        </div>
      )}
    </div>
  );
}
