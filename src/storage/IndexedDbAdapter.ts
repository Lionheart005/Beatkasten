import type { DrawnCurveData } from '../core/math/curves';
import type { ProjectDocument } from '../core/state/types';
import type { AudioAssetPcm } from '../core/audio/types';
import {
  sanitizeStorageName,
  type ProjectStorageAdapter,
  type ProjectSummary,
} from './ProjectStorageAdapter';

// Interner DB-Name bleibt absichtlich der alte, damit gespeicherte Projekte erhalten bleiben.
const DB_NAME = 'techno-sound-generator-db';
const DB_VERSION = 3;
const STORE_AUDIO = 'audio-assets';
const STORE_PROJECTS = 'projects';
const STORE_EXPORTS = 'exports';
const STORE_CURVES = 'curves';
const STORE_SETTINGS = 'settings';

interface ExportRecord {
  readonly key: string;
  readonly projectName: string;
  readonly fileName: string;
  readonly subFolder?: string;
  readonly bytes: Uint8Array;
  readonly savedAt: number;
}

interface AudioRecord {
  readonly key: string;
  readonly projectId: string;
  readonly assetId: string;
  readonly sampleRate: number;
  readonly length: number;
  readonly left: ArrayBuffer;
  readonly right: ArrayBuffer | null;
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
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_AUDIO)) {
        db.createObjectStore(STORE_AUDIO, { keyPath: 'key' });
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

  /** Stores a small structured-cloneable value (e.g. the project folder handle). */
  async saveSetting(key: string, value: unknown): Promise<void> {
    await runTransaction(STORE_SETTINGS, 'readwrite', (store) => store.put({ key, value }));
  }

  async loadSetting<T>(key: string): Promise<T | null> {
    try {
      const record = await runTransaction<{ key: string; value: T } | undefined>(
        STORE_SETTINGS,
        'readonly',
        (store) => store.get(key) as IDBRequest<{ key: string; value: T } | undefined>,
      );
      return record ? record.value : null;
    } catch {
      return null;
    }
  }

  // --- Audio pool (PCM per asset, never inside the project JSON) -----------

  async saveAsset(projectId: string, assetId: string, pcm: AudioAssetPcm): Promise<void> {
    const record: AudioRecord = {
      key: `${projectId}:${assetId}`,
      projectId,
      assetId,
      sampleRate: pcm.sampleRate,
      length: pcm.length,
      left: pcm.left.slice().buffer as ArrayBuffer,
      right: pcm.right === pcm.left ? null : (pcm.right.slice().buffer as ArrayBuffer),
    };
    await runTransaction(STORE_AUDIO, 'readwrite', (store) => store.put(record));
  }

  async loadAsset(projectId: string, assetId: string): Promise<AudioAssetPcm | null> {
    try {
      const r = await runTransaction<AudioRecord | undefined>(
        STORE_AUDIO,
        'readonly',
        (store) => store.get(`${projectId}:${assetId}`) as IDBRequest<AudioRecord | undefined>,
      );
      if (!r) return null;
      const left = new Float32Array(r.left);
      const right = r.right ? new Float32Array(r.right) : left;
      return { left, right, sampleRate: r.sampleRate, length: Math.min(left.length, right.length) };
    } catch {
      return null;
    }
  }

  async deleteAsset(projectId: string, assetId: string): Promise<void> {
    await runTransaction(STORE_AUDIO, 'readwrite', (store) => store.delete(`${projectId}:${assetId}`));
  }

  async deleteSetting(key: string): Promise<void> {
    await runTransaction(STORE_SETTINGS, 'readwrite', (store) => store.delete(key));
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
