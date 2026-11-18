import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TempoMap } from '../../core/arrangement/tempoMap';
import type { ArrangementClip, ArrangementDoc } from '../../core/arrangement/types';
import { createEmptyArrangement } from '../../core/state/arrangementMigration';
import { nextUiId, type StudioStore } from '../store/useStudioStore';

const MAX_UNDO = 200;

export type TimelineTool = 'select' | 'scissors' | 'pen';

export interface ClipboardItem {
  readonly trackId: string;
  readonly clip: ArrangementClip;
}

export const makeTimelineId = (prefix: string): string => nextUiId(prefix);

/**
 * UI state of the timeline workspace: the document lives in the project
 * (studio store, autosaved); this store adds a linear undo/redo stack, drag
 * previews, selection, tool, clipboard and transport.
 */
export function useArrangementStore(studio: StudioStore, active: boolean) {
  const { project, setArrangement, audioBridge } = studio;
  const doc = project.arrangement ?? null;
  const docRef = useRef<ArrangementDoc | null>(doc);
  docRef.current = doc;

  // Old projects: create the arrangement on the first opening of the timeline.
  useEffect(() => {
    if (active && !project.arrangement) {
      setArrangement(createEmptyArrangement(project.activeSnapshot, makeTimelineId));
    }
  }, [active, project.arrangement, project.activeSnapshot, setArrangement]);

  const undoRef = useRef<ArrangementDoc[]>([]);
  const redoRef = useRef<ArrangementDoc[]>([]);
  const dragBaseRef = useRef<ArrangementDoc | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  const [lastLabel, setLastLabel] = useState<string>('');

  // Reset undo when another project is loaded.
  useEffect(() => {
    undoRef.current = [];
    redoRef.current = [];
    dragBaseRef.current = null;
    setHistoryTick((t) => t + 1);
  }, [project.id]);

  const apply = useCallback(
    (next: ArrangementDoc) => {
      docRef.current = next;
      setArrangement(next);
    },
    [setArrangement],
  );

  /** Undoable change. */
  const commit = useCallback(
    (updater: (d: ArrangementDoc) => ArrangementDoc, label: string) => {
      const cur = docRef.current;
      if (!cur) return;
      const base = dragBaseRef.current ?? cur;
      dragBaseRef.current = null;
      const next = updater(cur);
      if (next === base) return;
      undoRef.current.push(base);
      if (undoRef.current.length > MAX_UNDO) undoRef.current.shift();
      redoRef.current = [];
      setLastLabel(label);
      setHistoryTick((t) => t + 1);
      apply(next);
    },
    [apply],
  );

  /** Live preview during a drag: always computed from the doc at drag start. */
  const preview = useCallback(
    (updater: (base: ArrangementDoc) => ArrangementDoc) => {
      const cur = docRef.current;
      if (!cur) return;
      if (!dragBaseRef.current) dragBaseRef.current = cur;
      apply(updater(dragBaseRef.current));
    },
    [apply],
  );

  const commitPreview = useCallback(
    (label: string) => {
      const base = dragBaseRef.current;
      const cur = docRef.current;
      dragBaseRef.current = null;
      if (!base || !cur || base === cur) return;
      undoRef.current.push(base);
      if (undoRef.current.length > MAX_UNDO) undoRef.current.shift();
      redoRef.current = [];
      setLastLabel(label);
      setHistoryTick((t) => t + 1);
    },
    [],
  );

  const cancelPreview = useCallback(() => {
    const base = dragBaseRef.current;
    dragBaseRef.current = null;
    if (base) apply(base);
  }, [apply]);

  const undo = useCallback(() => {
    const cur = docRef.current;
    const prev = undoRef.current.pop();
    if (!cur || !prev) return;
    redoRef.current.push(cur);
    setHistoryTick((t) => t + 1);
    setLastLabel('Rückgängig');
    apply(prev);
  }, [apply]);

  const redo = useCallback(() => {
    const cur = docRef.current;
    const next = redoRef.current.pop();
    if (!cur || !next) return;
    undoRef.current.push(cur);
    setHistoryTick((t) => t + 1);
    setLastLabel('Wiederholt');
    apply(next);
  }, [apply]);

  // --- selection / tool / clipboard ---------------------------------------
  const [selectedClipIds, setSelectedClipIds] = useState<readonly string[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [inspectMaster, setInspectMaster] = useState(false);
  const [tool, setTool] = useState<TimelineTool>('select');
  const clipboardRef = useRef<ClipboardItem[]>([]);

  // Drop selections of clips that no longer exist.
  useEffect(() => {
    if (!doc || selectedClipIds.length === 0) return;
    const all = new Set<string>();
    for (const t of doc.tracks) for (const c of t.clips) all.add(c.id);
    if (selectedClipIds.some((id) => !all.has(id))) {
      setSelectedClipIds((ids) => ids.filter((id) => all.has(id)));
    }
  }, [doc, selectedClipIds]);

  // --- bridge sync ----------------------------------------------------------
  useEffect(() => {
    if (doc) audioBridge.loadArrangement(doc);
  }, [audioBridge, doc]);

  const sectionRefs = useMemo(
    () => project.sections.map((s) => ({ id: s.id, snapshot: s.snapshot })),
    [project.sections],
  );
  useEffect(() => {
    audioBridge.setSections(sectionRefs);
  }, [audioBridge, sectionRefs]);

  // --- transport ------------------------------------------------------------
  const [startBeat, setStartBeat] = useState(0);
  const startBeatRef = useRef(0);
  startBeatRef.current = startBeat;
  const isPlaying = studio.isPlaying && audioBridge.getMode() === 'arrangement';

  const play = useCallback(
    async (fromBeat?: number) => {
      const cur = docRef.current;
      if (!cur) return;
      audioBridge.loadArrangement(cur, true);
      try {
        await audioBridge.playArrangement(fromBeat ?? startBeatRef.current);
      } catch (err) {
        studio.showNotice(err instanceof Error ? err.message : 'Audio konnte nicht gestartet werden.');
      }
    },
    [audioBridge, studio],
  );

  const stop = useCallback(async () => {
    await audioBridge.stop();
  }, [audioBridge]);

  const togglePlay = useCallback(async () => {
    if (audioBridge.getIsPlaying()) await stop();
    else await play();
  }, [audioBridge, play, stop]);

  const locate = useCallback(
    (beat: number) => {
      const b = Math.max(0, beat);
      setStartBeat(b);
      if (audioBridge.getIsPlaying() && audioBridge.getMode() === 'arrangement') {
        audioBridge.seekSongBeat(b);
      }
    },
    [audioBridge],
  );

  const tempoMap = useMemo(
    () => (doc ? new TempoMap(doc.tempoMarkers, doc.meterMarkers) : new TempoMap([], [])),
    [doc],
  );

  return {
    doc,
    tempoMap,
    commit,
    preview,
    commitPreview,
    cancelPreview,
    undo,
    redo,
    canUndo: undoRef.current.length > 0,
    canRedo: redoRef.current.length > 0,
    historyTick,
    lastLabel,
    selectedClipIds,
    setSelectedClipIds,
    selectedTrackId,
    setSelectedTrackId,
    inspectMaster,
    setInspectMaster,
    tool,
    setTool,
    clipboardRef,
    startBeat,
    locate,
    isPlaying,
    play,
    stop,
    togglePlay,
  };
}

export type ArrangementStore = ReturnType<typeof useArrangementStore>;
