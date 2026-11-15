import { useEffect, useState } from 'react';
import { FolderOpen, Plus, Save, X } from 'lucide-react';
import type { ProjectSummary } from '../../storage';

interface ProjectModalProps {
  isOpen: boolean;
  currentProjectName: string;
  savedProjects: readonly ProjectSummary[];
  fsConnected: boolean;
  fsFolderName: string | null;
  onRefresh: () => Promise<void>;
  onSaveAs: (name: string) => Promise<void>;
  onCreateNew: (name: string) => Promise<void>;
  onLoadProject: (idOrName: string) => Promise<void>;
  onClose: () => void;
}

export function ProjectModal({
  isOpen,
  currentProjectName,
  savedProjects,
  fsConnected,
  fsFolderName,
  onRefresh,
  onSaveAs,
  onCreateNew,
  onLoadProject,
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
          <div className="muted-note">
            Speicherort:{' '}
            {fsConnected
              ? `Lokaler Ordner „${fsFolderName}“ + IndexedDB-Autosave`
              : 'Browser IndexedDB-Autosave (optional lokalen Ordner verbinden)'}
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Projektname"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn-primary"
              onClick={async () => {
                await onSaveAs(nameInput);
              }}
            >
              <Save size={13} /> Speichern
            </button>
            <button
              type="button"
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
              savedProjects.map((item) => (
                <div
                  key={item.id}
                  className="sub-card"
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 12.5 }}>
                      {item.name}
                    </div>
                    <div className="muted-note">
                      {new Date(item.updatedAt).toLocaleString('de-DE')}
                    </div>
                  </div>
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
                </div>
              ))
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
