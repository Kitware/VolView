import * as Comlink from 'comlink';
import { readPublicDataset, type DicomDataset } from '../metadata/dicomDataset';
import type { DicomDatasetWorker } from '../metadata/readDicomDataset.worker';
import { abortError } from '../utils';
import { createComlinkLane } from './comlinkLane';
import { createLanePool } from './lanePool';

const WORKER_COUNT = 2;

const createDatasetWorker = () =>
  new Worker(
    new URL('../metadata/readDicomDataset.worker.ts', import.meta.url),
    { type: 'module' }
  );

/** Owns parser workers. Input bytes are copied before transfer; the caller keeps its buffer. */
export function createMetadataReader(createWorker?: () => Worker) {
  if (typeof Worker === 'undefined' && !createWorker)
    return {
      read: async (bytes: Uint8Array) => readPublicDataset(bytes),
      dispose: () => {},
    };
  const pool = createLanePool(
    Array.from({ length: WORKER_COUNT }, () =>
      createComlinkLane<DicomDatasetWorker, Uint8Array, DicomDataset>(
        createWorker ?? createDatasetWorker,
        'DICOM metadata',
        (remote, bytes) =>
          remote.readPublicDataset(Comlink.transfer(bytes, [bytes.buffer]))
      )
    )
  );
  // An aborted header read stops waiting; its parse finishes in the worker.
  const unabortable = new AbortController().signal;
  const read = (bytes: Uint8Array) => pool.run(bytes.slice(), unabortable);
  const dispose = (reason: unknown = abortError('Metadata reader disposed')) =>
    pool.dispose(reason);
  return { read, dispose };
}
