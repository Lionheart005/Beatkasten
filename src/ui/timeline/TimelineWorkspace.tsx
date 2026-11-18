import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Flag,
  Gauge,
  Magnet,
  MousePointer2,
  Play,
  Plus,
  Redo2,
  Repeat,
  Scissors,
  SkipBack,
  Square,
  Undo2,
  ZoomIn,
  ZoomOut,
  ListPlus,
  Crosshair,
  AlertTriangle,
} from 'lucide-react';
import {
  addClip,
  addSongMarker,
  addTrack,
  createSectionClip,
  createTrack,
  duplicateClips,
  ensureAutomationLane,
  findClip,
  moveClips,
  pasteClips,
  referencedSectionIds,
  removeClips,
  removeLane,
  removeMeterMarker,
  removeSongMarker,
  removeTempoMarker,
  removeTrack,
  setMeterMarker,
  setTempoMarker,
  songEndBeat,
  splitClip,
  trimClipEnd,
  trimClipStart,
  updateClip,
  updateLane,
  updateSongMarker,
  updateTrack,
} from '../../core/arrangement/edit';
import { gridStepAt, snapToCandidates, SNAP_GRID_LABELS } from '../../core/arrangement/snap';
import { clipEndBeat, type ArrangementClip, type ArrangementDoc, type AutomationTarget, type SectionClip, type SnapGrid } from '../../core/arrangement/types';
import { arrangementFromSongChain } from '../../core/state/arrangementMigration';
import type { SectionItem } from '../../core/state/types';
import { loadLayoutPref, saveLayoutPref, Splitter } from '../components/Splitter';
import type { StudioStore } from '../store/useStudioStore';
import { AutomationLaneView } from './AutomationLaneView';
import { automationMeta } from './automationMeta';
import { ClipView, type ClipZone } from './ClipView';
import {
  computeRows,
  DEFAULT_PX_PER_BEAT,
  HEADER_WIDTH,
  MAX_PX_PER_BEAT,
  MIN_PX_PER_BEAT,
  RULER_HEIGHT,
  rowsHeight,
  trackAtY,
  type TimelineRow,
} from './geometry';
import { MediaBrowser, ASSET_DRAG_TYPE, SECTION_DRAG_TYPE, sectionLengthBeats } from './MediaBrowser';
import { TimelineInspector } from './TimelineInspector';
import { drawLaneGrid, TimelineRuler } from './TimelineRuler';
import { TrackHeader } from './TrackHeader';
import { makeTimelineId, type ArrangementStore } from './useArrangementStore';

interface TimelineWorkspaceProps {
  studio: StudioStore;
  arr: ArrangementStore;
  onOpenInBeatkasten: (sectionId: string) => void;
  /** Phase D/E: audio pool + record controls (rendered in the media browser / toolbar). */
  audioPool?: ReactNode;
  recordControls?: ReactNode;
  /** Renders audio clip waveforms. */
  renderWaveform?: (clip: ArrangementClip, width: number, height: number) => ReactNode;
  onDropAsset?: (assetId: string, trackId: string | null, beat: number) => void;
  onDropFiles?: (files: File[], trackId: string | null, beat: number) => void;
  onClipContextMenu?: (clip: ArrangementClip) => void;
  /** Transition templates palette (Phase C). */
  transitionPalette?: ReactNode;
  clipActions?: (clip: ArrangementClip) => ReactNode;
  selectionActions?: () => ReactNode;
  onFreezeTrack?: (trackId: string) => void;
}

type DragState =
  | {
      kind: 'clip';
      zone: ClipZone;
      clipId: string;
      ids: string[];
      startX: number;
      startY: number;
      origStart: number;
      origEnd: number;
      origTrackId: string;
      moved: boolean;
    }
  | { kind: 'marquee'; x0: number; y0: number; additive: boolean; base: readonly string[]; moved: boolean }
  | { kind: 'ruler'; loop: boolean; anchor: number };

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export function TimelineWorkspace({
  studio,
  arr,
  onOpenInBeatkasten,
  audioPool,
  recordControls,
  renderWaveform,
  onDropAsset,
  onDropFiles,
  onClipContextMenu,
  transitionPalette,
  clipActions,
  selectionActions,
  onFreezeTrack,
}: TimelineWorkspaceProps) {
  const doc = arr.doc;
  const tm = arr.tempoMap;
  const sections = studio.project.sections;
  const sectionById = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);

  const [pxPerBeat, setPxPerBeat] = useState<number>(() => {
    const v = loadLayoutPref('timeline-zoom', { px: DEFAULT_PX_PER_BEAT }).px;
    return Number.isFinite(v) ? Math.min(MAX_PX_PER_BEAT, Math.max(MIN_PX_PER_BEAT, v)) : DEFAULT_PX_PER_BEAT;
  });
  const [layout, setLayout] = useState(() => {
    const v = loadLayoutPref('timeline-layout', { media: 220, inspector: 230 });
    return { media: Number.isFinite(v.media) ? v.media : 220, inspector: Number.isFinite(v.inspector) ? v.inspector : 230 };
  });
  const layoutStart = useRef(layout);
  const [scroll, setScroll] = useState({ left: 0, top: 0, width: 800, height: 400 });
  const [openAutomation, setOpenAutomation] = useState<ReadonlySet<string>>(new Set());
  const [masterOpen, setMasterOpen] = useState(false);
  const [follow, setFollow] = useState(true);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLCanvasElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const rulerHeadRef = useRef<HTMLDivElement | null>(null);
  const posLabelRef = useRef<HTMLSpanElement | null>(null);
  const meterEls = useRef<Map<string, HTMLDivElement>>(new Map());
  const masterMeterRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const playheadBeatRef = useRef(0);
  const [limitHit, setLimitHit] = useState(false);

  useEffect(() => saveLayoutPref('timeline-zoom', { px: pxPerBeat }), [pxPerBeat]);

  const rows: TimelineRow[] = useMemo(
    () => (doc ? computeRows(doc, openAutomation, masterOpen) : []),
    [doc, openAutomation, masterOpen],
  );
  const contentHeight = rowsHeight(rows) + 140;
  const endBeat = doc ? songEndBeat(doc) : 0;
  const totalBeats = Math.max(endBeat + 64, (scroll.width / pxPerBeat) * 1.2, 128);
  const totalWidth = totalBeats * pxPerBeat;

  const usedSectionIds = useMemo(() => (doc ? referencedSectionIds(doc) : new Set<string>()), [doc]);

  // --- scroll / resize ------------------------------------------------------
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () =>
      setScroll({ left: el.scrollLeft, top: el.scrollTop, width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Ctrl + wheel = zoom around the pointer.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setPxPerBeat((px) => {
        const beat = (el.scrollLeft + x) / px;
        const next = Math.min(MAX_PX_PER_BEAT, Math.max(MIN_PX_PER_BEAT, px * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        requestAnimationFrame(() => {
          el.scrollLeft = beat * next - x;
        });
        return next;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // --- grid canvas ------------------------------------------------------------
  useEffect(() => {
    const cv = gridRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, scroll.width);
    const h = Math.max(1, scroll.height);
    cv.width = w * dpr;
    cv.height = h * dpr;
    cv.style.width = `${w}px`;
    cv.style.height = `${h}px`;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawLaneGrid(ctx, tm, { scrollLeft: scroll.left, width: w, pxPerBeat }, h);
  }, [tm, scroll, pxPerBeat]);

  // --- telemetry: playhead, meters --------------------------------------------
  useEffect(() => {
    const place = (beat: number) => {
      const x = beat * pxPerBeat;
      if (playheadRef.current) playheadRef.current.style.transform = `translateX(${x}px)`;
      if (rulerHeadRef.current) rulerHeadRef.current.style.transform = `translateX(${x - (scrollRef.current?.scrollLeft ?? 0)}px)`;
      if (posLabelRef.current) posLabelRef.current.textContent = `${tm.formatPosition(beat)} · ${formatTime(tm.beatToSec(beat))}`;
    };
    place(arr.isPlaying ? playheadBeatRef.current : arr.startBeat);
    return studio.subscribeTelemetry((t) => {
      if (t.mode !== 'arrangement' || !t.isPlaying) {
        meterEls.current.forEach((el) => (el.style.width = '0%'));
        if (masterMeterRef.current) masterMeterRef.current.style.width = '0%';
        return;
      }
      playheadBeatRef.current = t.songBeat;
      place(t.songBeat);
      doc?.tracks.forEach((track, i) => {
        const el = meterEls.current.get(track.id);
        if (el) el.style.width = `${Math.min(100, (t.trackPeaks[i] ?? 0) * 100)}%`;
      });
      if (masterMeterRef.current) masterMeterRef.current.style.width = `${Math.min(100, t.peakLevel * 100)}%`;
      if (t.playerLimitHit) setLimitHit(true);
      const el = scrollRef.current;
      if (follow && el) {
        const x = t.songBeat * pxPerBeat;
        if (x > el.scrollLeft + el.clientWidth * 0.92 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - el.clientWidth * 0.1);
      }
    });
  }, [studio, tm, pxPerBeat, arr.isPlaying, arr.startBeat, doc, follow]);

  useEffect(() => {
    if (!limitHit) return;
    const id = window.setTimeout(() => setLimitHit(false), 4000);
    return () => window.clearTimeout(id);
  }, [limitHit]);

  // --- snapping -----------------------------------------------------------------
  const snapCandidates = useCallback(
    (excludeIds: readonly string[]): number[] => {
      if (!doc) return [];
      const ex = new Set(excludeIds);
      const out: number[] = [arr.startBeat];
      for (const t of doc.tracks)
        for (const c of t.clips) {
          if (ex.has(c.id)) continue;
          out.push(c.startBeat, clipEndBeat(c));
        }
      for (const m of doc.songMarkers) out.push(m.beat);
      return out;
    },
    [doc, arr.startBeat],
  );

  const snap = useCallback(
    (beat: number, altKey: boolean, excludeIds: readonly string[] = []): number => {
      if (!doc || altKey || !doc.snap.enabled) return Math.max(0, beat);
      return Math.max(0, snapToCandidates(beat, snapCandidates(excludeIds), 7 / pxPerBeat, doc.snap.grid, tm));
    },
    [doc, snapCandidates, pxPerBeat, tm],
  );

  // --- helpers --------------------------------------------------------------------
  const contentPoint = (clientX: number, clientY: number) => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    return { x: clientX - rect.left + el.scrollLeft, y: clientY - rect.top + el.scrollTop };
  };

  const clipTrackOf = (clipId: string) => doc?.tracks.find((t) => t.clips.some((c) => c.id === clipId));

  const addLane = useCallback(
    (target: AutomationTarget, label: string, value: number) => {
      if (!doc) return;
      arr.commit((d) => ensureAutomationLane(d, target, value, makeTimelineId).doc, `Automation: ${label}`);
      if (target.scope === 'master' || target.scope === 'master-fx') setMasterOpen(true);
      else {
        const tid =
          target.scope === 'clip-layer' || target.scope === 'clip-layer-param'
            ? doc.tracks.find((t) => t.clips.some((c) => c.id === target.clipId))?.id
            : target.trackId;
        if (tid) setOpenAutomation((s) => new Set([...s, tid]));
      }
    },
    [arr, doc],
  );

  /** Places a section at a beat; offers to adopt its tempo as song tempo. */
  const placeSection = useCallback(
    (section: SectionItem, trackId: string | null, beatRaw: number) => {
      if (!doc) return;
      const beat = snap(beatRaw, false);
      const songBpm = tm.bpmAt(beat);
      const secBpm = section.snapshot.tempoBpm;
      let adoptTempo = false;
      if (Math.abs(secBpm - songBpm) > 0.5) {
        adoptTempo = window.confirm(
          `Abschnitt „${section.name}“ hat ${Math.round(secBpm)} BPM, der Song läuft hier mit ${Math.round(songBpm)} BPM.\n\nAb hier das Song-Tempo auf ${Math.round(secBpm)} BPM setzen?\n(Abbrechen = Abschnitt spielt im Song-Tempo)`,
        );
      }
      arr.commit((d) => {
        let next = d;
        let tid = trackId && next.tracks.find((t) => t.id === trackId && t.kind === 'section') ? trackId : null;
        if (!tid) {
          const t = createTrack('section', makeTimelineId, next.tracks.length);
          next = addTrack(next, t);
          tid = t.id;
        }
        if (adoptTempo) next = setTempoMarker(next, beat, secBpm, makeTimelineId);
        const clip = createSectionClip(makeTimelineId, section.id, beat, sectionLengthBeats(section));
        next = addClip(next, tid, clip);
        return next;
      }, `Abschnitt platziert: ${section.name}`);
    },
    [arr, doc, snap, tm],
  );

  const appendSection = useCallback(
    (section: SectionItem) => {
      if (!doc) return;
      const target =
        doc.tracks.find((t) => t.id === arr.selectedTrackId && t.kind === 'section') ??
        doc.tracks.find((t) => t.kind === 'section');
      const end = target ? target.clips.reduce((m, c) => Math.max(m, clipEndBeat(c)), 0) : 0;
      placeSection(section, target?.id ?? null, end);
    },
    [arr.selectedTrackId, doc, placeSection],
  );

  const playheadNow = () => (arr.isPlaying ? playheadBeatRef.current : arr.startBeat);

  const splitAtPlayhead = useCallback(() => {
    if (!doc) return;
    const at = arr.isPlaying ? playheadBeatRef.current : arr.startBeat;
    let ids = [...arr.selectedClipIds];
    if (ids.length === 0) {
      for (const t of doc.tracks) {
        if (arr.selectedTrackId && t.id !== arr.selectedTrackId) continue;
        for (const c of t.clips) if (c.startBeat < at && clipEndBeat(c) > at) ids.push(c.id);
      }
    }
    ids = ids.filter((id) => {
      const f = findClip(doc, id);
      return f && f.clip.startBeat < at && clipEndBeat(f.clip) > at;
    });
    if (ids.length === 0) return;
    const newIds: string[] = [];
    arr.commit((d) => {
      let next = d;
      for (const id of ids) {
        const r = splitClip(next, id, at, makeTimelineId, tm);
        next = r.doc;
        if (r.rightId) newIds.push(r.rightId);
      }
      return next;
    }, 'Clip geteilt');
    arr.setSelectedClipIds(newIds);
  }, [arr, doc, tm]);

  // --- keyboard ---------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
        if ((t as HTMLInputElement).type !== 'range') return;
      }
      if (!doc) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (e.key === ' ') {
        e.preventDefault();
        void arr.togglePlay();
      } else if (!mod && key === 's') {
        e.preventDefault();
        splitAtPlayhead();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (arr.selectedClipIds.length === 0) return;
        e.preventDefault();
        arr.commit((d) => removeClips(d, arr.selectedClipIds), 'Clips gelöscht');
        arr.setSelectedClipIds([]);
      } else if (mod && key === 'd') {
        e.preventDefault();
        if (arr.selectedClipIds.length === 0) return;
        let ids: string[] = [];
        arr.commit((d) => {
          const r = duplicateClips(d, arr.selectedClipIds, makeTimelineId);
          ids = r.newIds;
          return r.doc;
        }, 'Clips dupliziert');
        arr.setSelectedClipIds(ids);
      } else if (mod && key === 'c') {
        const items = arr.selectedClipIds
          .map((id) => findClip(doc, id))
          .filter((f): f is NonNullable<typeof f> => !!f)
          .map((f) => ({ trackId: f.track.id, clip: f.clip }));
        if (items.length) {
          arr.clipboardRef.current = items;
          studio.showNotice(`${items.length} Clip(s) kopiert`);
        }
      } else if (mod && key === 'v') {
        if (arr.clipboardRef.current.length === 0) return;
        e.preventDefault();
        let ids: string[] = [];
        arr.commit((d) => {
          const r = pasteClips(d, arr.clipboardRef.current, playheadNow(), makeTimelineId);
          ids = r.newIds;
          return r.doc;
        }, 'Clips eingefügt');
        arr.setSelectedClipIds(ids);
      } else if (!mod && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && arr.selectedClipIds.length > 0) {
        e.preventDefault();
        const first = findClip(doc, arr.selectedClipIds[0]!);
        const step = doc.snap.enabled && doc.snap.grid !== 'off' ? gridStepAt(first?.clip.startBeat ?? 0, doc.snap.grid, tm) : 1;
        arr.commit((d) => moveClips(d, arr.selectedClipIds, e.key === 'ArrowLeft' ? -step : step), 'Clips verschoben');
      } else if (!mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && arr.selectedClipIds.length > 0) {
        e.preventDefault();
        const f = findClip(doc, arr.selectedClipIds[0]!);
        if (!f) return;
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        for (let i = f.trackIndex + dir; i >= 0 && i < doc.tracks.length; i += dir) {
          const target = doc.tracks[i]!;
          if (target.kind === f.track.kind) {
            arr.commit((d) => moveClips(d, arr.selectedClipIds, 0, target.id), 'Clips auf andere Spur');
            break;
          }
        }
      } else if (!mod && key === 'v') {
        arr.setTool('select');
      } else if (!mod && key === 'c') {
        arr.setTool('scissors');
      } else if (!mod && key === 'b') {
        arr.setTool('pen');
      } else if (e.key === 'Home') {
        arr.locate(0);
      } else if (e.key === 'Escape') {
        arr.setSelectedClipIds([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arr, doc, splitAtPlayhead, studio, tm]);

  // --- pointer: clips -------------------------------------------------------------
  const onClipPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, clip: ArrangementClip, zone: ClipZone) => {
      if (!doc) return;
      e.stopPropagation();
      const track = clipTrackOf(clip.id);
      if (!track) return;
      arr.setSelectedTrackId(track.id);
      arr.setInspectMaster(false);
      if (arr.tool === 'scissors') {
        const p = contentPoint(e.clientX, e.clientY);
        const at = snap(p.x / pxPerBeat, e.altKey, [clip.id]);
        const r = splitClip(doc, clip.id, at, makeTimelineId, tm);
        if (r.rightId) {
          arr.commit(() => r.doc, 'Clip geteilt');
          arr.setSelectedClipIds([r.rightId]);
        }
        return;
      }
      let ids: string[];
      if (e.shiftKey) {
        ids = arr.selectedClipIds.includes(clip.id)
          ? arr.selectedClipIds.filter((id) => id !== clip.id)
          : [...arr.selectedClipIds, clip.id];
        arr.setSelectedClipIds(ids);
        if (!ids.includes(clip.id)) return;
      } else {
        ids = arr.selectedClipIds.includes(clip.id) ? [...arr.selectedClipIds] : [clip.id];
        arr.setSelectedClipIds(ids);
      }
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        kind: 'clip',
        zone,
        clipId: clip.id,
        ids: zone === 'move' ? ids : [clip.id],
        startX: e.clientX,
        startY: e.clientY,
        origStart: clip.startBeat,
        origEnd: clipEndBeat(clip),
        origTrackId: track.id,
        moved: false,
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [arr, doc, pxPerBeat, snap, tm],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || !doc) return;
      if (d.kind === 'clip') {
        const dx = e.clientX - d.startX;
        if (!d.moved && Math.abs(dx) < 3 && Math.abs(e.clientY - d.startY) < 3) return;
        d.moved = true;
        const dBeats = dx / pxPerBeat;
        const exclude = d.ids;
        switch (d.zone) {
          case 'move': {
            const newStart = snap(d.origStart + dBeats, e.altKey, exclude);
            // Snap the clip END as well if that is closer to a candidate.
            const newEnd = snap(d.origEnd + dBeats, e.altKey, exclude);
            const deltaA = newStart - d.origStart;
            const deltaB = newEnd - d.origEnd;
            const delta = Math.abs(deltaA - dBeats) <= Math.abs(deltaB - dBeats) ? deltaA : deltaB;
            const p = contentPoint(e.clientX, e.clientY);
            const overTrack = trackAtY(rows, p.y);
            const target = overTrack ? doc.tracks.find((t) => t.id === overTrack) : undefined;
            const origTrack = doc.tracks.find((t) => t.id === d.origTrackId);
            const sameTrackGroup = d.ids.every((id) => clipTrackOf(id)?.id === d.origTrackId);
            const toTrack = target && origTrack && target.kind === origTrack.kind && sameTrackGroup ? target.id : undefined;
            arr.preview((b) => moveClips(b, d.ids, delta, toTrack));
            break;
          }
          case 'trim-start':
            arr.preview((b) => trimClipStart(b, d.clipId, snap(d.origStart + dBeats, e.altKey, exclude), tm));
            break;
          case 'trim-end':
            arr.preview((b) => trimClipEnd(b, d.clipId, snap(d.origEnd + dBeats, e.altKey, exclude)));
            break;
          case 'fade-in': {
            const p = contentPoint(e.clientX, e.clientY);
            const beats = Math.max(0, Math.min(d.origEnd - d.origStart, snap(p.x / pxPerBeat, e.altKey, exclude) - d.origStart));
            arr.preview((b) => {
              const f = findClip(b, d.clipId);
              return f ? updateClip(b, d.clipId, { fadeIn: { ...f.clip.fadeIn, beats } }) : b;
            });
            break;
          }
          case 'fade-out': {
            const p = contentPoint(e.clientX, e.clientY);
            const beats = Math.max(0, Math.min(d.origEnd - d.origStart, d.origEnd - snap(p.x / pxPerBeat, e.altKey, exclude)));
            arr.preview((b) => {
              const f = findClip(b, d.clipId);
              return f ? updateClip(b, d.clipId, { fadeOut: { ...f.clip.fadeOut, beats } }) : b;
            });
            break;
          }
        }
      } else if (d.kind === 'marquee') {
        const p = contentPoint(e.clientX, e.clientY);
        if (!d.moved && Math.abs(p.x - d.x0) < 4 && Math.abs(p.y - d.y0) < 4) return;
        d.moved = true;
        const r = { x0: d.x0, y0: d.y0, x1: p.x, y1: p.y };
        setMarquee(r);
        const bx0 = Math.min(r.x0, r.x1) / pxPerBeat;
        const bx1 = Math.max(r.x0, r.x1) / pxPerBeat;
        const y0 = Math.min(r.y0, r.y1);
        const y1 = Math.max(r.y0, r.y1);
        const hit: string[] = [];
        for (const row of rows) {
          if (row.kind !== 'track' || row.top + row.height < y0 || row.top > y1) continue;
          const t = doc.tracks.find((x) => x.id === row.trackId);
          for (const c of t?.clips ?? []) if (c.startBeat < bx1 && clipEndBeat(c) > bx0) hit.push(c.id);
        }
        arr.setSelectedClipIds(d.additive ? [...new Set([...d.base, ...hit])] : hit);
      } else if (d.kind === 'ruler') {
        const rect = scrollRef.current!.getBoundingClientRect();
        const beat = snap((e.clientX - rect.left + scrollRef.current!.scrollLeft) / pxPerBeat, e.altKey);
        if (d.loop) {
          const a = Math.min(d.anchor, beat);
          const b = Math.max(d.anchor, beat);
          if (b - a > 1e-6) arr.preview((base) => ({ ...base, loop: { enabled: true, startBeat: a, endBeat: b } }));
        } else {
          arr.locate(beat);
        }
      }
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      if (d.kind === 'clip' && d.moved) {
        const labels: Record<ClipZone, string> = {
          move: 'Clip verschoben',
          'trim-start': 'Clip-Anfang getrimmt',
          'trim-end': 'Clip-Länge geändert',
          'fade-in': 'Einblenden',
          'fade-out': 'Ausblenden',
        };
        arr.commitPreview(labels[d.zone]);
      } else if (d.kind === 'marquee') {
        setMarquee(null);
        if (!d.moved) {
          const p = contentPoint(e.clientX, e.clientY);
          if (!d.additive) arr.setSelectedClipIds([]);
          arr.locate(snap(p.x / pxPerBeat, e.altKey));
        }
      } else if (d.kind === 'ruler' && d.loop) {
        arr.commitPreview('Loop-Bereich');
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arr, doc, pxPerBeat, rows, snap, tm]);

  // --- rendering ------------------------------------------------------------------
  if (!doc) {
    return <div className="tl-workspace"><div className="muted-note" style={{ padding: 20 }}>Timeline wird vorbereitet …</div></div>;
  }

  const songBpm = doc.tempoMarkers[0]?.bpm ?? 130;
  const firstMeter = doc.meterMarkers[0] ?? { numerator: 4, denominator: 4 };
  const visibleB0 = scroll.left / pxPerBeat - 2;
  const visibleB1 = (scroll.left + scroll.width) / pxPerBeat + 2;

  // Key clash hint: overlapping section clips in different keys.
  const keyHint = (() => {
    const items: Array<{ s: number; e: number; key: string }> = [];
    for (const t of doc.tracks) {
      if (t.muted) continue;
      for (const c of t.clips) {
        if (c.kind !== 'section' || c.muted) continue;
        const sec = sectionById.get(c.sectionId);
        if (!sec) continue;
        const h = sec.snapshot.harmony;
        items.push({ s: c.startBeat, e: clipEndBeat(c), key: `${(((h.rootNote + (c.transposeSemitones ?? 0)) % 12) + 12) % 12}|${h.scaleId}` });
      }
    }
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]!;
        const b = items[j]!;
        if (a.key !== b.key && a.s < b.e && b.s < a.e) return `Übereinanderliegende Clips in verschiedenen Tonarten ab Takt ${tm.formatPosition(Math.max(a.s, b.s)).split(':')[0]}`;
      }
    return null;
  })();

  const setSnap = (patch: Partial<ArrangementDoc['snap']>) => arr.commit((d) => ({ ...d, snap: { ...d.snap, ...patch } }), 'Raster');

  const promptMarkerAt = (beat: number) => {
    const name = window.prompt('Name des Markers (z. B. Intro, Drop):', 'Marker');
    if (!name) return;
    arr.commit(
      (d) => addSongMarker(d, { id: makeTimelineId('mark'), beat, name, color: '#f472b6' }),
      `Marker: ${name}`,
    );
  };

  const promptTempoAt = (beat: number) => {
    const v = Number(window.prompt(`Tempo ab Takt ${tm.formatPosition(beat)} (BPM):`, String(Math.round(tm.bpmAt(beat)))));
    if (!Number.isFinite(v) || v < 20 || v > 300) return;
    arr.commit((d) => setTempoMarker(d, beat, v, makeTimelineId), `Tempo ${v} BPM`);
  };

  const promptMeterAt = (beatRaw: number) => {
    const bar = tm.barPosition(beatRaw);
    const beat = beatRaw - bar.beatInBar;
    const v = window.prompt(`Taktart ab Takt ${bar.bar + 1} (z. B. 4/4, 3/4, 7/8):`, `${bar.numerator}/${bar.denominator}`);
    const m = v?.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
    if (!m) return;
    const num = Number(m[1]);
    const den = Number(m[2]);
    if (!(num >= 1 && num <= 16 && [2, 4, 8, 16].includes(den))) return;
    arr.commit((d) => setMeterMarker(d, beat, num, den, makeTimelineId), `Taktart ${num}/${den}`);
  };

  const markerNear = (beat: number) => {
    const tol = 8 / pxPerBeat;
    return {
      song: doc.songMarkers.find((m) => Math.abs(m.beat - beat) < tol),
      tempo: doc.tempoMarkers.find((m) => Math.abs(m.beat - beat) < tol),
      meter: doc.meterMarkers.find((m) => Math.abs(m.beat - beat) < tol),
    };
  };

  return (
    <div className="tl-workspace">
      {/* Toolbar */}
      <div className="tl-toolbar">
        <button type="button" className={`btn-play${arr.isPlaying ? ' is-playing' : ''}`} onClick={() => void arr.togglePlay()} title="Play / Stop (Leertaste)">
          {arr.isPlaying ? <Square size={13} /> : <Play size={13} />}
          <span>{arr.isPlaying ? 'Stop' : 'Play'}</span>
        </button>
        <button type="button" onClick={() => arr.locate(0)} title="Zum Anfang (Pos1)">
          <SkipBack size={13} />
        </button>
        <span className="tl-position" ref={posLabelRef} title="Position (Takt:Beat · Minuten)">
          1:1 · 0:00.0
        </span>
        {recordControls}

        <div className="field-chip" title="Song-Tempo am Anfang (Tempo-Wechsel: „+ Tempo“ an der Startposition)">
          <Gauge size={12} />
          <input
            type="number"
            min={20}
            max={300}
            value={Math.round(songBpm)}
            style={{ width: 52 }}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 20 && v <= 300) arr.commit((d) => setTempoMarker(d, 0, v, makeTimelineId), `Song-Tempo ${v}`);
            }}
          />
          <span className="muted-note">BPM · {firstMeter.numerator}/{firstMeter.denominator}</span>
        </div>
        <button type="button" className="btn-sm" onClick={() => promptTempoAt(arr.startBeat)} title="Tempo-Wechsel an der Startposition">
          + Tempo
        </button>
        <button type="button" className="btn-sm" onClick={() => promptMeterAt(arr.startBeat)} title="Taktart-Wechsel am Takt der Startposition">
          + Taktart
        </button>
        <button type="button" className="btn-sm" onClick={() => promptMarkerAt(arr.startBeat)} title="Song-Marker (Intro, Drop …) an der Startposition">
          <Flag size={11} /> Marker
        </button>

        <span className="tl-sep" />
        <div className="segmented" title="Werkzeug">
          <button type="button" className={arr.tool === 'select' ? 'is-active' : undefined} onClick={() => arr.setTool('select')} title="Auswahl (V)">
            <MousePointer2 size={12} />
          </button>
          <button type="button" className={arr.tool === 'scissors' ? 'is-active' : undefined} onClick={() => arr.setTool('scissors')} title="Schere (C) – Klick auf Clip teilt ihn">
            <Scissors size={12} />
          </button>
        </div>
        <button
          type="button"
          className={`btn-sm${doc.snap.enabled ? ' is-active' : ''}`}
          onClick={() => setSnap({ enabled: !doc.snap.enabled })}
          title="Magnet-Raster an/aus (Alt beim Ziehen = kurz aus)"
        >
          <Magnet size={12} />
        </button>
        <select value={doc.snap.grid} onChange={(e) => setSnap({ grid: e.target.value as SnapGrid, enabled: e.target.value !== 'off' })} title="Raster">
          {(Object.keys(SNAP_GRID_LABELS) as SnapGrid[]).map((g) => (
            <option key={g} value={g}>
              {SNAP_GRID_LABELS[g]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`btn-sm${doc.loop?.enabled ? ' is-active' : ''}`}
          onClick={() => {
            if (doc.loop && doc.loop.endBeat > doc.loop.startBeat) {
              arr.commit((d) => ({ ...d, loop: { ...d.loop!, enabled: !d.loop!.enabled } }), doc.loop.enabled ? 'Loop aus' : 'Loop an');
            } else {
              const sel = arr.selectedClipIds.map((id) => findClip(doc, id)?.clip).filter((c): c is ArrangementClip => !!c);
              const a = sel.length ? Math.min(...sel.map((c) => c.startBeat)) : tm.barStartBeat(tm.barPosition(arr.startBeat).bar);
              const b = sel.length ? Math.max(...sel.map(clipEndBeat)) : tm.barStartBeat(tm.barPosition(arr.startBeat).bar + 4);
              arr.commit((d) => ({ ...d, loop: { enabled: true, startBeat: a, endBeat: b } }), 'Loop an');
            }
          }}
          title="Loop-Bereich an/aus (Shift + Ziehen im Lineal setzt den Bereich)"
        >
          <Repeat size={12} />
        </button>
        <button type="button" className={`btn-sm${follow ? ' is-active' : ''}`} onClick={() => setFollow((f) => !f)} title="Ansicht folgt dem Playhead">
          <Crosshair size={12} />
        </button>
        <button type="button" className="btn-sm" onClick={() => setPxPerBeat((p) => Math.max(MIN_PX_PER_BEAT, p / 1.3))} title="Herauszoomen (Strg + Mausrad)">
          <ZoomOut size={12} />
        </button>
        <button type="button" className="btn-sm" onClick={() => setPxPerBeat((p) => Math.min(MAX_PX_PER_BEAT, p * 1.3))} title="Hineinzoomen (Strg + Mausrad)">
          <ZoomIn size={12} />
        </button>
        <span className="tl-sep" />
        <button type="button" className="btn-sm" disabled={!arr.canUndo} onClick={arr.undo} title="Rückgängig (Strg+Z)">
          <Undo2 size={12} />
        </button>
        <button type="button" className="btn-sm" disabled={!arr.canRedo} onClick={arr.redo} title="Wiederholen (Strg+Y)">
          <Redo2 size={12} />
        </button>
        <span className="tl-sep" />
        <button type="button" className="btn-sm" onClick={() => arr.commit((d) => addTrack(d, createTrack('section', makeTimelineId, d.tracks.length)), 'Abschnitts-Spur')}>
          <Plus size={11} /> Abschnitts-Spur
        </button>
        <button type="button" className="btn-sm" onClick={() => arr.commit((d) => addTrack(d, createTrack('audio', makeTimelineId, d.tracks.length)), 'Audio-Spur')}>
          <Plus size={11} /> Audio-Spur
        </button>
        <button
          type="button"
          className="btn-sm"
          disabled={sections.length === 0}
          onClick={() => arr.commit((d) => arrangementFromSongChain(sections, d, makeTimelineId), 'Song-Kette übernommen')}
          title="Alle Abschnitte in ihrer Reihenfolge (mit ihrer Export-Länge) als neue Spur hintereinander legen"
        >
          <ListPlus size={11} /> Song-Kette → Timeline
        </button>
        {transitionPalette}
        {(keyHint || limitHit) && (
          <span className="tl-hint" title={limitHit ? 'Zu viele Abschnitte gleichzeitig – Spuren einfrieren entlastet die CPU' : undefined}>
            <AlertTriangle size={11} /> {limitHit ? 'Zu viele gleichzeitige Abschnitte – einige bleiben stumm' : keyHint}
          </span>
        )}
      </div>

      <div className="tl-body" style={{ gridTemplateColumns: `${layout.media}px 10px minmax(0, 1fr)` }}>
        <MediaBrowser sections={sections} usedSectionIds={usedSectionIds} onAppendSection={appendSection} audioPool={audioPool} />
        <Splitter
          direction="col"
          onDragStart={() => (layoutStart.current = layout)}
          onDrag={(d) => {
            const next = { ...layoutStart.current, media: Math.max(150, Math.min(420, layoutStart.current.media + d)) };
            setLayout(next);
            saveLayoutPref('timeline-layout', next);
          }}
          onReset={() => setLayout((l) => ({ ...l, media: 220 }))}
        />
        <div className="tl-center">
          <div className="tl-main" style={{ gridTemplateColumns: `${HEADER_WIDTH}px minmax(0, 1fr)`, gridTemplateRows: `${RULER_HEIGHT}px minmax(0, 1fr)` }}>
            <div className="tl-corner">
              <span className="muted-note">{arr.lastLabel || 'Timeline'}</span>
            </div>
            <div className="tl-ruler-holder">
              <TimelineRuler
                doc={doc}
                tempoMap={tm}
                scrollLeft={scroll.left}
                width={scroll.width}
                pxPerBeat={pxPerBeat}
                startBeat={arr.startBeat}
                onPointerDown={(e, beat, row) => {
                  if (e.button !== 0) return;
                  if (row === 'markers') return;
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  const b = snap(beat, e.altKey);
                  dragRef.current = { kind: 'ruler', loop: e.shiftKey, anchor: b };
                  if (!e.shiftKey) arr.locate(b);
                }}
                onDoubleClick={(beat, row) => {
                  const near = markerNear(beat);
                  if (row === 'markers' && near.song) {
                    const name = window.prompt('Marker umbenennen:', near.song.name);
                    if (name) arr.commit((d) => updateSongMarker(d, near.song!.id, { name }), 'Marker umbenannt');
                  } else if (row === 'markers' && near.tempo) {
                    promptTempoAt(near.tempo.beat);
                  } else if (row === 'markers' && near.meter) {
                    promptMeterAt(near.meter.beat);
                  } else if (row === 'markers') {
                    promptMarkerAt(snap(beat, false));
                  }
                }}
                onContextMenu={(_e, beat) => {
                  const near = markerNear(beat);
                  if (near.song && window.confirm(`Marker „${near.song.name}“ löschen?`)) {
                    arr.commit((d) => removeSongMarker(d, near.song!.id), 'Marker gelöscht');
                  } else if (near.tempo && near.tempo.beat > 0 && window.confirm(`Tempo-Wechsel (${Math.round(near.tempo.bpm)} BPM) löschen?`)) {
                    arr.commit((d) => removeTempoMarker(d, near.tempo!.id), 'Tempo-Wechsel gelöscht');
                  } else if (near.meter && near.meter.beat > 0 && window.confirm('Taktart-Wechsel löschen?')) {
                    arr.commit((d) => removeMeterMarker(d, near.meter!.id), 'Taktart-Wechsel gelöscht');
                  }
                }}
              />
              <div ref={rulerHeadRef} className="tl-ruler-playhead" />
            </div>

            <div className="tl-headers">
              <div style={{ transform: `translateY(${-scroll.top}px)`, height: contentHeight, position: 'relative' }}>
                {rows.map((row) => {
                  if (row.kind === 'track') {
                    const track = doc.tracks[row.index]!;
                    const laneCount = doc.automation.filter((l) =>
                      l.target.scope === 'track' || l.target.scope === 'track-fx'
                        ? l.target.trackId === track.id
                        : (l.target.scope === 'clip-layer' || l.target.scope === 'clip-layer-param') &&
                          track.clips.some((c) => c.id === (l.target as { clipId: string }).clipId),
                    ).length;
                    return (
                      <div key={row.trackId} style={{ position: 'absolute', top: row.top, left: 0, right: 0 }}>
                        <TrackHeader
                          track={track}
                          height={row.height}
                          selected={arr.selectedTrackId === track.id && !arr.inspectMaster}
                          automationOpen={openAutomation.has(track.id)}
                          laneCount={laneCount}
                          meterRef={(el) => {
                            if (el) meterEls.current.set(track.id, el);
                            else meterEls.current.delete(track.id);
                          }}
                          onSelect={() => {
                            arr.setSelectedTrackId(track.id);
                            arr.setSelectedClipIds([]);
                            arr.setInspectMaster(false);
                          }}
                          onToggle={(key) =>
                            arr.commit((d) => updateTrack(d, track.id, { [key]: !track[key] }), `${track.name}: ${key === 'muted' ? 'Stumm' : key === 'solo' ? 'Solo' : 'Aufnahme'}`)
                          }
                          onLive={(patch) => arr.preview((b) => updateTrack(b, track.id, patch))}
                          onLiveEnd={(label) => arr.commitPreview(label)}
                          onToggleAutomation={() =>
                            setOpenAutomation((s) => {
                              const n = new Set(s);
                              if (n.has(track.id)) n.delete(track.id);
                              else n.add(track.id);
                              return n;
                            })
                          }
                          onAddLevelLane={() => addLane({ scope: 'track', trackId: track.id, param: 'level' }, `${track.name} · Pegel`, track.level)}
                          onDelete={() => {
                            if (track.clips.length > 0 && !window.confirm(`Spur „${track.name}“ mit ${track.clips.length} Clip(s) löschen?`)) return;
                            arr.commit((d) => removeTrack(d, track.id), `Spur gelöscht: ${track.name}`);
                          }}
                        />
                      </div>
                    );
                  }
                  if (row.kind === 'lane') {
                    const meta = automationMeta(doc, row.lane.target, sections);
                    return (
                      <div key={row.lane.id} className="tl-lane-head" style={{ top: row.top, height: row.height }}>
                        <span className="tl-lane-name" title={meta.label} style={{ color: meta.color }}>
                          {meta.valid ? meta.label : `⚠ ${meta.label}`}
                          {row.lane.generatedBy && <span className="tl-clip-badge">Vorlage</span>}
                        </span>
                        <div className="tl-lane-actions">
                          <label className="inline-check" title="Automation an/aus">
                            <input
                              type="checkbox"
                              checked={row.lane.enabled}
                              onChange={(e) => arr.commit((d) => updateLane(d, row.lane.id, { enabled: e.target.checked }), 'Automation an/aus')}
                            />
                          </label>
                          <button type="button" className="btn-ghost btn-sm btn-danger" onClick={() => arr.commit((d) => removeLane(d, row.lane.id), 'Automation gelöscht')} title="Automationsspur löschen">
                            ×
                          </button>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div
                      key="master"
                      className={`tl-master-head${arr.inspectMaster ? ' is-selected' : ''}`}
                      style={{ top: row.top, height: row.height }}
                      onClick={() => {
                        arr.setInspectMaster(true);
                        arr.setSelectedClipIds([]);
                      }}
                    >
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMasterOpen((v) => !v);
                        }}
                        title="Master-Automation auf-/zuklappen"
                      >
                        {masterOpen ? '▾' : '▸'}
                      </button>
                      <span>Master</span>
                      <span className="muted-note">{doc.masterFx.length > 0 ? `${doc.masterFx.length} FX` : ''}</span>
                      <div className="tl-meter is-master">
                        <div ref={masterMeterRef} className="tl-meter-fill" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div
              className={`tl-scroll${arr.tool === 'scissors' ? ' is-scissors' : ''}`}
              ref={scrollRef}
              onDragOver={(e) => {
                if (
                  e.dataTransfer.types.includes(SECTION_DRAG_TYPE) ||
                  e.dataTransfer.types.includes(ASSET_DRAG_TYPE) ||
                  e.dataTransfer.types.includes('Files')
                ) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                const p = contentPoint(e.clientX, e.clientY);
                const beat = Math.max(0, p.x / pxPerBeat);
                const trackId = trackAtY(rows, p.y);
                const secId = e.dataTransfer.getData(SECTION_DRAG_TYPE);
                const assetId = e.dataTransfer.getData(ASSET_DRAG_TYPE);
                if (secId) {
                  const sec = sectionById.get(secId);
                  if (sec) placeSection(sec, trackId, beat);
                } else if (assetId) {
                  onDropAsset?.(assetId, trackId, snap(beat, e.altKey));
                } else if (e.dataTransfer.files.length > 0) {
                  onDropFiles?.([...e.dataTransfer.files], trackId, snap(beat, e.altKey));
                }
              }}
            >
              <div className="tl-content" style={{ width: totalWidth, height: Math.max(contentHeight, scroll.height) }}>
                <canvas ref={gridRef} className="tl-grid-canvas" style={{ left: scroll.left, top: scroll.top }} />
                {rows.map((row) => {
                  if (row.kind === 'track') {
                    const track = doc.tracks[row.index]!;
                    return (
                      <div
                        key={row.trackId}
                        className={`tl-lane-row${arr.selectedTrackId === track.id ? ' is-selected' : ''}${track.muted ? ' is-muted' : ''}`}
                        style={{ top: row.top, height: row.height }}
                        onPointerDown={(e) => {
                          if (e.button !== 0 || e.target !== e.currentTarget) return;
                          arr.setSelectedTrackId(track.id);
                          arr.setInspectMaster(false);
                          const p = contentPoint(e.clientX, e.clientY);
                          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                          dragRef.current = { kind: 'marquee', x0: p.x, y0: p.y, additive: e.shiftKey, base: arr.selectedClipIds, moved: false };
                        }}
                      >
                        {track.clips.map((clip) => {
                          const end = clipEndBeat(clip);
                          if (end < visibleB0 || clip.startBeat > visibleB1) return null;
                          const section = clip.kind === 'section' ? sectionById.get(clip.sectionId) : undefined;
                          const left = clip.startBeat * pxPerBeat;
                          const width = clip.lengthBeats * pxPerBeat;
                          const label = clip.kind === 'section' ? section?.name ?? '' : studio.project.assets?.find((a) => a.id === clip.assetId)?.name ?? 'Audio';
                          return (
                            <ClipView
                              key={clip.id}
                              clip={clip}
                              left={left}
                              width={width}
                              height={row.height - 4}
                              pxPerBeat={pxPerBeat}
                              color={section?.color ?? track.color}
                              label={label}
                              section={section}
                              missing={clip.kind === 'section' && !section}
                              selected={arr.selectedClipIds.includes(clip.id)}
                              scissors={arr.tool === 'scissors'}
                              waveform={clip.kind === 'audio' ? renderWaveform?.(clip, width, row.height - 4) : undefined}
                              onPointerDown={onClipPointerDown}
                              onDoubleClick={(c) => {
                                if (c.kind === 'section') onOpenInBeatkasten(c.sectionId);
                              }}
                              onContextMenu={(_e, c) => onClipContextMenu?.(c)}
                            />
                          );
                        })}
                      </div>
                    );
                  }
                  if (row.kind === 'lane') {
                    const meta = automationMeta(doc, row.lane.target, sections);
                    return (
                      <div key={row.lane.id} className="tl-lane-row is-auto" style={{ top: row.top, height: row.height }}>
                        <AutomationLaneView
                          lane={row.lane}
                          height={row.height}
                          pxPerBeat={pxPerBeat}
                          scrollLeft={scroll.left}
                          viewWidth={scroll.width}
                          totalWidth={totalWidth}
                          min={meta.min}
                          max={meta.max}
                          beatOffset={meta.beatOffset}
                          color={meta.color}
                          snap={(b, alt) => snap(b, alt)}
                          onPreview={(points) => arr.preview((base) => updateLane(base, row.lane.id, { points }))}
                          onCommitPreview={(label) => arr.commitPreview(label)}
                          onCommit={(points, label) => arr.commit((d) => updateLane(d, row.lane.id, { points }), label)}
                        />
                      </div>
                    );
                  }
                  return <div key="master" className="tl-lane-row is-master" style={{ top: row.top, height: row.height }} />;
                })}
                {marquee && (
                  <div
                    className="tl-marquee"
                    style={{
                      left: Math.min(marquee.x0, marquee.x1),
                      top: Math.min(marquee.y0, marquee.y1),
                      width: Math.abs(marquee.x1 - marquee.x0),
                      height: Math.abs(marquee.y1 - marquee.y0),
                    }}
                  />
                )}
                <div className="tl-startpos" style={{ transform: `translateX(${arr.startBeat * pxPerBeat}px)` }} />
                <div ref={playheadRef} className={`tl-playhead${arr.isPlaying ? ' is-playing' : ''}`} />
              </div>
            </div>
          </div>

          <Splitter
            direction="row"
            onDragStart={() => (layoutStart.current = layout)}
            onDrag={(d) => {
              const next = { ...layoutStart.current, inspector: Math.max(90, Math.min(520, layoutStart.current.inspector - d)) };
              setLayout(next);
              saveLayoutPref('timeline-layout', next);
            }}
            onReset={() => setLayout((l) => ({ ...l, inspector: 230 }))}
          />
          <div className="tl-inspector-holder" style={{ height: layout.inspector }}>
            <TimelineInspector
              arr={arr}
              doc={doc}
              sections={sections}
              onOpenInBeatkasten={onOpenInBeatkasten}
              onDetachVariant={(clip: SectionClip) => {
                const sec = sectionById.get(clip.sectionId);
                if (!sec) return;
                const base = {
                  ...sec.snapshot,
                  layers: sec.snapshot.layers.map((l) => {
                    const ov = clip.layerOverrides[l.id];
                    if (!ov) return l;
                    return {
                      ...l,
                      ...(ov.enabled === false ? { muted: true } : ov.enabled === true ? { enabled: true, muted: false } : {}),
                      ...(ov.level !== undefined ? { level: ov.level } : {}),
                      ...(ov.pan !== undefined ? { pan: ov.pan } : {}),
                    };
                  }),
                };
                const newId = studio.addSectionFromSnapshot(base, `${sec.name} (Variante)`, sec.exportBars);
                arr.commit((d) => updateClip(d, clip.id, { sectionId: newId, layerOverrides: {} }), 'Als Variante abgekoppelt');
                studio.showNotice(`Neuer Abschnitt „${sec.name} (Variante)“ – nur dieser Clip nutzt ihn`);
              }}
              onAddLane={addLane}
              clipActions={clipActions}
              selectionActions={selectionActions}
              onFreezeTrack={onFreezeTrack}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
