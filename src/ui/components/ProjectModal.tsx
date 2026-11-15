import { useEffect, useState } from 'react';
import { Check, Copy, FolderOpen, FolderPlus, Plus, Save, X } from 'lucide-react';
import type { ProjectSummary } from '../../storage';
import type { SaveState } from '../store/useStudioStore';

interface ProjectModalProps {
  isOpen: boolean;
  currentProjectId: string;
  currentProjectName: string;
  savedProjects: readonly ProjectSummary[];
  fsConnected: boolean;
  fsFolderName: string | null;
  pendingFolderName: string | null;
  saveState: SaveState;
  onRefresh: () => Promise<void>;
  onSaveAs: (name: string) => Promise<void>;
  onSaveCopy: (name: string) => Promise<void>;
  onCreateNew: (name: string) => Promise<void>;
  onLoadProject: (idOrName: string) => Promise<void>;
  onConnectFolder: () => Promise<void>;
  onPickOtherFolder: () => Promise<void>;
  onClose: () => void;
}

export function formatSaveTime(at: number | null): string {
  if (at === null) return '';
  return new Date(at).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function ProjectModal({
  isOpen,
  currentProjectId,
  currentProjectName,
  savedProjects,
  fsConnected,
  fsFolderName,
  pendingFolderName,
  saveState,
  onRefresh,
  onSaveAs,
  onSaveCopy,
  onCreateNew,
  onLoadProject,
  onConnectFolder,
  onPickOtherFolder,
  onClose,
}: ProjectModalProps) {
  const [nameInput, setNameInput] = useState(currentProjectName);

  useEffect(() => {
    if (isOpen) {
      setNameInput(currentProjectName);
      void onRefresh();
    }
  }, [currentProjectName, isOpen, onRefresh]);

  if (!isOpen) return null;

  const trimmed = nameInput.trim();
  const isRename = trimmed.length > 0 && trimmed !== currentProjectName;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Projekt verwalten</span>
          <button type="button" className="btn-ghost" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          {/* Where is my project? */}
          <div className="save-location-card">
            <div style={{ fontWeight: 600, fontSize: 12.5 }}>Speicherort</div>
            {fsConnected ? (
              <>
                <div className="muted-note">
                  Verbundener Projekte-Ordner: <b>„{fsFolderName}“</b>. Jedes Projekt bekommt
                  darin einen eigenen Unterordner (mit Sections, Kurven &amp; Exports).
                </div>
                <div>
                  <button type="button" className="btn-sm" onClick={() => void onPickOtherFolder()}>
                    <FolderPlus size={12} /> Anderen Ordner wählen
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="muted-note">
                  Noch kein Ordner verbunden. Projekte werden automatisch im Browser gespeichert
                  (bleiben erhalten, sind aber keine Dateien). Wähle einen Ordner, z. B. „Techno
                  Projekte“: Dort entsteht pro Projekt ein Unterordner, es wird kein weiterer
                  Zwischenordner angelegt.
                </div>
                <div>
                  <button type="button" className="btn-primary btn-sm" onClick={() => void onConnectFolder()}>
                    <FolderPlus size={12} />{' '}
                    {pendingFolderName
                      ? `Ordner „${pendingFolderName}“ wieder verbinden`
                      : 'Projekte-Ordner verbinden'}
                  </button>
                </div>
              </>
            )}
            <div className={`save-status-line is-${saveState.status}`}>
              {saveState.status === 'saved' && (
                <>
                  <Check size={12} /> Automatisch gespeichert um {formatSaveTime(saveState.at)} ·{' '}
                  {saveState.location}
                </>
              )}
              {saveState.status === 'saving' && <>Speichert …</>}
              {saveState.status === 'error' && <>Speichern fehlgeschlagen: {saveState.location}</>}
              {saveState.status === 'idle' && (
                <>Änderungen werden automatisch gespeichert – manuelles Speichern ist nicht nötig.</>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Projektname"
              style={{ flex: 1, minWidth: 160 }}
            />
            <button
              type="button"
              className="btn-primary"
              title={
                isRename
                  ? 'Benennt dieses Projekt um (der Ordner wird mit umbenannt, keine Kopie)'
                  : 'Sofort speichern'
              }
              onClick={async () => {
                await onSaveAs(nameInput);
              }}
            >
              <Save size={13} /> {isRename ? 'Umbenennen' : 'Jetzt speichern'}
            </button>
            <button
              type="button"
              title="Speichert eine unabhängige Kopie unter dem eingegebenen Namen und öffnet sie"
              disabled={!isRename}
              onClick={async () => {
                await onSaveCopy(nameInput);
              }}
            >
              <Copy size={13} /> Als Kopie
            </button>
            <button
              type="button"
              title="Leeres Starter-Projekt mit diesem Namen anlegen"
              onClick={async () => {
                await onCreateNew(nameInput);
                onClose();
              }}
            >
              <Plus size={13} /> Neu
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>
              Gespeicherte Projekte ({savedProjects.length})
            </span>
            {savedProjects.length === 0 ? (
              <div className="muted-note">Noch keine Projekte gefunden.</div>
            ) : (
              savedProjects.map((item) => {
                const isCurrent = item.id === currentProjectId;
                return (
                  <div
                    key={item.id}
                    className={`sub-card${isCurrent ? ' is-current-project' : ''}`}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12.5 }}>
                        {item.name} {isCurrent && <span className="badge-current">geöffnet</span>}
                      </div>
                      <div className="muted-note">
                        zuletzt gespeichert {new Date(item.updatedAt).toLocaleString('de-DE')}
                      </div>
                    </div>
                    {!isCurrent && (
                      <button
                        type="button"
                        className="btn-sm"
                        onClick={async () => {
                          await onLoadProject(item.id);
                          onClose();
                        }}
                      >
                        <FolderOpen size={12} /> Öffnen
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
