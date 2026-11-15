import type { DrawnCurveData } from '../core/math/curves';
import type {
  BeatSnapshot,
  HistoryNode,
  ProjectDocument,
  SectionItem,
} from '../core/state/types';
import {
  sanitizeStorageName,
  type ProjectStorageAdapter,
  type ProjectSummary,
} from './ProjectStorageAdapter';

interface FsWritableStream {
  write(data: string | Uint8Array | ArrayBuffer): Promise<void>;
  close(): Promise<void>;
}

interface FsFileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<FsWritableStream>;
}

interface FsDirectoryHandle {
  readonly kind: 'directory';
  readonly name: string;
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FsDirectoryHandle>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FsFileHandle>;
  values(): AsyncIterable<FsDirectoryHandle | FsFileHandle>;
}

interface WindowWithFsPicker {
  showDirectoryPicker?: (options?: {
    mode?: 'read' | 'readwrite';
  }) => Promise<FsDirectoryHandle>;
}

interface ProjectManifestJson {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly updatedAt: number;
  readonly activeSnapshot: BeatSnapshot;
  readonly activeHistoryNodeId: string;
}

const PROJECTS_ROOT_DIR = 'Projekte';

async function ensureDir(
  parent: FsDirectoryHandle,
  name: string,
): Promise<FsDirectoryHandle> {
  return parent.getDirectoryHandle(name, { create: true });
}

async function tryGetDir(
  parent: FsDirectoryHandle,
  name: string,
): Promise<FsDirectoryHandle | null> {
  try {
    return await parent.getDirectoryHandle(name, { create: false });
  } catch {
    return null;
  }
}

async function writeTextFile(
  dir: FsDirectoryHandle,
  fileName: string,
  content: string,
): Promise<void> {
  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function writeBinaryFile(
  dir: FsDirectoryHandle,
  fileName: string,
  bytes: Uint8Array,
): Promise<void> {
  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  await writable.write(copy.buffer);
  await writable.close();
}

async function readJsonFile<T>(
  dir: FsDirectoryHandle,
  fileName: string,
): Promise<T | null> {
  try {
    const fileHandle = await dir.getFileHandle(fileName, { create: false });
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Browser File System Access API adapter writing human-readable project folders:
 * `Projekte/<Name>/project.json`, `history.json`, `sections/*.json`, `curves/*.json`, `exports/*.wav`.
 */
export class BrowserFsAdapter implements ProjectStorageAdapter {
  readonly kind = 'filesystem' as const;
  private rootDir: FsDirectoryHandle | null = null;

  isSupported(): boolean {
    if (typeof window === 'undefined') return false;
    const picker = (window as unknown as WindowWithFsPicker).showDirectoryPicker;
    return typeof picker === 'function';
  }

  hasRootDirectory(): boolean {
    return this.rootDir !== null;
  }

  setRootDirectory(handle: FsDirectoryHandle | null): void {
    this.rootDir = handle;
  }

  async pickRootDirectory(): Promise<FsDirectoryHandle> {
    if (typeof window === 'undefined') {
      throw new Error('File System Access API erfordert eine Browser-Umgebung.');
    }
    const picker = (window as unknown as WindowWithFsPicker).showDirectoryPicker;
    if (typeof picker !== 'function') {
      throw new Error('showDirectoryPicker wird von diesem Browser nicht unterstützt.');
    }
    const dir = await picker({ mode: 'readwrite' });
    this.rootDir = dir;
    return dir;
  }

  private async requireRootDirectory(): Promise<FsDirectoryHandle> {
    if (this.rootDir) return this.rootDir;
    return this.pickRootDirectory();
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const root = await this.requireRootDirectory();
    const projectsDir = await tryGetDir(root, PROJECTS_ROOT_DIR);
    if (!projectsDir) return [];

    const summaries: ProjectSummary[] = [];
    for await (const entry of projectsDir.values()) {
      if (entry.kind !== 'directory') continue;
      const manifest = await readJsonFile<ProjectManifestJson>(entry, 'project.json');
      if (manifest) {
        summaries.push({
          id: manifest.id,
          name: manifest.name,
          updatedAt: manifest.updatedAt,
        });
      }
    }

    return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async loadProject(projectIdOrName: string): Promise<ProjectDocument | null> {
    const root = await this.requireRootDirectory();
    const projectsDir = await tryGetDir(root, PROJECTS_ROOT_DIR);
    if (!projectsDir) return null;

    const targetSafe = sanitizeStorageName(projectIdOrName);
    let matchedDir: FsDirectoryHandle | null = null;
    let matchedManifest: ProjectManifestJson | null = null;

    for await (const entry of projectsDir.values()) {
      if (entry.kind !== 'directory') continue;
      const manifest = await readJsonFile<ProjectManifestJson>(entry, 'project.json');
      if (!manifest) continue;
      if (
        manifest.id === projectIdOrName ||
        manifest.name === projectIdOrName ||
        entry.name === targetSafe
      ) {
        matchedDir = entry;
        matchedManifest = manifest;
        break;
      }
    }

    if (!matchedDir || !matchedManifest) return null;

    const historyNodes =
      (await readJsonFile<HistoryNode[]>(matchedDir, 'history.json')) ?? [];

    const sections: SectionItem[] = [];
    const sectionsDir = await tryGetDir(matchedDir, 'sections');
    if (sectionsDir) {
      for await (const entry of sectionsDir.values()) {
        if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue;
        const file = await entry.getFile();
        try {
          const parsed = JSON.parse(await file.text()) as SectionItem;
          sections.push(parsed);
        } catch {
          // Ignore malformed section files
        }
      }
      sections.sort((a, b) => a.name.localeCompare(b.name));
    }

    return {
      id: matchedManifest.id,
      name: matchedManifest.name,
      version: matchedManifest.version,
      updatedAt: matchedManifest.updatedAt,
      activeSnapshot: matchedManifest.activeSnapshot,
      activeHistoryNodeId: matchedManifest.activeHistoryNodeId,
      historyNodes,
      sections,
    };
  }

  async saveProject(project: ProjectDocument): Promise<void> {
    const root = await this.requireRootDirectory();
    const projectsDir = await ensureDir(root, PROJECTS_ROOT_DIR);
    const projectDir = await ensureDir(
      projectsDir,
      sanitizeStorageName(project.name, project.id),
    );

    const manifest: ProjectManifestJson = {
      id: project.id,
      name: project.name,
      version: project.version,
      updatedAt: Date.now(),
      activeSnapshot: project.activeSnapshot,
      activeHistoryNodeId: project.activeHistoryNodeId,
    };

    await writeTextFile(projectDir, 'project.json', JSON.stringify(manifest, null, 2));
    await writeTextFile(
      projectDir,
      'history.json',
      JSON.stringify(project.historyNodes, null, 2),
    );

    const sectionsDir = await ensureDir(projectDir, 'sections');
    for (const section of project.sections) {
      const sectionFile = `${sanitizeStorageName(section.name, section.id)}.json`;
      await writeTextFile(sectionsDir, sectionFile, JSON.stringify(section, null, 2));
    }

    if (project.activeSnapshot.curves.length > 0) {
      const curvesDir = await ensureDir(projectDir, 'curves');
      for (const curve of project.activeSnapshot.curves) {
        const curveFile = `${sanitizeStorageName(curve.name || curve.id, curve.id)}.json`;
        await writeTextFile(curvesDir, curveFile, JSON.stringify(curve, null, 2));
      }
    }
  }

  async saveExportedAudio(
    projectName: string,
    fileName: string,
    bytes: Uint8Array,
    subFolder?: string,
  ): Promise<void> {
    const root = await this.requireRootDirectory();
    const projectsDir = await ensureDir(root, PROJECTS_ROOT_DIR);
    const projectDir = await ensureDir(projectsDir, sanitizeStorageName(projectName));
    const exportsDir = await ensureDir(projectDir, 'exports');

    const targetDir = subFolder
      ? await ensureDir(exportsDir, sanitizeStorageName(subFolder))
      : exportsDir;

    await writeBinaryFile(targetDir, sanitizeStorageName(fileName), bytes);
  }

  async saveCurvePreset(projectName: string, curve: DrawnCurveData): Promise<void> {
    const root = await this.requireRootDirectory();
    const projectsDir = await ensureDir(root, PROJECTS_ROOT_DIR);
    const projectDir = await ensureDir(projectsDir, sanitizeStorageName(projectName));
    const curvesDir = await ensureDir(projectDir, 'curves');
    const curveFile = `${sanitizeStorageName(curve.name || curve.id, curve.id)}.json`;
    await writeTextFile(curvesDir, curveFile, JSON.stringify(curve, null, 2));
  }
}
