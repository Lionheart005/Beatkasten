import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioBridge, type LiveTelemetry } from '../../audio-host';
import { defaultRegistry } from '../../core/defaultRegistry';
import { DEFAULT_CURVE_PRESETS, type DrawnCurveData } from '../../core/math/curves';
import {
  commitSnapshot,
  createHypnoticAMinorProject,
  createInitialHistory,
  createDefaultLayer,
  createChordToOffbeatArpPreset,
  createTripletRiddlePreset,
  jumpToHistoryNode,
  stepRedoFirstChild,
  stepUndo,
  toggleBookmark,
  type BeatSnapshot,
  type LayerConfig,
  type ModulationRouteConfig,
  type ModulationTargetDomain,
  type ProcessorCardConfig,
  type ProjectDocument,
  type SectionItem,
} from '../../core/state';
import { buildDefaultParams } from '../../core/registry/types';
import type { CycleUnit } from '../../core/theory/cycles';
import {
  BrowserFsAdapter,
  IndexedDbAdapter,
  type ProjectSummary,
} from '../../storage';

export interface ActiveModTarget {
  readonly layerId: string;
  readonly targetDomain: Exclude<ModulationTargetDomain, 'modulation'>;
  readonly targetCardId: string;
  readonly targetParamId: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly unitLabel?: string;
}

export type SectionSwitchMode = 'immediate' | 'next-bar';

let uiIdCounter = 0;
function nextUiId(prefix: string): string {
  uiIdCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${uiIdCounter.toString(36)}`;
}

const SECTION_COLORS = [
  '#38bdf8',
  '#ff6b4a',
  '#22c55e',
  '#a855f7',
  '#f59e0b',
  '#ec4899',
];

const audioBridgeSingleton = new AudioBridge();
const idbAdapterSingleton = new IndexedDbAdapter();
const fsAdapterSingleton = new BrowserFsAdapter();

const HISTORY_DEBOUNCE_MS = 450;

export function useStudioStore() {
  const [project, setProject] = useState<ProjectDocument>(() =>
    createHypnoticAMinorProject(),
  );
  const [selectedLayerId, setSelectedLayerId] = useState<string>(
    () => project.activeSnapshot.layers[0]?.id ?? '',
  );
  const [selectedCurveId, setSelectedCurveId] = useState<string>(
    () => project.activeSnapshot.curves[0]?.id ?? '',
  );
  const [activeModTarget, setActiveModTarget] = useState<ActiveModTarget | null>(
    null,
  );
  const [compareNodeId, setCompareNodeId] = useState<string | null>(null);
  const [abCompareActive, setAbCompareActive] = useState<boolean>(false);
  const [hoveredModSourceId, setHoveredModSourceId] = useState<string | null>(
    null,
  );
  const [sectionSwitchMode, setSectionSwitchMode] =
    useState<SectionSwitchMode>('next-bar');
  const [pendingSectionId, setPendingSectionId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [fsConnected, setFsConnected] = useState<boolean>(false);
  const [fsFolderName, setFsFolderName] = useState<string | null>(null);
  const [savedProjects, setSavedProjects] = useState<ProjectSummary[]>([]);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const projectRef = useRef<ProjectDocument>(project);
  projectRef.current = project;

  const debounceTimerRef = useRef<number | null>(null);
  const pendingCommitRef = useRef<{
    snapshot: BeatSnapshot;
    label: string;
  } | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

  const showNotice = useCallback((msg: string) => {
    setStatusNotice(msg);
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setStatusNotice(null);
      noticeTimerRef.current = null;
    }, 2800);
  }, []);

  const persistProject = useCallback(async (doc: ProjectDocument) => {
    try {
      if (idbAdapterSingleton.isSupported()) {
        await idbAdapterSingleton.saveProject(doc);
      }
      if (fsAdapterSingleton.hasRootDirectory()) {
        await fsAdapterSingleton.saveProject(doc);
      }
    } catch {
      // Autosave should never interrupt live performance
    }
  }, []);

  const refreshSavedProjects = useCallback(async () => {
    try {
      const list = fsAdapterSingleton.hasRootDirectory()
        ? await fsAdapterSingleton.listProjects()
        : idbAdapterSingleton.isSupported()
          ? await idbAdapterSingleton.listProjects()
          : [];
      setSavedProjects(list);
    } catch {
      setSavedProjects([]);
    }
  }, []);

  // Load last saved project from IndexedDB on startup (if available)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!idbAdapterSingleton.isSupported()) return;
      try {
        const list = await idbAdapterSingleton.listProjects();
        if (cancelled) return;
        setSavedProjects(list);
        if (list.length > 0) {
          const loaded = await idbAdapterSingleton.loadProject(list[0]!.id);
          if (!cancelled && loaded) {
            setProject(loaded);
            setSelectedLayerId(loaded.activeSnapshot.layers[0]?.id ?? '');
            setSelectedCurveId(loaded.activeSnapshot.curves[0]?.id ?? '');
          }
        } else {
          await idbAdapterSingleton.saveProject(projectRef.current);
          const refreshed = await idbAdapterSingleton.listProjects();
          if (!cancelled) setSavedProjects(refreshed);
        }
      } catch {
        // Fallback keeps initial Hypnotic A-Minor starter project
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to live audio telemetry (only update React state on play/stop transitions)
  useEffect(() => {
    const unsubscribe = audioBridgeSingleton.onTelemetry((nextTelemetry) => {
      setIsPlaying((prev) =>
        prev === nextTelemetry.isPlaying ? prev : nextTelemetry.isPlaying,
      );
    });
    return () => {
      unsubscribe();
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  const subscribeTelemetry = useCallback(
    (listener: (t: LiveTelemetry) => void) =>
      audioBridgeSingleton.onTelemetry(listener),
    [],
  );

  const getTelemetry = useCallback(
    () => audioBridgeSingleton.getTelemetry(),
    [],
  );

  // Ensure selectedLayerId always points to an existing layer
  useEffect(() => {
    const layers = project.activeSnapshot.layers;
    if (layers.length > 0 && !layers.some((l) => l.id === selectedLayerId)) {
      setSelectedLayerId(layers[0]!.id);
    }
  }, [project.activeSnapshot.layers, selectedLayerId]);

  const flushPendingCommit = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    const pending = pendingCommitRef.current;
    if (!pending) return;
    pendingCommitRef.current = null;

    setProject((prev) => {
      const committed = commitSnapshot(
        prev.historyNodes,
        prev.activeHistoryNodeId,
        pending.snapshot,
        pending.label,
      );
      const nextDoc: ProjectDocument = {
        ...prev,
        updatedAt: Date.now(),
        activeSnapshot: pending.snapshot,
        activeHistoryNodeId: committed.activeNodeId,
        historyNodes: committed.nodes,
      };
      void persistProject(nextDoc);
      return nextDoc;
    });
  }, [persistProject]);

  /**
   * Updates active snapshot immediately (UI + audio) and debounces HistoryTree commit
   * by ~450 ms so slider drags never spam history nodes.
   */
  const updateSnapshotLive = useCallback(
    (updater: (snap: BeatSnapshot) => BeatSnapshot, label: string) => {
      setAbCompareActive(false);
      setProject((prev) => {
        const nextSnap = updater(prev.activeSnapshot);
        audioBridgeSingleton.updateSnapshot(nextSnap);
        pendingCommitRef.current = { snapshot: nextSnap, label };
        return {
          ...prev,
          updatedAt: Date.now(),
          activeSnapshot: nextSnap,
        };
      });

      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = window.setTimeout(() => {
        flushPendingCommit();
      }, HISTORY_DEBOUNCE_MS);
    },
    [flushPendingCommit],
  );

  /**
   * Commits a structural change directly into the HistoryTree without debounce.
   */
  const commitSnapshotImmediate = useCallback(
    (updater: (snap: BeatSnapshot) => BeatSnapshot, label: string) => {
      flushPendingCommit();
      setAbCompareActive(false);
      setProject((prev) => {
        const nextSnap = updater(prev.activeSnapshot);
        audioBridgeSingleton.updateSnapshot(nextSnap);
        const committed = commitSnapshot(
          prev.historyNodes,
          prev.activeHistoryNodeId,
          nextSnap,
          label,
        );
        const nextDoc: ProjectDocument = {
          ...prev,
          updatedAt: Date.now(),
          activeSnapshot: nextSnap,
          activeHistoryNodeId: committed.activeNodeId,
          historyNodes: committed.nodes,
        };
        void persistProject(nextDoc);
        return nextDoc;
      });
    },
    [flushPendingCommit, persistProject],
  );

  // Playback Controls
  const togglePlay = useCallback(async () => {
    try {
      if (audioBridgeSingleton.getIsPlaying()) {
        await audioBridgeSingleton.stop();
        setIsPlaying(false);
      } else {
        const activeSnap =
          abCompareActive && compareNodeId
            ? (jumpToHistoryNode(projectRef.current.historyNodes, compareNodeId) ??
              projectRef.current.activeSnapshot)
            : projectRef.current.activeSnapshot;
        await audioBridgeSingleton.start(activeSnap);
        setIsPlaying(true);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Audio konnte nicht gestartet werden.';
      showNotice(message);
    }
  }, [abCompareActive, compareNodeId, showNotice]);

  const restartFromBarOne = useCallback(async () => {
    try {
      await audioBridgeSingleton.resetAndPlay(projectRef.current.activeSnapshot);
      setIsPlaying(true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Audio-Neustart fehlgeschlagen.';
      showNotice(message);
    }
  }, [showNotice]);

  // Layer Mutations
  const updateLayerLive = useCallback(
    (
      layerId: string,
      updater: (layer: LayerConfig) => LayerConfig,
      label: string,
    ) => {
      updateSnapshotLive(
        (snap) => ({
          ...snap,
          layers: snap.layers.map((l) => (l.id === layerId ? updater(l) : l)),
        }),
        label,
      );
    },
    [updateSnapshotLive],
  );

  const commitLayerImmediate = useCallback(
    (
      layerId: string,
      updater: (layer: LayerConfig) => LayerConfig,
      label: string,
    ) => {
      commitSnapshotImmediate(
        (snap) => ({
          ...snap,
          layers: snap.layers.map((l) => (l.id === layerId ? updater(l) : l)),
        }),
        label,
      );
    },
    [commitSnapshotImmediate],
  );

  const addLayer = useCallback(
    (voiceModuleId: string) => {
      const voice = defaultRegistry.getVoice(voiceModuleId);
      const baseName = voice ? voice.displayName : 'Neuer Layer';
      const newLayer = createDefaultLayer(
        `${baseName} ${projectRef.current.activeSnapshot.layers.length + 1}`,
        voiceModuleId,
        4,
        'beats',
      );
      commitSnapshotImmediate(
        (snap) => ({
          ...snap,
          layers: [...snap.layers, newLayer],
        }),
        `Layer hinzugefügt: ${newLayer.name}`,
      );
      setSelectedLayerId(newLayer.id);
    },
    [commitSnapshotImmediate],
  );

  const duplicateLayer = useCallback(
    (layerId: string) => {
      const src = projectRef.current.activeSnapshot.layers.find(
        (l) => l.id === layerId,
      );
      if (!src) return;
      const newLayerId = nextUiId('layer');
      const cardIdMap = new Map<string, string>();
      const opIdMap = new Map<string, string>();

      const clonedOps = src.timeOperators.map((op) => {
        const nid = nextUiId('op');
        opIdMap.set(op.id, nid);
        return { ...op, id: nid, params: { ...op.params } };
      });
      const clonedChain = src.processorChain.map((card) => {
        const nid = nextUiId('card');
        cardIdMap.set(card.id, nid);
        return { ...card, id: nid, params: { ...card.params } };
      });
      const modIdMap = new Map<string, string>();
      src.modulations.forEach((m) => modIdMap.set(m.id, nextUiId('mod')));

      const clonedMods = src.modulations.map((m) => {
        let nextTargetCardId = m.targetCardId;
        if (m.targetDomain === 'processor') {
          nextTargetCardId = cardIdMap.get(m.targetCardId) ?? m.targetCardId;
        } else if (m.targetDomain === 'time') {
          nextTargetCardId = opIdMap.get(m.targetCardId) ?? m.targetCardId;
        } else if (m.targetDomain === 'modulation') {
          nextTargetCardId = modIdMap.get(m.targetCardId) ?? m.targetCardId;
        }
        return {
          ...m,
          id: modIdMap.get(m.id) ?? nextUiId('mod'),
          sourceConfig: {
            ...m.sourceConfig,
            sourceLayerId:
              m.sourceConfig.sourceLayerId === src.id
                ? newLayerId
                : m.sourceConfig.sourceLayerId,
          },
          targetCardId: nextTargetCardId,
        };
      });

      const cloned: LayerConfig = {
        ...src,
        id: newLayerId,
        name: `${src.name} (Kopie)`,
        voice: {
          ...src.voice,
          params: { ...src.voice.params },
        },
        timeOperators: clonedOps,
        processorChain: clonedChain,
        modulations: clonedMods,
      };

      commitSnapshotImmediate(
        (snap) => ({
          ...snap,
          layers: [...snap.layers, cloned],
        }),
        `Layer dupliziert: ${src.name}`,
      );
      setSelectedLayerId(newLayerId);
    },
    [commitSnapshotImmediate],
  );

  const deleteLayer = useCallback(
    (layerId: string) => {
      if (projectRef.current.activeSnapshot.layers.length <= 1) {
        showNotice('Mindestens ein Layer bleibt erhalten.');
        return;
      }
      const target = projectRef.current.activeSnapshot.layers.find(
        (l) => l.id === layerId,
      );
      commitSnapshotImmediate(
        (snap) => ({
          ...snap,
          layers: snap.layers.filter((l) => l.id !== layerId),
        }),
        `Layer gelöscht: ${target?.name ?? layerId}`,
      );
      if (activeModTarget?.layerId === layerId) {
        setActiveModTarget(null);
      }
    },
    [activeModTarget, commitSnapshotImmediate, showNotice],
  );

  const switchLayerVoice = useCallback(
    (layerId: string, nextVoiceModuleId: string) => {
      const mod = defaultRegistry.getVoice(nextVoiceModuleId);
      if (!mod) return;
      commitLayerImmediate(
        layerId,
        (layer) => ({
          ...layer,
          voice: {
            moduleId: mod.id,
            version: mod.version,
            params: buildDefaultParams(mod),
          },
        }),
        `Voice gewechselt: ${mod.displayName}`,
      );
    },
    [commitLayerImmediate],
  );

  const setLayerCycle = useCallback(
    (layerId: string, value: number, unit: CycleUnit) => {
      const safeVal = Math.max(0.25, Math.min(64, value));
      commitLayerImmediate(
        layerId,
        (layer) => ({
          ...layer,
          cycleLength: { value: safeVal, unit },
        }),
        `Zyklus: ${safeVal} ${unit === 'bars' ? 'Takte' : 'Beats'}`,
      );
    },
    [commitLayerImmediate],
  );

  // Processor Chain Drag & Drop / Reorder / Add / Remove / Bypass
  const reorderProcessorCards = useCallback(
    (layerId: string, fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;
      commitLayerImmediate(
        layerId,
        (layer) => {
          const next = [...layer.processorChain];
          if (
            fromIndex < 0 ||
            fromIndex >= next.length ||
            toIndex < 0 ||
            toIndex >= next.length
          ) {
            return layer;
          }
          const [moved] = next.splice(fromIndex, 1);
          if (!moved) return layer;
          next.splice(toIndex, 0, moved);
          return { ...layer, processorChain: next };
        },
        'Klangkarten-Reihenfolge geändert',
      );
    },
    [commitLayerImmediate],
  );

  const addProcessorCard = useCallback(
    (layerId: string, moduleId: string) => {
      const mod = defaultRegistry.getProcessor(moduleId);
      if (!mod) return;
      const newCard: ProcessorCardConfig = {
        id: nextUiId('card'),
        moduleId: mod.id,
        version: mod.version,
        bypassed: false,
        params: buildDefaultParams(mod),
      };
      commitLayerImmediate(
        layerId,
        (layer) => ({
          ...layer,
          processorChain: [...layer.processorChain, newCard],
        }),
        `Karte hinzugefügt: ${mod.displayName}`,
      );
    },
    [commitLayerImmediate],
  );

  const removeProcessorCard = useCallback(
    (layerId: string, cardId: string) => {
      commitLayerImmediate(
        layerId,
        (layer) => ({
          ...layer,
          processorChain: layer.processorChain.filter((c) => c.id !== cardId),
          modulations: layer.modulations.filter((m) => m.targetCardId !== cardId),
        }),
        'Klangkarte entfernt',
      );
      if (activeModTarget?.targetCardId === cardId) {
        setActiveModTarget(null);
      }
    },
    [activeModTarget, commitLayerImmediate],
  );

  const toggleProcessorBypass = useCallback(
    (layerId: string, cardId: string) => {
      commitLayerImmediate(
        layerId,
        (layer) => ({
          ...layer,
          processorChain: layer.processorChain.map((c) =>
            c.id === cardId ? { ...c, bypassed: !c.bypassed } : c,
          ),
        }),
        'Klangkarte Bypass umgeschaltet',
      );
    },
    [commitLayerImmediate],
  );

  // Modulation Routes CRUD
  const addModulationRoute = useCallback(
    (layerId: string, routeInput: Omit<ModulationRouteConfig, 'id'>) => {
      const route: ModulationRouteConfig = {
        ...routeInput,
        id: nextUiId('mod'),
      };
      commitLayerImmediate(
        layerId,
        (layer) => ({
          ...layer,
          modulations: [...layer.modulations, route],
        }),
        `Bewegung hinzugefügt (${route.targetParamId})`,
      );
      return route.id;
    },
    [commitLayerImmediate],
  );

  const updateModulationRouteLive = useCallback(
    (
      layerId: string,
      routeId: string,
      patch: Partial<ModulationRouteConfig>,
    ) => {
      updateLayerLive(
        layerId,
        (layer) => ({
          ...layer,
          modulations: layer.modulations.map((m) =>
            m.id === routeId ? { ...m, ...patch } : m,
          ),
        }),
        'Bewegungs-Tiefe angepasst',
      );
    },
    [updateLayerLive],
  );

  const commitModulationRoutePatch = useCallback(
    (
      layerId: string,
      routeId: string,
      patch: Partial<ModulationRouteConfig>,
    ) => {
      commitLayerImmediate(
        layerId,
        (layer) => ({
          ...layer,
          modulations: layer.modulations.map((m) =>
            m.id === routeId ? { ...m, ...patch } : m,
          ),
        }),
        'Modulations-Route geändert',
      );
    },
    [commitLayerImmediate],
  );

  const deleteModulationRoute = useCallback(
    (layerId: string, routeId: string) => {
      commitLayerImmediate(
        layerId,
        (layer) => ({
          ...layer,
          modulations: layer.modulations.filter(
            (m) =>
              m.id !== routeId &&
              !(m.targetDomain === 'modulation' && m.targetCardId === routeId),
          ),
        }),
        'Modulations-Route entfernt',
      );
    },
    [commitLayerImmediate],
  );

  // Drawn Curves CRUD
  const upsertCurveLive = useCallback(
    (curve: DrawnCurveData) => {
      updateSnapshotLive(
        (snap) => {
          const exists = snap.curves.some((c) => c.id === curve.id);
          return {
            ...snap,
            curves: exists
              ? snap.curves.map((c) => (c.id === curve.id ? curve : c))
              : [...snap.curves, curve],
          };
        },
        `Kurve bearbeitet: ${curve.name}`,
      );
    },
    [updateSnapshotLive],
  );

  const createCurve = useCallback(
    (preset?: DrawnCurveData) => {
      const base = preset ?? DEFAULT_CURVE_PRESETS[0]!;
      const newCurve: DrawnCurveData = {
        ...base,
        id: nextUiId('curve'),
        name: preset
          ? `${preset.name}`
          : `Kurve ${projectRef.current.activeSnapshot.curves.length + 1}`,
        points: base.points.map((pt) => ({ ...pt })),
      };
      commitSnapshotImmediate(
        (snap) => ({
          ...snap,
          curves: [...snap.curves, newCurve],
        }),
        `Neue Kurve: ${newCurve.name}`,
      );
      setSelectedCurveId(newCurve.id);
      return newCurve;
    },
    [commitSnapshotImmediate],
  );

  // Starter Presets
  const applyStarterPreset = useCallback(
    (presetKey: 'hypnotic-aminor' | 'triplet-riddle' | 'chord-offbeat-arp') => {
      flushPendingCommit();
      if (presetKey === 'hypnotic-aminor') {
        const doc = createHypnoticAMinorProject();
        commitSnapshotImmediate(
          () => doc.activeSnapshot,
          'Preset: Hypnotic A-Moll Club',
        );
        setSelectedLayerId(doc.activeSnapshot.layers[0]?.id ?? '');
        setSelectedCurveId(doc.activeSnapshot.curves[0]?.id ?? '');
        showNotice('Preset geladen: Hypnotic A-Moll Club');
      } else if (presetKey === 'triplet-riddle') {
        const snap = createTripletRiddlePreset();
        commitSnapshotImmediate(() => snap, 'Preset: Triolen-Rätsel');
        setSelectedLayerId(snap.layers[0]?.id ?? '');
        showNotice('Preset geladen: Triolen-Rätsel (3/5/7 Beats)');
      } else {
        const snap = createChordToOffbeatArpPreset();
        commitSnapshotImmediate(() => snap, 'Preset: Akkord → Offbeat Arp');
        setSelectedLayerId(snap.layers[1]?.id ?? snap.layers[0]?.id ?? '');
        setSelectedCurveId(snap.curves[0]?.id ?? '');
        showNotice('Preset geladen: Akkord → Offbeat Arp');
      }
      setActiveModTarget(null);
    },
    [commitSnapshotImmediate, flushPendingCommit, showNotice],
  );

  // History Tree Actions
  const jumpHistory = useCallback(
    (nodeId: string) => {
      flushPendingCommit();
      setAbCompareActive(false);
      setProject((prev) => {
        const snap = jumpToHistoryNode(prev.historyNodes, nodeId);
        if (!snap) return prev;
        audioBridgeSingleton.updateSnapshot(snap);
        const nextDoc: ProjectDocument = {
          ...prev,
          updatedAt: Date.now(),
          activeSnapshot: snap,
          activeHistoryNodeId: nodeId,
        };
        void persistProject(nextDoc);
        return nextDoc;
      });
    },
    [flushPendingCommit, persistProject],
  );

  const undo = useCallback(() => {
    flushPendingCommit();
    const targetId = stepUndo(
      projectRef.current.historyNodes,
      projectRef.current.activeHistoryNodeId,
    );
    if (!targetId) {
      showNotice('Bereits am Ursprungs-Knoten.');
      return;
    }
    jumpHistory(targetId);
  }, [flushPendingCommit, jumpHistory, showNotice]);

  const redo = useCallback(() => {
    flushPendingCommit();
    const targetId = stepRedoFirstChild(
      projectRef.current.historyNodes,
      projectRef.current.activeHistoryNodeId,
    );
    if (!targetId) {
      showNotice('Kein weiterer Vorwärts-Knoten auf diesem Ast.');
      return;
    }
    jumpHistory(targetId);
  }, [flushPendingCommit, jumpHistory, showNotice]);

  const toggleNodeBookmark = useCallback(
    (nodeId: string, bookmarkName?: string) => {
      setProject((prev) => {
        const nextNodes = toggleBookmark(prev.historyNodes, nodeId, bookmarkName);
        const nextDoc: ProjectDocument = {
          ...prev,
          updatedAt: Date.now(),
          historyNodes: nextNodes,
        };
        void persistProject(nextDoc);
        return nextDoc;
      });
    },
    [persistProject],
  );

  const toggleAbCompare = useCallback(
    (nodeId?: string) => {
      const targetId = nodeId ?? compareNodeId;
      if (!targetId) return;

      if (nodeId && nodeId !== compareNodeId) {
        setCompareNodeId(nodeId);
        const compareSnap = jumpToHistoryNode(
          projectRef.current.historyNodes,
          nodeId,
        );
        if (compareSnap) {
          audioBridgeSingleton.updateSnapshot(compareSnap);
          setAbCompareActive(true);
        }
        return;
      }

      if (abCompareActive) {
        audioBridgeSingleton.updateSnapshot(projectRef.current.activeSnapshot);
        setAbCompareActive(false);
      } else {
        const compareSnap = jumpToHistoryNode(
          projectRef.current.historyNodes,
          targetId,
        );
        if (compareSnap) {
          audioBridgeSingleton.updateSnapshot(compareSnap);
          setAbCompareActive(true);
        }
      }
    },
    [abCompareActive, compareNodeId],
  );

  const clearCompare = useCallback(() => {
    if (abCompareActive) {
      audioBridgeSingleton.updateSnapshot(projectRef.current.activeSnapshot);
    }
    setAbCompareActive(false);
    setCompareNodeId(null);
  }, [abCompareActive]);

  // Sections CRUD & Live Switching
  const triggerSectionSwitch = useCallback(
    (section: SectionItem) => {
      flushPendingCommit();
      setAbCompareActive(false);

      const applyLoadedSection = () => {
        setPendingSectionId(null);
        setProject((prev) => {
          const committed = commitSnapshot(
            prev.historyNodes,
            prev.activeHistoryNodeId,
            section.snapshot,
            `Section: ${section.name}`,
          );
          const nextDoc: ProjectDocument = {
            ...prev,
            updatedAt: Date.now(),
            activeSnapshot: section.snapshot,
            activeHistoryNodeId: committed.activeNodeId,
            historyNodes: committed.nodes,
          };
          void persistProject(nextDoc);
          return nextDoc;
        });
      };

      if (
        sectionSwitchMode === 'next-bar' &&
        audioBridgeSingleton.getIsPlaying()
      ) {
        setPendingSectionId(section.id);
        audioBridgeSingleton.scheduleSectionSwitchAtNextBar(
          section.snapshot,
          () => {
            applyLoadedSection();
          },
        );
        showNotice(`„${section.name}“ startet ab nächstem Takt`);
      } else {
        audioBridgeSingleton.updateSnapshot(section.snapshot);
        applyLoadedSection();
        showNotice(`Section aktiviert: ${section.name}`);
      }
    },
    [flushPendingCommit, persistProject, sectionSwitchMode, showNotice],
  );

  const saveNewSection = useCallback(
    (name: string, notes = '', exportBars = 8) => {
      flushPendingCommit();
      const idx = projectRef.current.sections.length;
      const newSec: SectionItem = {
        id: nextUiId('sec'),
        name: name.trim() || `Section_${idx + 1}`,
        notes,
        color: SECTION_COLORS[idx % SECTION_COLORS.length] ?? '#38bdf8',
        exportBars,
        snapshot: projectRef.current.activeSnapshot,
      };
      setProject((prev) => {
        const nextDoc: ProjectDocument = {
          ...prev,
          updatedAt: Date.now(),
          sections: [...prev.sections, newSec],
        };
        void persistProject(nextDoc);
        return nextDoc;
      });
      showNotice(`Section gespeichert: ${newSec.name}`);
    },
    [flushPendingCommit, persistProject, showNotice],
  );

  const duplicateSection = useCallback(
    (sectionId: string) => {
      const src = projectRef.current.sections.find((s) => s.id === sectionId);
      if (!src) return;
      const dup: SectionItem = {
        ...src,
        id: nextUiId('sec'),
        name: `${src.name}_Kopie`,
      };
      setProject((prev) => {
        const nextDoc: ProjectDocument = {
          ...prev,
          updatedAt: Date.now(),
          sections: [...prev.sections, dup],
        };
        void persistProject(nextDoc);
        return nextDoc;
      });
    },
    [persistProject],
  );

  const updateSectionMeta = useCallback(
    (
      sectionId: string,
      patch: Partial<Pick<SectionItem, 'name' | 'notes' | 'exportBars'>>,
    ) => {
      setProject((prev) => {
        const nextDoc: ProjectDocument = {
          ...prev,
          updatedAt: Date.now(),
          sections: prev.sections.map((s) =>
            s.id === sectionId ? { ...s, ...patch } : s,
          ),
        };
        void persistProject(nextDoc);
        return nextDoc;
      });
    },
    [persistProject],
  );

  const overwriteSectionWithCurrent = useCallback(
    (sectionId: string) => {
      flushPendingCommit();
      setProject((prev) => {
        const nextDoc: ProjectDocument = {
          ...prev,
          updatedAt: Date.now(),
          sections: prev.sections.map((s) =>
            s.id === sectionId ? { ...s, snapshot: prev.activeSnapshot } : s,
          ),
        };
        void persistProject(nextDoc);
        return nextDoc;
      });
      showNotice('Section mit aktuellem Stand aktualisiert.');
    },
    [flushPendingCommit, persistProject, showNotice],
  );

  const deleteSection = useCallback(
    (sectionId: string) => {
      setProject((prev) => {
        const nextDoc: ProjectDocument = {
          ...prev,
          updatedAt: Date.now(),
          sections: prev.sections.filter((s) => s.id !== sectionId),
        };
        void persistProject(nextDoc);
        return nextDoc;
      });
    },
    [persistProject],
  );

  // Storage & Folder Connection
  const connectProjectFolder = useCallback(async () => {
    if (!fsAdapterSingleton.isSupported()) {
      showNotice(
        'Ordner-Zugriff (File System Access API) wird in diesem Browser nicht unterstützt — IndexedDB-Autosave bleibt aktiv.',
      );
      return;
    }
    try {
      const handle = await fsAdapterSingleton.pickRootDirectory();
      setFsConnected(true);
      setFsFolderName(handle.name);
      await fsAdapterSingleton.saveProject(projectRef.current);
      await refreshSavedProjects();
      showNotice(`Projekt-Ordner verbunden: ${handle.name}`);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      showNotice(
        err instanceof Error
          ? err.message
          : 'Ordner konnte nicht verbunden werden.',
      );
    }
  }, [refreshSavedProjects, showNotice]);

  const saveCurrentProjectExplicit = useCallback(
    async (newName?: string) => {
      flushPendingCommit();
      const updatedDoc: ProjectDocument = {
        ...projectRef.current,
        name: newName?.trim() || projectRef.current.name,
        updatedAt: Date.now(),
      };
      setProject(updatedDoc);
      await persistProject(updatedDoc);
      await refreshSavedProjects();
      showNotice(`Projekt gespeichert: ${updatedDoc.name}`);
    },
    [flushPendingCommit, persistProject, refreshSavedProjects, showNotice],
  );

  const createNewProject = useCallback(
    async (name: string) => {
      flushPendingCommit();
      const base = createHypnoticAMinorProject();
      const initialHistory = createInitialHistory(
        base.activeSnapshot,
        'Neues Projekt Start',
      );
      const doc: ProjectDocument = {
        ...base,
        id: nextUiId('proj'),
        name: name.trim() || 'Neues_Techno_Projekt',
        updatedAt: Date.now(),
        activeHistoryNodeId: initialHistory.activeNodeId,
        historyNodes: initialHistory.nodes,
      };
      setProject(doc);
      setSelectedLayerId(doc.activeSnapshot.layers[0]?.id ?? '');
      setSelectedCurveId(doc.activeSnapshot.curves[0]?.id ?? '');
      audioBridgeSingleton.updateSnapshot(doc.activeSnapshot);
      await persistProject(doc);
      await refreshSavedProjects();
      showNotice(`Neues Projekt angelegt: ${doc.name}`);
    },
    [flushPendingCommit, persistProject, refreshSavedProjects, showNotice],
  );

  const loadProjectById = useCallback(
    async (projectIdOrName: string) => {
      flushPendingCommit();
      try {
        const loaded = fsAdapterSingleton.hasRootDirectory()
          ? ((await fsAdapterSingleton.loadProject(projectIdOrName)) ??
            (await idbAdapterSingleton.loadProject(projectIdOrName)))
          : await idbAdapterSingleton.loadProject(projectIdOrName);
        if (!loaded) {
          showNotice('Projekt konnte nicht geladen werden.');
          return;
        }
        setProject(loaded);
        setSelectedLayerId(loaded.activeSnapshot.layers[0]?.id ?? '');
        setSelectedCurveId(loaded.activeSnapshot.curves[0]?.id ?? '');
        setActiveModTarget(null);
        setCompareNodeId(null);
        setAbCompareActive(false);
        audioBridgeSingleton.updateSnapshot(loaded.activeSnapshot);
        showNotice(`Projekt geladen: ${loaded.name}`);
      } catch (err) {
        showNotice(
          err instanceof Error ? err.message : 'Fehler beim Laden des Projekts.',
        );
      }
    },
    [flushPendingCommit, showNotice],
  );

  const selectedLayer = useMemo(
    () =>
      project.activeSnapshot.layers.find((l) => l.id === selectedLayerId) ??
      project.activeSnapshot.layers[0],
    [project.activeSnapshot.layers, selectedLayerId],
  );

  const canUndo = useMemo(
    () =>
      stepUndo(project.historyNodes, project.activeHistoryNodeId) !== null,
    [project.activeHistoryNodeId, project.historyNodes],
  );

  const canRedo = useMemo(
    () =>
      stepRedoFirstChild(project.historyNodes, project.activeHistoryNodeId) !==
      null,
    [project.activeHistoryNodeId, project.historyNodes],
  );

  return {
    project,
    snapshot: project.activeSnapshot,
    selectedLayer,
    selectedLayerId: selectedLayer?.id ?? '',
    setSelectedLayerId,
    selectedCurveId,
    setSelectedCurveId,
    activeModTarget,
    setActiveModTarget,
    compareNodeId,
    abCompareActive,
    toggleAbCompare,
    clearCompare,
    hoveredModSourceId,
    setHoveredModSourceId,
    sectionSwitchMode,
    setSectionSwitchMode,
    pendingSectionId,
    subscribeTelemetry,
    getTelemetry,
    isPlaying,
    fsConnected,
    fsFolderName,
    fsSupported: fsAdapterSingleton.isSupported(),
    savedProjects,
    statusNotice,
    showNotice,
    fsAdapter: fsAdapterSingleton,
    idbAdapter: idbAdapterSingleton,
    togglePlay,
    restartFromBarOne,
    updateSnapshotLive,
    commitSnapshotImmediate,
    updateLayerLive,
    commitLayerImmediate,
    addLayer,
    duplicateLayer,
    deleteLayer,
    switchLayerVoice,
    setLayerCycle,
    reorderProcessorCards,
    addProcessorCard,
    removeProcessorCard,
    toggleProcessorBypass,
    addModulationRoute,
    updateModulationRouteLive,
    commitModulationRoutePatch,
    deleteModulationRoute,
    upsertCurveLive,
    createCurve,
    applyStarterPreset,
    jumpHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    toggleNodeBookmark,
    triggerSectionSwitch,
    saveNewSection,
    duplicateSection,
    updateSectionMeta,
    overwriteSectionWithCurrent,
    deleteSection,
    connectProjectFolder,
    saveCurrentProjectExplicit,
    createNewProject,
    loadProjectById,
    refreshSavedProjects,
  };
}

export type StudioStore = ReturnType<typeof useStudioStore>;
