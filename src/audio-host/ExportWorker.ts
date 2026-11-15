import { renderOfflineLoop, renderStems } from '../core/engine/OfflineRenderer';
import { encodeMp3, encodeWav } from '../core/export';
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

  switch (request.format) {
    case 'wav-16':
    case 'wav-24': {
      const bitDepth: 16 | 24 = request.format === 'wav-24' ? 24 : 16;
      const rendered = renderOfflineLoop(request.snapshot, {
        sampleRate,
        bars,
        preRollBars,
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
