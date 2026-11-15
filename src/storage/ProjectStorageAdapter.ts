import type { DrawnCurveData } from '../core/math/curves';
import type { ProjectDocument } from '../core/state/types';

export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: number;
}

export interface ProjectStorageAdapter {
  readonly kind: 'indexeddb' | 'filesystem';
  isSupported(): boolean;
  listProjects(): Promise<ProjectSummary[]>;
  loadProject(projectIdOrName: string): Promise<ProjectDocument | null>;
  saveProject(project: ProjectDocument): Promise<void>;
  saveExportedAudio(
    projectName: string,
    fileName: string,
    bytes: Uint8Array,
    subFolder?: string,
  ): Promise<void>;
  saveCurvePreset(projectName: string, curve: DrawnCurveData): Promise<void>;
}

/**
 * Normalizes a user-facing project, section, or file name into a safe filesystem segment.
 */
export function sanitizeStorageName(name: string, fallback = 'untitled'): string {
  const cleaned = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_');
  return cleaned.length > 0 ? cleaned : fallback;
}
