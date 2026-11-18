import {
  renderOfflineLoop,
  renderSongChain,
  renderStems,
  type SongChainPart,
} from '../core/engine/OfflineRenderer';
import { encodeMp3, encodeWav } from '../core/export';
import { renderArrangement, sectionMapOf } from '../core/arrangement/renderArrangement';
import type { AudioAssetData } from '../core/arrangement/ArrangementEngine';
import type { ArrangementDoc } from '../core/arrangement/types';
import type { BeatSnapshot } from '../core/state/types';
import { sanitizeStorageName } from '../storage/ProjectStorageAdapter';

export type ExportFormat =
  | 'wav-16'
  | 'wav-24'
  | 'mp3-192'
  | 'mp3-320'
  | 'stems-wav-16'
  | 'stems-wav-24';

export interface ExportRequest {
  readonly snapshot: BeatSnapshot;
  readonly bars: number;
  readonly preRollBars: number;
  readonly sampleRate?: number;
  readonly format: ExportFormat;
  /**
   * Song-Kette: wenn gesetzt, werden alle Abschnitte hintereinander gerendert
   * (`snapshot`/`bars` werden dann ignoriert; Stems → nur Gesamtmix).
   */
  readonly songChain?: readonly SongChainPart[];
  /** Ausklang-Takte am Ende der Song-Kette. */
  readonly tailBars?: number;
  /** Timeline-Export (hat Vorrang vor songChain / snapshot). */
  readonly arrangement?: ArrangementExportSpec;
  /** PCM des Audio-Pools (Sample-Instrument-Layer, Audio-Clips). */
  readonly assets?: ArrangementExportSpec['assets'];
}

export interface ArrangementExportSpec {
  readonly doc: ArrangementDoc;
  readonly sections: ReadonlyArray<{ readonly id: string; readonly snapshot: BeatSnapshot }>;
  readonly startBeat?: number;
  readonly endBeat?: number;
  readonly tailSeconds?: number;
  readonly assets?: ReadonlyArray<{
    readonly id: string;
    readonly left: Float32Array;
    readonly right: Float32Array;
    readonly sampleRate: number;
  }>;
}

export interface ExportedFile {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

export interface ExportedStemFile {
  readonly layerId: string;
  readonly layerName: string;
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

export interface ExportResult {
  readonly mainFile?: ExportedFile;
  readonly stemFiles?: ReadonlyArray<ExportedStemFile>;
  readonly durationSeconds: number;
}

export interface ExportWorkerInboundMessage {
  readonly jobId: number;
  readonly request: ExportRequest;
  readonly baseName?: string;
}

export type ExportWorkerOutboundMessage =
  | {
      readonly jobId: number;
      readonly ok: true;
      readonly result: ExportResult;
    }
  | {
      readonly jobId: number;
      readonly ok: false;
      readonly error: string;
    };

/**
 * Renders and encodes audio synchronously according to an ExportRequest.
 * Shared between the background Web Worker and the synchronous fallback path.
 */
export function performExport(
  request: ExportRequest,
  baseName = 'techno-loop',
): ExportResult {
  const safeBase = sanitizeStorageName(baseName, 'techno-loop');
  const sampleRate = request.sampleRate ?? 48000;
  const bars = request.bars;
  const preRollBars = request.preRollBars;
  const poolMap = new Map<string, AudioAssetData>();
  for (const a of [...(request.assets ?? []), ...(request.arrangement?.assets ?? [])]) {
    poolMap.set(a.id, { left: a.left, right: a.right, sampleRate: a.sampleRate, length: Math.min(a.left.length, a.right.length) });
  }
  const sampleBank = (id: string) => poolMap.get(id);

  if (request.arrangement) {
    const spec = request.arrangement;
    const sections = sectionMapOf(spec.sections);
    const assetMap = poolMap;
    const opts = {
      sampleRate,
      startBeat: spec.startBeat,
      endBeat: spec.endBeat,
      tailSeconds: spec.tailSeconds ?? 2,
      assets: (id: string) => assetMap.get(id),
    };
    const mix = renderArrangement(spec.doc, sections, opts);
    const isMp3 = request.format === 'mp3-192' || request.format === 'mp3-320';
    if (isMp3) {
      const kbps = request.format === 'mp3-320' ? 320 : 192;
      return {
        mainFile: {
          fileName: `${safeBase}_timeline.mp3`,
          bytes: encodeMp3(mix.left, mix.right, mix.sampleRate, kbps),
          mimeType: 'audio/mpeg',
        },
        durationSeconds: mix.durationSeconds,
      };
    }
    const bitDepth: 16 | 24 = request.format === 'wav-24' || request.format === 'stems-wav-24' ? 24 : 16;
    const isStems = request.format === 'stems-wav-16' || request.format === 'stems-wav-24';
    const stemFiles: ExportedStemFile[] = [];
    if (isStems) {
      spec.doc.tracks.forEach((track, idx) => {
        if (track.clips.length === 0) return;
        const stem = renderArrangement(spec.doc, sections, { ...opts, soloTrackId: track.id });
        stemFiles.push({
          layerId: track.id,
          layerName: track.name,
          fileName: `${safeBase}_spur_${String(idx + 1).padStart(2, '0')}_${sanitizeStorageName(track.name, track.id)}.wav`,
          bytes: encodeWav(stem.left, stem.right, stem.sampleRate, bitDepth),
        });
      });
    }
    return {
      mainFile: {
        fileName: `${safeBase}_timeline${isStems ? '_mix' : ''}.wav`,
        bytes: encodeWav(mix.left, mix.right, mix.sampleRate, bitDepth),
        mimeType: 'audio/wav',
      },
      ...(isStems ? { stemFiles } : {}),
      durationSeconds: mix.durationSeconds,
    };
  }

  if (request.songChain && request.songChain.length > 0) {
    const rendered = renderSongChain(request.songChain, {
      sampleRate,
      preRollBars,
      tailBars: request.tailBars ?? 2,
      sampleBank,
    });
    const isMp3 = request.format === 'mp3-192' || request.format === 'mp3-320';
    if (isMp3) {
      const kbps = request.format === 'mp3-320' ? 320 : 192;
      return {
        mainFile: {
          fileName: `${safeBase}_song.mp3`,
          bytes: encodeMp3(rendered.left, rendered.right, rendered.sampleRate, kbps),
          mimeType: 'audio/mpeg',
        },
        durationSeconds: rendered.durationSeconds,
      };
    }
    const bitDepth: 16 | 24 =
      request.format === 'wav-24' || request.format === 'stems-wav-24' ? 24 : 16;
    return {
      mainFile: {
        fileName: `${safeBase}_song.wav`,
        bytes: encodeWav(rendered.left, rendered.right, rendered.sampleRate, bitDepth),
        mimeType: 'audio/wav',
      },
      durationSeconds: rendered.durationSeconds,
    };
  }

  switch (request.format) {
    case 'wav-16':
    case 'wav-24': {
      const bitDepth: 16 | 24 = request.format === 'wav-24' ? 24 : 16;
      const rendered = renderOfflineLoop(request.snapshot, {
        sampleRate,
        bars,
        preRollBars,
        sampleBank,
      });
      const bytes = encodeWav(
        rendered.left,
        rendered.right,
        rendered.sampleRate,
        bitDepth,
      );
      return {
        mainFile: {
          fileName: `${safeBase}.wav`,
          bytes,
          mimeType: 'audio/wav',
        },
        durationSeconds: rendered.durationSeconds,
      };
    }

    case 'mp3-192':
    case 'mp3-320': {
      const kbps = request.format === 'mp3-320' ? 320 : 192;
      const rendered = renderOfflineLoop(request.snapshot, {
        sampleRate,
        bars,
        preRollBars,
        sampleBank,
      });
      const bytes = encodeMp3(
        rendered.left,
        rendered.right,
        rendered.sampleRate,
        kbps,
      );
      return {
        mainFile: {
          fileName: `${safeBase}.mp3`,
          bytes,
          mimeType: 'audio/mpeg',
        },
        durationSeconds: rendered.durationSeconds,
      };
    }

    case 'stems-wav-16':
    case 'stems-wav-24': {
      const bitDepth: 16 | 24 = request.format === 'stems-wav-24' ? 24 : 16;
      const stemRender = renderStems(request.snapshot, {
        sampleRate,
        bars,
        preRollBars,
        sampleBank,
      });
      const mixBytes = encodeWav(
        stemRender.mix.left,
        stemRender.mix.right,
        stemRender.sampleRate,
        bitDepth,
      );
      const stemFiles: ExportedStemFile[] = stemRender.stems.map((stem, idx) => {
        const safeLayer = sanitizeStorageName(stem.layerName, stem.layerId);
        const indexPrefix = String(idx + 1).padStart(2, '0');
        return {
          layerId: stem.layerId,
          layerName: stem.layerName,
          fileName: `${safeBase}_stem_${indexPrefix}_${safeLayer}.wav`,
          bytes: encodeWav(
            stem.left,
            stem.right,
            stemRender.sampleRate,
            bitDepth,
          ),
        };
      });

      return {
        mainFile: {
          fileName: `${safeBase}_mix.wav`,
          bytes: mixBytes,
          mimeType: 'audio/wav',
        },
        stemFiles,
        durationSeconds: stemRender.numSamples / stemRender.sampleRate,
      };
    }
  }
}

function collectTransferables(result: ExportResult): Transferable[] {
  const buffers = new Set<ArrayBuffer>();
  if (result.mainFile) {
    buffers.add(result.mainFile.bytes.buffer as ArrayBuffer);
  }
  if (result.stemFiles) {
    for (const stem of result.stemFiles) {
      buffers.add(stem.bytes.buffer as ArrayBuffer);
    }
  }
  return Array.from(buffers);
}

const isDedicatedWorkerScope =
  typeof window === 'undefined' &&
  typeof process === 'undefined' &&
  typeof self !== 'undefined' &&
  typeof (self as unknown as { postMessage?: unknown }).postMessage === 'function';

if (isDedicatedWorkerScope) {
  const workerSelf = self as unknown as DedicatedWorkerGlobalScope;
  workerSelf.onmessage = (event: MessageEvent<ExportWorkerInboundMessage>) => {
    const payload = event.data;
    if (!payload || typeof payload !== 'object') return;

    try {
      const result = performExport(payload.request, payload.baseName);
      const response: ExportWorkerOutboundMessage = {
        jobId: payload.jobId,
        ok: true,
        result,
      };
      workerSelf.postMessage(response, collectTransferables(result));
    } catch (err) {
      const response: ExportWorkerOutboundMessage = {
        jobId: payload.jobId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
      workerSelf.postMessage(response);
    }
  };
}
