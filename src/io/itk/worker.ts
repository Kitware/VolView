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

const SECONDARY_CAPTURE_IMAGE_STORAGE = '1.2.840.10008.5.1.4.1.1.7';
const EXPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2.1';

const littleEndian = (value: number, size: 2 | 4) =>
  Array.from({ length: size }, (_, i) => (value >>> (8 * i)) & 0xff);

/**
 * One data element, in explicit VR little endian. A string of odd length is
 * padded with a NUL, as a UID is.
 */
function dicomElement(
  group: number,
  element: number,
  vr: string,
  value: string | number[]
) {
  const bytes =
    typeof value === 'string'
      ? new TextEncoder().encode(value.length % 2 ? `${value}\0` : value)
      : new Uint8Array(value);
  const longLength = vr === 'OB' || vr === 'OW';
  const header = new DataView(new ArrayBuffer(longLength ? 12 : 8));
  header.setUint16(0, group, true);
  header.setUint16(2, element, true);
  header.setUint8(4, vr.charCodeAt(0));
  header.setUint8(5, vr.charCodeAt(1));
  if (longLength) header.setUint32(8, bytes.length, true);
  else header.setUint16(6, bytes.length, true);
  return [new Uint8Array(header.buffer), bytes];
}

/**
 * A DICOM image of one pixel: the smallest file the DICOM readers accept.
 * Reading an empty file loads their WebAssembly modules too, but the tag
 * reader then prints "Could not read the input DICOM file" to the console.
 */
function makePreloadDicom() {
  const meta = [
    dicomElement(0x0002, 0x0002, 'UI', SECONDARY_CAPTURE_IMAGE_STORAGE),
    dicomElement(0x0002, 0x0010, 'UI', EXPLICIT_VR_LITTLE_ENDIAN),
  ].flat();
  const metaLength = meta.reduce((length, part) => length + part.length, 0);
  const dataSet = [
    dicomElement(0x0008, 0x0016, 'UI', SECONDARY_CAPTURE_IMAGE_STORAGE),
    dicomElement(0x0028, 0x0002, 'US', littleEndian(1, 2)), // samples per pixel
    dicomElement(0x0028, 0x0004, 'CS', 'MONOCHROME2 '),
    dicomElement(0x0028, 0x0010, 'US', littleEndian(1, 2)), // rows
    dicomElement(0x0028, 0x0011, 'US', littleEndian(1, 2)), // columns
    dicomElement(0x0028, 0x0100, 'US', littleEndian(16, 2)), // bits allocated
    dicomElement(0x0028, 0x0101, 'US', littleEndian(16, 2)), // bits stored
    dicomElement(0x0028, 0x0102, 'US', littleEndian(15, 2)), // high bit
    dicomElement(0x0028, 0x0103, 'US', littleEndian(0, 2)), // unsigned
    dicomElement(0x7fe0, 0x0010, 'OW', [0, 0]), // pixel data
  ].flat();
  return new File(
    [
      new Uint8Array(128), // preamble
      'DICM',
      ...dicomElement(0x0002, 0x0000, 'UL', littleEndian(metaLength, 4)),
      ...meta,
      ...dataSet,
    ],
    'preload.dcm'
  );
}

export async function initItkWorker() {
  await Promise.all([ensureWorker(), ensureDicomSeriesWorkerPool()]);

  // Loads the WebAssembly modules now, rather than on the first file.
  const preloadFile = makePreloadDicom();
  try {
    await readDicomTags(preloadFile);
  } catch {
    // ignore
  }
  try {
    await readImage(preloadFile);
  } catch {
    // ignore
  }
}
