import { useCallback, useEffect, useRef, useState } from 'react';
import { loadLayoutPref, saveLayoutPref, Splitter } from './components/Splitter';
import { ExportModal } from './components/ExportModal';
import { PhaseRadarCanvas } from './components/PhaseRadarCanvas';
import { ProjectModal } from './components/ProjectModal';
import { TimePreviewCanvas } from './components/TimePreviewCanvas';
import { HarmonyBuilderPanel } from './panels/HarmonyBuilderPanel';
import { LayerInspector } from './panels/LayerInspector';
import { LayerStackPanel } from './panels/LayerStackPanel';
import { SectionsAndHistoryPanel } from './panels/SectionsAndHistoryPanel';
import { TransportBar } from './panels/TransportBar';
import { useStudioStore } from './store/useStudioStore';
import type { Workspace } from './components/WorkspaceSwitch';
import { TimelineWorkspace } from './timeline/TimelineWorkspace';
import { useArrangementStore } from './timeline/useArrangementStore';
import { TransitionPalette } from './timeline/TransitionPalette';
import { useAudioPool } from './audio/useAudioPool';
import { useTimelineAudio } from './timeline/useTimelineAudio';
import { RecordControls } from './timeline/RecordControls';
import { SampleEditor, SampleSection } from './components/SampleEditor';
import { referencedSectionIds } from '../core/arrangement/edit';

export function App() {
  const store = useStudioStore();
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isHarmonyBuilderOpen, setIsHarmonyBuilderOpen] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace>(() =>
    loadLayoutPref('workspace', { w: 'beat' }).w === 'timeline' ? 'timeline' : 'beat',
  );
  const arr = useArrangementStore(store, workspace === 'timeline');
  const pool = useAudioPool(store);
  const [sampleEditorLayerId, setSampleEditorLayerId] = useState<string | null>(null);
  const sampleEditorLayer = sampleEditorLayerId
    ? store.snapshot.layers.find((l) => l.id === sampleEditorLayerId) ?? null
    : null;
  const tlAudio = useTimelineAudio(store, arr, pool);

  const switchWorkspace = useCallback(
    async (w: Workspace) => {
      if (w === workspace) return;
      // Only one workspace plays at a time: switching stops playback.
      await store.audioBridge.setMode(w === 'timeline' ? 'arrangement' : 'beat');
      setWorkspace(w);
      saveLayoutPref('workspace', { w });
    },
    [store.audioBridge, workspace],
  );

  const openSectionInBeatkasten = useCallback(
    (sectionId: string) => {
      const sec = store.project.sections.find((s) => s.id === sectionId);
      if (!sec) return;
      void switchWorkspace('beat').then(() => store.triggerSectionSwitch(sec));
    },
    [store, switchWorkspace],
  );

  // Fenstergrößen (per Maus ziehbar, im Browser gespeichert)
  const DEFAULT_LAYOUT = { left: 290, right: 320, visual: 0 };
  const [layout, setLayout] = useState<{ left: number; right: number; visual: number }>(() => {
    const v = loadLayoutPref('main', DEFAULT_LAYOUT);
    return {
      left: Number.isFinite(v.left) ? v.left : DEFAULT_LAYOUT.left,
      right: Number.isFinite(v.right) ? v.right : DEFAULT_LAYOUT.right,
      visual: Number.isFinite(v.visual) ? v.visual : 0,
    };
  });
  const layoutStart = useRef(layout);
  const visualRef = useRef<HTMLElement | null>(null);
  const updateLayout = useCallback((patch: Partial<typeof layout>) => {
    setLayout((prev) => {
      const next = { ...prev, ...patch };
      saveLayoutPref('main', next);
      return next;
    });
  }, []);
  const beginLayoutDrag = useCallback(() => {
    setLayout((prev) => {
      // visual = 0 heißt „automatische Höhe“ → beim ersten Ziehen echte Höhe übernehmen
      const measured = visualRef.current?.getBoundingClientRect().height ?? 150;
      layoutStart.current = { ...prev, visual: prev.visual > 0 ? prev.visual : measured };
      return prev;
    });
  }, []);

  // Global keyboard shortcuts: Ctrl+Z (Undo), Ctrl+Y / Ctrl+Shift+Z (Redo)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable =
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (isEditable && (target as HTMLInputElement).type !== 'range') {
        return;
      }

      const modKey = e.ctrlKey || e.metaKey;
      if (!modKey) return;

      // Undo always acts in the active workspace.
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (workspace === 'timeline') arr.undo();
        else store.undo();
      } else if (
        e.key.toLowerCase() === 'y' ||
        (e.key.toLowerCase() === 'z' && e.shiftKey)
      ) {
        e.preventDefault();
        if (workspace === 'timeline') arr.redo();
        else store.redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [store, arr, workspace]);

  const deleteSectionGuarded = useCallback(
    (sectionId: string) => {
      const used = store.project.arrangement && referencedSectionIds(store.project.arrangement).has(sectionId);
      if (used && !window.confirm('Dieser Abschnitt wird in der Timeline benutzt. Trotzdem löschen? (Die Clips bleiben stumm stehen.)')) return;
      store.deleteSection(sectionId);
    },
    [store],
  );

  const selectedLayerIndex = store.snapshot.layers.findIndex(
    (l) => l.id === store.selectedLayerId,
  );

  return (
    <div className="studio-shell">
      <TransportBar
        workspace={workspace}
        onSwitchWorkspace={(w) => void switchWorkspace(w)}
        projectName={store.project.name}
        snapshot={store.snapshot}
        isPlaying={store.isPlaying}
        subscribeTelemetry={store.subscribeTelemetry}
        getTelemetry={store.getTelemetry}
        fsConnected={store.fsConnected}
        fsFolderName={store.fsFolderName}
        pendingFolderName={store.pendingFolderName}
        saveState={store.saveState}
        harmonyBuilderOpen={isHarmonyBuilderOpen}
        onToggleHarmonyBuilder={() => setIsHarmonyBuilderOpen((v) => !v)}
        onTogglePlay={() => void store.togglePlay()}
        onRestart={() => void store.restartFromBarOne()}
        onUpdateSnapshotLive={store.updateSnapshotLive}
        onCommitSnapshotImmediate={store.commitSnapshotImmediate}
        onApplyPreset={store.applyStarterPreset}
        onConnectFolder={() => void store.connectProjectFolder()}
        onOpenProjectModal={() => setIsProjectModalOpen(true)}
        onOpenExportModal={() => setIsExportOpen(true)}
      />

      {workspace === 'timeline' && (
        <TimelineWorkspace
          studio={store}
          arr={arr}
          onOpenInBeatkasten={openSectionInBeatkasten}
          transitionPalette={<TransitionPalette arr={arr} studio={store} />}
          audioPool={tlAudio.audioPoolNode}
          recordControls={<RecordControls studio={store} arr={arr} pool={pool} />}
          renderWaveform={tlAudio.renderWaveform}
          onDropAsset={tlAudio.onDropAsset}
          onDropFiles={(files, trackId, beat) => void tlAudio.onDropFiles(files, trackId, beat)}
          clipActions={tlAudio.clipActions}
          selectionActions={tlAudio.selectionActions}
          onFreezeTrack={(id) => void tlAudio.freezeTrack(id)}
        />
      )}

      {workspace === 'beat' && (
      <>
      {/* Visual Center: Phase Radar + Layer Wave Preview */}
      <section
        className="visual-center"
        ref={visualRef}
        style={layout.visual > 0 ? { height: layout.visual, overflow: 'hidden' } : undefined}
      >
        <PhaseRadarCanvas
          layers={store.snapshot.layers}
          beatsPerBar={store.snapshot.timeSignature.numerator}
          selectedLayerId={store.selectedLayerId}
          subscribeTelemetry={store.subscribeTelemetry}
          getTelemetry={store.getTelemetry}
          isPlaying={store.isPlaying}
          onSelectLayer={store.setSelectedLayerId}
        />
        <div className="visual-card">
          {store.selectedLayer ? (
            <TimePreviewCanvas
              layer={store.selectedLayer}
              beatsPerBar={store.snapshot.timeSignature.numerator}
              layerIndex={selectedLayerIndex >= 0 ? selectedLayerIndex : 0}
              height={84}
              showHeader
              isPlaying={store.isPlaying}
              subscribeTelemetry={store.subscribeTelemetry}
              getTelemetry={store.getTelemetry}
            />
          ) : (
            <div className="muted-note">
              Kein Layer ausgewählt — wähle links einen Layer für die Wellenfunktion.
            </div>
          )}
        </div>
      </section>

      <Splitter
        direction="row"
        title="Ziehen = obere Anzeige größer/kleiner · Doppelklick = automatische Höhe"
        onDragStart={beginLayoutDrag}
        onDrag={(d) =>
          updateLayout({ visual: Math.max(36, Math.min(420, layoutStart.current.visual + d)) })
        }
        onReset={() => updateLayout({ visual: 0 })}
      />

      {isHarmonyBuilderOpen && (
        <HarmonyBuilderPanel
          snapshot={store.snapshot}
          isPlaying={store.isPlaying}
          subscribeTelemetry={store.subscribeTelemetry}
          onCommitSnapshotImmediate={store.commitSnapshotImmediate}
          onClose={() => setIsHarmonyBuilderOpen(false)}
        />
      )}

      {/* Main 3-Area Workspace */}
      <main
        className="studio-workspace is-resizable"
        style={{
          gridTemplateColumns: `${layout.left}px 10px minmax(0, 1fr) 10px ${layout.right}px`,
        }}
      >
        <LayerStackPanel
          layers={store.snapshot.layers}
          selectedLayerId={store.selectedLayerId}
          activeModTarget={store.activeModTarget}
          hoveredModSourceId={store.hoveredModSourceId}
          onSelectLayer={store.setSelectedLayerId}
          onOpenModTarget={store.setActiveModTarget}
          onAddLayer={store.addLayer}
          onDuplicateLayer={store.duplicateLayer}
          onDeleteLayer={store.deleteLayer}
          onUpdateLayerLive={store.updateLayerLive}
          onCommitLayerImmediate={store.commitLayerImmediate}
          onMoveLayer={store.moveLayer}
          onSetLayerGroup={store.setLayerGroup}
          onRenameGroup={store.renameLayerGroup}
          onToggleGroupFlag={store.toggleGroupFlag}
        />

        <Splitter
          direction="col"
          title="Ziehen = Layer-Liste breiter/schmaler · Doppelklick = Standard"
          onDragStart={beginLayoutDrag}
          onDrag={(d) =>
            updateLayout({ left: Math.max(200, Math.min(620, layoutStart.current.left + d)) })
          }
          onReset={() => updateLayout({ left: DEFAULT_LAYOUT.left })}
        />

        <LayerInspector
          layer={store.selectedLayer}
          allLayers={store.snapshot.layers}
          curves={store.snapshot.curves}
          selectedCurveId={store.selectedCurveId}
          activeModTarget={store.activeModTarget}
          hoveredModSourceId={store.hoveredModSourceId}
          onSelectCurve={store.setSelectedCurveId}
          onSetActiveModTarget={store.setActiveModTarget}
          onHoverModSource={store.setHoveredModSourceId}
          onSwitchVoice={store.switchLayerVoice}
          onSetLayerCycle={store.setLayerCycle}
          onUpdateLayerLive={store.updateLayerLive}
          onCommitLayerImmediate={store.commitLayerImmediate}
          onReorderProcessorCards={store.reorderProcessorCards}
          onAddProcessorCard={store.addProcessorCard}
          onRemoveProcessorCard={store.removeProcessorCard}
          onToggleProcessorBypass={store.toggleProcessorBypass}
          onAddModulationRoute={store.addModulationRoute}
          onUpdateModulationRouteLive={store.updateModulationRouteLive}
          onCommitModulationRoutePatch={store.commitModulationRoutePatch}
          onDeleteModulationRoute={store.deleteModulationRoute}
          onUpsertCurveLive={store.upsertCurveLive}
          onCreateCurve={store.createCurve}
          renderSampleSection={(layer) => (
            <SampleSection layer={layer} pool={pool} onOpen={() => setSampleEditorLayerId(layer.id)} />
          )}
        />

        <Splitter
          direction="col"
          title="Ziehen = Abschnitte/History breiter/schmaler · Doppelklick = Standard"
          onDragStart={beginLayoutDrag}
          onDrag={(d) =>
            updateLayout({ right: Math.max(220, Math.min(640, layoutStart.current.right - d)) })
          }
          onReset={() => updateLayout({ right: DEFAULT_LAYOUT.right })}
        />

        <SectionsAndHistoryPanel
          sections={store.project.sections}
          sectionSwitchMode={store.sectionSwitchMode}
          pendingSectionId={store.pendingSectionId}
          activeSectionId={store.activeSectionId}
          autoSyncSection={store.autoSyncSection}
          onSetAutoSyncSection={store.setAutoSyncSection}
          onMoveSection={store.moveSection}
          onCopyLayerFromSection={store.copyLayerFromSection}
          historyNodes={store.project.historyNodes}
          activeHistoryNodeId={store.project.activeHistoryNodeId}
          compareNodeId={store.compareNodeId}
          abCompareActive={store.abCompareActive}
          canUndo={store.canUndo}
          canRedo={store.canRedo}
          onSetSectionSwitchMode={store.setSectionSwitchMode}
          onTriggerSection={store.triggerSectionSwitch}
          onSaveNewSection={store.saveNewSection}
          onDuplicateSection={store.duplicateSection}
          onOverwriteSection={store.overwriteSectionWithCurrent}
          onUpdateSectionMeta={store.updateSectionMeta}
          onDeleteSection={deleteSectionGuarded}
          onUndo={store.undo}
          onRedo={store.redo}
          onJumpHistory={store.jumpHistory}
          onToggleBookmark={(id) => store.toggleNodeBookmark(id)}
          onToggleAbCompare={store.toggleAbCompare}
          onClearCompare={store.clearCompare}
        />
      </main>
      </>
      )}

      <ExportModal
        isOpen={isExportOpen}
        projectName={store.project.name}
        snapshot={store.snapshot}
        fsConnected={store.fsConnected}
        fsAdapter={store.fsAdapter}
        sections={store.project.sections}
        isPlaying={store.isPlaying}
        onStopPlayback={async () => {
          if (store.isPlaying) await store.togglePlay();
        }}
        onClose={() => setIsExportOpen(false)}
        onNotice={store.showNotice}
        arrangement={store.project.arrangement ?? null}
        getArrangementAssets={tlAudio.getExportAssets}
        preferTimeline={workspace === 'timeline'}
      />

      <ProjectModal
        isOpen={isProjectModalOpen}
        currentProjectId={store.project.id}
        currentProjectName={store.project.name}
        savedProjects={store.savedProjects}
        fsConnected={store.fsConnected}
        fsFolderName={store.fsFolderName}
        pendingFolderName={store.pendingFolderName}
        saveState={store.saveState}
        onRefresh={store.refreshSavedProjects}
        onSaveAs={store.saveCurrentProjectExplicit}
        onSaveCopy={store.saveProjectCopy}
        onCreateNew={store.createNewProject}
        onLoadProject={store.loadProjectById}
        onConnectFolder={store.connectProjectFolder}
        onPickOtherFolder={store.pickOtherProjectFolder}
        onClose={() => setIsProjectModalOpen(false)}
      />

      {sampleEditorLayer && (
        <SampleEditor
          layer={sampleEditorLayer}
          pool={pool}
          studio={store}
          onApply={(cfg) => {
            store.commitLayerImmediate(sampleEditorLayer.id, (l) => ({ ...l, sample: cfg }), 'Sample gewählt');
            setSampleEditorLayerId(null);
          }}
          onClose={() => setSampleEditorLayerId(null)}
        />
      )}

      {store.statusNotice && (
        <div className="status-toast">{store.statusNotice}</div>
      )}
    </div>
  );
}
