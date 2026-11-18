import { useCallback, useEffect, useRef, useState } from 'react';
import { decodeAudioFile } from '../../audio-host/assetImport';
import { referencedAssetIds } from '../../core/arrangement/edit';
import { peakOf } from '../../core/audio/analysis';
import { computePeaks, type WaveformPeaks } from '../../core/audio/peaks';
import { PROJECT_SAMPLE_RATE, type AudioAssetMeta, type AudioAssetPcm, type AudioAssetSource } from '../../core/audio/types';
import { sanitizeStorageName } from '../../storage';
import { nextUiId, type StudioStore } from '../store/useStudioStore';

export interface PoolEntry {
  readonly pcm: AudioAssetPcm;
  readonly peaks: WaveformPeaks;
}

/** IDs of assets used by sample-instrument layers (snapshot + sections). */
function sampleLayerAssetIds(project: StudioStore['project']): Set<string> {
  const out = new Set<string>();
  const scan = (layers: ReadonlyArray<{ sample?: { assetId: string } }>) => {
    for (const l of layers) if (l.sample?.assetId) out.add(l.sample.assetId);
  };
  scan(project.activeSnapshot.layers);
  for (const s of project.sections) scan(s.snapshot.layers);
  return out;
}

/**
 * Audio pool of the project: metadata lives in the project document, PCM in
 * the asset store (IndexedDB + project folder `audio/`). PCM is loaded when a
 * project opens and handed to the audio worklet once.
 */
export function useAudioPool(studio: StudioStore) {
  const { project, idbAdapter, fsAdapter, audioBridge, setAssets, showNotice } = studio;
  const pcmRef = useRef<Map<string, PoolEntry>>(new Map());
  const [tick, setTick] = useState(0);
  const loadingRef = useRef<Set<string>>(new Set());
  const projectRef = useRef(project);
  projectRef.current = project;

  const register = useCallback(
    (id: string, pcm: AudioAssetPcm) => {
      pcmRef.current.set(id, { pcm, peaks: computePeaks(pcm.right === pcm.left ? [pcm.left] : [pcm.left, pcm.right]) });
      audioBridge.setAsset(id, pcm);
      setTick((t) => t + 1);
    },
    [audioBridge],
  );

  // Load PCM of all assets of the current project (lazy, once per asset).
  useEffect(() => {
    const metas = project.assets ?? [];
    for (const meta of metas) {
      if (pcmRef.current.has(meta.id) || loadingRef.current.has(meta.id)) continue;
      loadingRef.current.add(meta.id);
      void (async () => {
        let pcm: AudioAssetPcm | null = null;
        if (fsAdapter.hasRootDirectory()) pcm = await fsAdapter.loadAsset(project.name, project.id, meta);
        if (!pcm && idbAdapter.isSupported()) pcm = await idbAdapter.loadAsset(project.id, meta.id);
        loadingRef.current.delete(meta.id);
        if (pcm) register(meta.id, pcm);
      })();
    }
  }, [project.assets, project.id, project.name, fsAdapter, idbAdapter, register]);

  // Another project: forget the PCM of the previous one.
  const lastProjectId = useRef(project.id);
  useEffect(() => {
    if (lastProjectId.current === project.id) return;
    for (const id of pcmRef.current.keys()) audioBridge.removeAsset(id);
    pcmRef.current.clear();
    lastProjectId.current = project.id;
    setTick((t) => t + 1);
  }, [project.id, audioBridge]);

  /** Adds PCM as a new asset (recording, import, bounce, freeze). Returns the meta. */
  const addAsset = useCallback(
    async (
      pcm: AudioAssetPcm,
      name: string,
      source: AudioAssetSource,
      extra: Partial<Pick<AudioAssetMeta, 'rootMidi' | 'freezeKey'>> & { channels?: 1 | 2 } = {},
    ): Promise<AudioAssetMeta> => {
      const id = nextUiId('asset');
      const p = projectRef.current;
      const meta: AudioAssetMeta = {
        id,
        name,
        source,
        sampleRate: pcm.sampleRate,
        channels: extra.channels ?? (pcm.right === pcm.left ? 1 : 2),
        lengthSamples: pcm.length,
        fileName: `audio/${id}_${sanitizeStorageName(name, id)}.wav`,
        createdAt: Date.now(),
        ...(extra.rootMidi !== undefined ? { rootMidi: extra.rootMidi } : {}),
        ...(extra.freezeKey ? { freezeKey: extra.freezeKey } : {}),
      };
      register(id, pcm);
      setAssets((prev) => [...prev, meta]);
      try {
        if (idbAdapter.isSupported()) await idbAdapter.saveAsset(p.id, id, pcm);
        if (fsAdapter.hasRootDirectory()) await fsAdapter.saveAsset(p.name, p.id, meta, pcm);
      } catch (err) {
        showNotice(`Audio konnte nicht gespeichert werden: ${err instanceof Error ? err.message : String(err)}`);
      }
      return meta;
    },
    [fsAdapter, idbAdapter, register, setAssets, showNotice],
  );

  const importFiles = useCallback(
    async (files: readonly File[], normalize = false): Promise<AudioAssetMeta[]> => {
      const out: AudioAssetMeta[] = [];
      for (const file of files) {
        try {
          const decoded = await decodeAudioFile(await file.arrayBuffer(), PROJECT_SAMPLE_RATE);
          let pcm: AudioAssetPcm = decoded;
          if (normalize) {
            const pk = peakOf(decoded.right === decoded.left ? [decoded.left] : [decoded.left, decoded.right]);
            if (pk > 1e-4) {
              const g = 0.98 / pk;
              const left = decoded.left.map((v) => v * g);
              const right = decoded.right === decoded.left ? left : decoded.right.map((v) => v * g);
              pcm = { ...decoded, left, right };
            }
          }
          out.push(await addAsset(pcm, file.name.replace(/\.[^.]+$/, ''), 'import', { channels: decoded.channels }));
        } catch (err) {
          showNotice(`„${file.name}“ konnte nicht geladen werden: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (out.length > 0) showNotice(`${out.length} Datei(en) im Audio-Pool`);
      return out;
    },
    [addAsset, showNotice],
  );

  /** Removes assets used by neither clips nor sample instruments. */
  const removeUnused = useCallback(async () => {
    const p = projectRef.current;
    const used = new Set([...(p.arrangement ? referencedAssetIds(p.arrangement) : []), ...sampleLayerAssetIds(p)]);
    const unused = (p.assets ?? []).filter((a) => !used.has(a.id));
    if (unused.length === 0) {
      showNotice('Alle Aufnahmen werden benutzt');
      return;
    }
    setAssets((prev) => prev.filter((a) => used.has(a.id)));
    for (const meta of unused) {
      pcmRef.current.delete(meta.id);
      audioBridge.removeAsset(meta.id);
      try {
        if (idbAdapter.isSupported()) await idbAdapter.deleteAsset(p.id, meta.id);
        if (fsAdapter.hasRootDirectory()) await fsAdapter.deleteAsset(p.name, p.id, meta);
      } catch {
        // ignore
      }
    }
    setTick((t) => t + 1);
    showNotice(`${unused.length} unbenutzte Aufnahme(n) entfernt`);
  }, [audioBridge, fsAdapter, idbAdapter, setAssets, showNotice]);

  const get = useCallback((id: string): PoolEntry | undefined => pcmRef.current.get(id), []);

  /** PCM of the given assets (for the export worker). */
  const collect = useCallback((ids: Iterable<string>) => {
    const out: Array<{ id: string; left: Float32Array; right: Float32Array; sampleRate: number }> = [];
    for (const id of ids) {
      const e = pcmRef.current.get(id);
      if (e) out.push({ id, left: e.pcm.left, right: e.pcm.right, sampleRate: e.pcm.sampleRate });
    }
    return out;
  }, []);

  return { tick, get, addAsset, importFiles, removeUnused, collect, metas: project.assets ?? [] };
}

export type AudioPool = ReturnType<typeof useAudioPool>;
