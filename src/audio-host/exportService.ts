import {
  type ExportFormat,
  type ExportRequest,
  type ExportResult,
  type ExportWorkerInboundMessage,
  type ExportWorkerOutboundMessage,
  type ExportedFile,
  type ExportedStemFile,
  performExport,
} from './ExportWorker';

export type {
  ExportFormat,
  ExportRequest,
  ExportResult,
  ExportedFile,
  ExportedStemFile,
};
export { performExport };

let nextJobId = 1;

/**
 * Exports a seamless loop (WAV, MP3, or multi-stem WAVs) inside a background
 * Web Worker when available, falling back cleanly to synchronous rendering in
 * non-Worker environments (e.g. Node/Vitest).
 */
export async function exportAudioAsync(
  request: ExportRequest,
  baseName = 'techno-loop',
): Promise<ExportResult> {
  if (typeof Worker === 'undefined') {
    return performExport(request, baseName);
  }

  let worker: Worker;
  try {
    worker = new Worker(new URL('./ExportWorker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    return performExport(request, baseName);
  }

  const jobId = nextJobId++;

  return new Promise<ExportResult>((resolve, reject) => {
    const cleanup = () => {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };

    worker.onmessage = (event: MessageEvent<ExportWorkerOutboundMessage>) => {
      const msg = event.data;
      if (!msg || msg.jobId !== jobId) return;
      cleanup();
      if (msg.ok) {
        resolve(msg.result);
      } else {
        reject(new Error(msg.error));
      }
    };

    worker.onerror = (event: ErrorEvent) => {
      cleanup();
      reject(
        new Error(event.message || 'ExportWorker encountered an unexpected error.'),
      );
    };

    const inbound: ExportWorkerInboundMessage = {
      jobId,
      request,
      baseName,
    };
    worker.postMessage(inbound);
  });
}
