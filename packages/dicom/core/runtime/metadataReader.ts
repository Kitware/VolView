import * as Comlink from 'comlink';
import { readPublicDataset, type DicomDataset } from '../metadata/dicomDataset';
import type { DicomDatasetWorker } from '../metadata/readDicomDataset.worker';
import { abortError } from '../utils';

export type MetadataReaderOptions = {
  metadataWorkerFactory?: () => Worker;
};

const WORKER_COUNT = 2;

/** Owns parser workers. Input bytes are copied before transfer; the caller keeps its buffer. */
export function createMetadataReader(options: MetadataReaderOptions = {}) {
  const workers: Array<{
    worker: Worker;
    remote: Comlink.Remote<DicomDatasetWorker>;
  }> = [];
  const pending = new Set<(reason: unknown) => void>();
  let next = 0;
  let disposal: unknown;
  const createWorker =
    options.metadataWorkerFactory ??
    (() =>
      new Worker(
        new URL('../metadata/readDicomDataset.worker.ts', import.meta.url),
        { type: 'module' }
      ));
  const resetWorkers = (error: unknown) => {
    pending.forEach((reject) => reject(error));
    pending.clear();
    workers.forEach(({ remote, worker }) => {
      remote[Comlink.releaseProxy]();
      worker.terminate();
    });
    workers.length = 0;
  };
  const read = async (bytes: Uint8Array): Promise<DicomDataset> => {
    if (disposal) throw disposal;
    if (typeof Worker === 'undefined' && !options.metadataWorkerFactory)
      return readPublicDataset(bytes);
    if (workers.length < WORKER_COUNT) {
      const worker = createWorker();
      const fail = (message: string) => {
        if (workers.some((entry) => entry.worker === worker))
          resetWorkers(new Error(message));
      };
      worker.addEventListener(
        'error',
        () => fail('DICOM metadata worker failed'),
        { once: true }
      );
      worker.addEventListener(
        'messageerror',
        () => fail('DICOM metadata worker message failed'),
        { once: true }
      );
      workers.push({
        worker,
        remote: Comlink.wrap<DicomDatasetWorker>(worker),
      });
    }
    const { remote } = workers[next++ % workers.length];
    const owned = bytes.slice();
    return new Promise((resolve, reject) => {
      pending.add(reject);
      remote
        .readPublicDataset(Comlink.transfer(owned, [owned.buffer]))
        .then(resolve, reject)
        .finally(() => pending.delete(reject));
    });
  };
  const dispose = (
    reason: unknown = abortError('Metadata reader disposed')
  ) => {
    if (disposal) return;
    disposal = reason;
    resetWorkers(reason);
  };
  return { read, dispose };
}
