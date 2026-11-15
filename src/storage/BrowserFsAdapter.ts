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
  removeEntry?(name: string, options?: { recursive?: boolean }): Promise<void>;
  queryPermission?(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
}

export type FsDirectoryHandleLike = FsDirectoryHandle;

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

/** Legacy sub folder: older builds always created `<picked folder>/Projekte/`. */
const LEGACY_PROJECTS_DIR = 'Projekte';

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

async function hasProjectSubfolders(dir: FsDirectoryHandle): Promise<boolean> {
  for await (const entry of dir.values()) {
    if (entry.kind !== 'directory') continue;
    if (await readJsonFile<ProjectManifestJson>(entry, 'project.json')) return true;
  }
  return false;
}

async function removeStaleJsonFiles(
  dir: FsDirectoryHandle,
  keep: ReadonlySet<string>,
): Promise<void> {
  if (!dir.removeEntry) return;
  const stale: string[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind === 'file' && entry.name.endsWith('.json') && !keep.has(entry.name)) {
      stale.push(entry.name);
    }
  }
  for (const name of stale) {
    try {
      await dir.removeEntry(name);
    } catch {
      // ignore
    }
  }
}

async function copyDirectory(from: FsDirectoryHandle, to: FsDirectoryHandle): Promise<void> {
  for await (const entry of from.values()) {
    if (entry.kind === 'file') {
      const file = await entry.getFile();
      const target = await to.getFileHandle(entry.name, { create: true });
      const writable = await target.createWritable();
      await writable.write(new Uint8Array(await file.arrayBuffer()));
      await writable.close();
    } else {
      await copyDirectory(entry, await ensureDir(to, entry.name));
    }
  }
}

/**
 * Browser File System Access API adapter writing human-readable project folders.
 * The folder the user picks IS the projects folder:
 * `<Ordner>/<Projektname>/project.json`, `history.json`, `sections/*.json`,
 * `curves/*.json`, `exports/*.wav`. (A legacy `<Ordner>/Projekte/` sub folder
 * from older builds is still used if it already contains projects.)
 */
export class BrowserFsAdapter implements ProjectStorageAdapter {
  readonly kind = 'filesystem' as const;
  private rootDir: FsDirectoryHandle | null = null;
  private projectsDirCache: FsDirectoryHandle | null = null;
  private usesLegacySubfolder = false;
  /** project id -> folder name, so renames move the folder instead of duplicating it. */
  private readonly dirNameById = new Map<string, string>();

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
    this.projectsDirCache = null;
    this.dirNameById.clear();
  }

  getRootDirectory(): FsDirectoryHandle | null {
    return this.rootDir;
  }

  /** Human-readable location of a project folder, e.g. "Musik/Cooler_Beat". */
  describeProjectLocation(projectName: string, projectId?: string): string {
    const root = this.rootDir?.name ?? '?';
    const folder =
      (projectId ? this.dirNameById.get(projectId) : undefined) ??
      sanitizeStorageName(projectName, projectId);
    return `${root}/${this.usesLegacySubfolder ? `${LEGACY_PROJECTS_DIR}/` : ''}${folder}`;
  }

  private async getProjectsDir(): Promise<FsDirectoryHandle> {
    if (this.projectsDirCache) return this.projectsDirCache;
    const root = await this.requireRootDirectory();
    const legacy = await tryGetDir(root, LEGACY_PROJECTS_DIR);
    if (legacy && (await hasProjectSubfolders(legacy))) {
      this.usesLegacySubfolder = true;
      this.projectsDirCache = legacy;
    } else {
      this.usesLegacySubfolder = false;
      this.projectsDirCache = root;
    }
    return this.projectsDirCache;
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
    this.setRootDirectory(dir);
    return dir;
  }

  private async requireRootDirectory(): Promise<FsDirectoryHandle> {
    if (this.rootDir) return this.rootDir;
    return this.pickRootDirectory();
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const projectsDir = await this.getProjectsDir();

    // Deduplicate by project id (older builds wrote one folder per rename).
    const byId = new Map<string, ProjectSummary>();
    for await (const entry of projectsDir.values()) {
      if (entry.kind !== 'directory') continue;
      const manifest = await readJsonFile<ProjectManifestJson>(entry, 'project.json');
      if (!manifest) continue;
      const prev = byId.get(manifest.id);
      if (!prev || manifest.updatedAt > prev.updatedAt) {
        byId.set(manifest.id, {
          id: manifest.id,
          name: manifest.name,
          updatedAt: manifest.updatedAt,
        });
        this.dirNameById.set(manifest.id, entry.name);
      }
    }

    return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async loadProject(projectIdOrName: string): Promise<ProjectDocument | null> {
    const projectsDir = await this.getProjectsDir();

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
        // Prefer the newest folder when duplicates exist.
        if (!matchedManifest || manifest.updatedAt > matchedManifest.updatedAt) {
          matchedDir = entry;
          matchedManifest = manifest;
        }
      }
    }

    if (!matchedDir || !matchedManifest) return null;
    this.dirNameById.set(matchedManifest.id, matchedDir.name);

    const historyNodes =
      (await readJsonFile<HistoryNode[]>(matchedDir, 'history.json')) ?? [];

    const sections: SectionItem[] = [];
    const sectionsDir = await tryGetDir(matchedDir, 'sections');
    if (sectionsDir) {
      const loaded: Array<{ file: string; section: SectionItem }> = [];
      for await (const entry of sectionsDir.values()) {
        if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue;
        const file = await entry.getFile();
        try {
          loaded.push({ file: entry.name, section: JSON.parse(await file.text()) as SectionItem });
        } catch {
          // Ignore malformed section files
        }
      }
      // File names carry an order prefix ("01_…"), so this keeps the user's order.
      loaded.sort((a, b) => a.file.localeCompare(b.file));
      const seenIds = new Set<string>();
      for (const item of loaded) {
        if (seenIds.has(item.section.id)) continue;
        seenIds.add(item.section.id);
        sections.push(item.section);
      }
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
    const projectsDir = await this.getProjectsDir();
    const dirName = sanitizeStorageName(project.name, project.id);
    const previousDirName = this.dirNameById.get(project.id);
    const projectDir = await ensureDir(projectsDir, dirName);

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
    const sectionFiles = new Set<string>();
    project.sections.forEach((section, idx) => {
      // Index prefix keeps the order and makes duplicate names unique.
      sectionFiles.add(
        `${String(idx + 1).padStart(2, '0')}_${sanitizeStorageName(section.name, section.id)}.json`,
      );
    });
    const sectionFileList = [...sectionFiles];
    for (let i = 0; i < project.sections.length; i++) {
      await writeTextFile(
        sectionsDir,
        sectionFileList[i]!,
        JSON.stringify(project.sections[i], null, 2),
      );
    }
    // Deleted / renamed sections must not come back on the next load.
    await removeStaleJsonFiles(sectionsDir, sectionFiles);

    if (project.activeSnapshot.curves.length > 0) {
      const curvesDir = await ensureDir(projectDir, 'curves');
      const curveFiles = new Set<string>();
      for (const curve of project.activeSnapshot.curves) {
        const curveFile = `${sanitizeStorageName(curve.name || curve.id, curve.id)}.json`;
        curveFiles.add(curveFile);
        await writeTextFile(curvesDir, curveFile, JSON.stringify(curve, null, 2));
      }
      await removeStaleJsonFiles(curvesDir, curveFiles);
    }

    this.dirNameById.set(project.id, dirName);

    // Renamed project: move instead of leaving a duplicate folder behind.
    if (previousDirName && previousDirName !== dirName && projectsDir.removeEntry) {
      const oldDir = await tryGetDir(projectsDir, previousDirName);
      const oldManifest = oldDir
        ? await readJsonFile<ProjectManifestJson>(oldDir, 'project.json')
        : null;
      if (oldDir && oldManifest?.id === project.id) {
        // Carry exports over before removing the old folder.
        const oldExports = await tryGetDir(oldDir, 'exports');
        if (oldExports) await copyDirectory(oldExports, await ensureDir(projectDir, 'exports'));
        try {
          await projectsDir.removeEntry(previousDirName, { recursive: true });
        } catch {
          // keep old folder if it cannot be removed
        }
      }
    }
  }

  /** Re-requests write permission for a remembered folder (needs a user gesture). */
  async ensurePermission(handle: FsDirectoryHandle, request: boolean): Promise<boolean> {
    const opts = { mode: 'readwrite' as const };
    try {
      if (handle.queryPermission && (await handle.queryPermission(opts)) === 'granted') {
        return true;
      }
      if (request && handle.requestPermission) {
        return (await handle.requestPermission(opts)) === 'granted';
      }
    } catch {
      return false;
    }
    return false;
  }

  async saveExportedAudio(
    projectName: string,
    fileName: string,
    bytes: Uint8Array,
    subFolder?: string,
  ): Promise<void> {
    const projectsDir = await this.getProjectsDir();
    const projectDir = await ensureDir(projectsDir, sanitizeStorageName(projectName));
    const exportsDir = await ensureDir(projectDir, 'exports');

    const targetDir = subFolder
      ? await ensureDir(exportsDir, sanitizeStorageName(subFolder))
      : exportsDir;

    await writeBinaryFile(targetDir, sanitizeStorageName(fileName), bytes);
  }

  async saveCurvePreset(projectName: string, curve: DrawnCurveData): Promise<void> {
    const projectsDir = await this.getProjectsDir();
    const projectDir = await ensureDir(projectsDir, sanitizeStorageName(projectName));
    const curvesDir = await ensureDir(projectDir, 'curves');
    const curveFile = `${sanitizeStorageName(curve.name || curve.id, curve.id)}.json`;
    await writeTextFile(curvesDir, curveFile, JSON.stringify(curve, null, 2));
  }
}
