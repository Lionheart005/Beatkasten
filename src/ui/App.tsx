import { useEffect, useState } from 'react';
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

export function App() {
  const store = useStudioStore();
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isHarmonyBuilderOpen, setIsHarmonyBuilderOpen] = useState(false);

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

      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        store.undo();
      } else if (
        e.key.toLowerCase() === 'y' ||
        (e.key.toLowerCase() === 'z' && e.shiftKey)
      ) {
        e.preventDefault();
        store.redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [store]);

  const selectedLayerIndex = store.snapshot.layers.findIndex(
    (l) => l.id === store.selectedLayerId,
  );

  return (
    <div className="studio-shell">
      <TransportBar
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

      {/* Visual Center: Phase Radar + Layer Wave Preview */}
      <section className="visual-center">
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
      <main className="studio-workspace">
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
          onDeleteSection={store.deleteSection}
          onUndo={store.undo}
          onRedo={store.redo}
          onJumpHistory={store.jumpHistory}
          onToggleBookmark={(id) => store.toggleNodeBookmark(id)}
          onToggleAbCompare={store.toggleAbCompare}
          onClearCompare={store.clearCompare}
        />
      </main>

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

      {store.statusNotice && (
        <div className="status-toast">{store.statusNotice}</div>
      )}
    </div>
  );
}
