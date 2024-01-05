import {
  readDicomTags,
  readImageDicomFileSeriesWorkerFunction,
} from '@itk-wasm/dicom';
import { WorkerPool, createWorkerProxy, readImageBlob } from 'itk-wasm';

const DEFAULT_NUM_WORKERS = 4;

let readDicomSeriesWorkerPool: WorkerPool | null = null;
let webWorker: Worker | null = null;
let webWorkerPromise: Promise<void> | null = null;

export async function ensureWorker() {
  if (webWorker) return;
  if (!webWorkerPromise) {
    webWorkerPromise = new Promise((resolve) => {
      createWorkerProxy(null).then(({ worker }) => {
        webWorker = worker;
        resolve();
      });
    });
  }
  await webWorkerPromise;
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
    await readDicomTags(webWorker, new File([], 'a.dcm'));
  } catch (err) {
    // ignore
  }
  try {
    await readImageBlob(webWorker, new Blob([]), 'a.dcm');
  } catch (err) {
    // ignore
  }
}
