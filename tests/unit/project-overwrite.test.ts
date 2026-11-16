import { describe, expect, it } from 'vitest';
import { createHypnoticAMinorProject, type ProjectDocument } from '../../src/core/state';
import { BrowserFsAdapter, type FsDirectoryHandleLike } from '../../src/storage';

/** Minimaler In-Memory-Ordner (File System Access API) für Tests. */
class MemDir {
  readonly kind = 'directory' as const;
  readonly dirs = new Map<string, MemDir>();
  readonly files = new Map<string, string>();
  constructor(readonly name: string) {}

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<MemDir> {
    let d = this.dirs.get(name);
    if (!d) {
      if (!opts?.create) throw new Error('NotFound');
      d = new MemDir(name);
      this.dirs.set(name, d);
    }
    return d;
  }

  async getFileHandle(name: string, opts?: { create?: boolean }) {
    if (!this.files.has(name) && !opts?.create) throw new Error('NotFound');
    if (!this.files.has(name)) this.files.set(name, '');
    const files = this.files;
    return {
      kind: 'file' as const,
      name,
      getFile: async () => new File([files.get(name) ?? ''], name),
      createWritable: async () => {
        let buf = '';
        return {
          write: async (data: string | Uint8Array | ArrayBuffer) => {
            buf += typeof data === 'string' ? data : '[binary]';
          },
          close: async () => {
            files.set(name, buf);
          },
        };
      },
    };
  }

  async *values(): AsyncIterable<never> {
    for (const d of this.dirs.values()) yield d as never;
  }

  async removeEntry(name: string): Promise<void> {
    this.dirs.delete(name);
    this.files.delete(name);
  }
}

function project(id: string, name: string): ProjectDocument {
  return { ...createHypnoticAMinorProject(), id, name };
}

describe('Projekte werden nicht versehentlich überschrieben', () => {
  it('gleicher Name, andere ID → eigener Ordner mit _2, das Original bleibt unberührt', async () => {
    const root = new MemDir('Techno');
    const fs = new BrowserFsAdapter();
    fs.setRootDirectory(root as unknown as FsDirectoryHandleLike);

    await fs.saveProject(project('proj_original', 'Stahlwerk'));
    const originalJson = root.dirs.get('Stahlwerk')!.files.get('project.json');

    await fs.saveProject(project('proj_neu', 'Stahlwerk'));

    expect(root.dirs.has('Stahlwerk_2')).toBe(true);
    expect(root.dirs.get('Stahlwerk')!.files.get('project.json')).toBe(originalJson);
    expect(JSON.parse(root.dirs.get('Stahlwerk_2')!.files.get('project.json')!).id).toBe('proj_neu');

    // Erneutes Speichern beider Projekte bleibt in den jeweils eigenen Ordnern
    await fs.saveProject(project('proj_original', 'Stahlwerk'));
    await fs.saveProject(project('proj_neu', 'Stahlwerk'));
    expect([...root.dirs.keys()].sort()).toEqual(['Stahlwerk', 'Stahlwerk_2']);
  });
});
