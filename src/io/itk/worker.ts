import {
  readDicomTags,
  readImageDicomFileSeriesWorkerFunction,
} from '@itk-wasm/dicom';
import { readImage } from '@itk-wasm/image-io';
import { WorkerPool, createWebWorker, setDefaultWebWorker } from 'itk-wasm';

const DEFAULT_NUM_WORKERS = 4;

let readDicomSeriesWorkerPool: WorkerPool | null = null;
let webWorker: Worker | null = null;

export async function ensureWorker() {
  if (webWorker) return;
  webWorker = await createWebWorker(null);
  setDefaultWebWorker(webWorker);
}

export function ensureDicomSeriesWorkerPool() {
  if (readDicomSeriesWorkerPool) return;
  // copied from read-image-dicom-file-series.ts
  const numberOfWorkers =
    typeof globalThis.navigator?.hardwareConcurrency === 'number'
      ? globalThis.navigator.hardwareConcurrency
      : DEFAULT_NUM_WORKERS;
  readDicomSeriesWorkerPool = new WorkerPool(
    numberOfWorkers,
    readImageDicomFileSeriesWorkerFunction
  );
}

export function getWorker() {
  return webWorker;
}

export function getDicomSeriesWorkerPool() {
  return readDicomSeriesWorkerPool;
}

export async function initItkWorker() {
  await Promise.all([ensureWorker(), ensureDicomSeriesWorkerPool()]);

  // preload
  try {
    await readDicomTags(new File([], 'a.dcm'));
  } catch {
    // ignore
  }
  try {
    await readImage(new File([], 'a.dcm'));
  } catch {
    // ignore
  }
}
