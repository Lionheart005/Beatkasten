import type { DrawnCurveData } from '../core/math/curves';
import type { ProjectDocument } from '../core/state/types';
import {
  sanitizeStorageName,
  type ProjectStorageAdapter,
  type ProjectSummary,
} from './ProjectStorageAdapter';

const DB_NAME = 'techno-sound-generator-db';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_EXPORTS = 'exports';
const STORE_CURVES = 'curves';

interface ExportRecord {
  readonly key: string;
  readonly projectName: string;
  readonly fileName: string;
  readonly subFolder?: string;
  readonly bytes: Uint8Array;
  readonly savedAt: number;
}

interface CurveRecord {
  readonly key: string;
  readonly projectName: string;
  readonly curve: DrawnCurveData;
  readonly savedAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB ist in dieser Umgebung nicht verfügbar.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_EXPORTS)) {
        db.createObjectStore(STORE_EXPORTS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_CURVES)) {
        db.createObjectStore(STORE_CURVES, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB konnte nicht geöffnet werden.'));
  });
}

function runTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const req = action(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () =>
          reject(req.error ?? new Error(`IndexedDB-Fehler in Store "${storeName}".`));
        tx.oncomplete = () => db.close();
        tx.onerror = () => db.close();
      }),
  );
}

/**
 * Browser IndexedDB storage adapter for reliable autosave and offline persistence.
 */
export class IndexedDbAdapter implements ProjectStorageAdapter {
  readonly kind = 'indexeddb' as const;

  isSupported(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const all = await runTransaction<ProjectDocument[]>(
      STORE_PROJECTS,
      'readonly',
      (store) => store.getAll() as IDBRequest<ProjectDocument[]>,
    );

    return all
      .map((doc) => ({
        id: doc.id,
        name: doc.name,
        updatedAt: doc.updatedAt,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async loadProject(projectIdOrName: string): Promise<ProjectDocument | null> {
    const byId = await runTransaction<ProjectDocument | undefined>(
      STORE_PROJECTS,
      'readonly',
      (store) => store.get(projectIdOrName) as IDBRequest<ProjectDocument | undefined>,
    );
    if (byId) return byId;

    const all = await runTransaction<ProjectDocument[]>(
      STORE_PROJECTS,
      'readonly',
      (store) => store.getAll() as IDBRequest<ProjectDocument[]>,
    );
    return (
      all.find(
        (doc) =>
          doc.name === projectIdOrName ||
          sanitizeStorageName(doc.name) === sanitizeStorageName(projectIdOrName),
      ) ?? null
    );
  }

  async saveProject(project: ProjectDocument): Promise<void> {
    const record: ProjectDocument = {
      ...project,
      updatedAt: Date.now(),
    };
    await runTransaction(STORE_PROJECTS, 'readwrite', (store) => store.put(record));
  }

  async saveExportedAudio(
    projectName: string,
    fileName: string,
    bytes: Uint8Array,
    subFolder?: string,
  ): Promise<void> {
    const safeProject = sanitizeStorageName(projectName);
    const safeSub = subFolder ? sanitizeStorageName(subFolder) : '';
    const safeFile = sanitizeStorageName(fileName);
    const key = safeSub
      ? `${safeProject}/exports/${safeSub}/${safeFile}`
      : `${safeProject}/exports/${safeFile}`;

    const record: ExportRecord = {
      key,
      projectName: safeProject,
      fileName: safeFile,
      subFolder: subFolder ? safeSub : undefined,
      bytes,
      savedAt: Date.now(),
    };
    await runTransaction(STORE_EXPORTS, 'readwrite', (store) => store.put(record));
  }

  async saveCurvePreset(projectName: string, curve: DrawnCurveData): Promise<void> {
    const safeProject = sanitizeStorageName(projectName);
    const safeCurve = sanitizeStorageName(curve.name || curve.id);
    const record: CurveRecord = {
      key: `${safeProject}/curves/${safeCurve}.json`,
      projectName: safeProject,
      curve,
      savedAt: Date.now(),
    };
    await runTransaction(STORE_CURVES, 'readwrite', (store) => store.put(record));
  }
}
