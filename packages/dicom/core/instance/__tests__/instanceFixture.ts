import type { DicomDataset } from '../../metadata/dicomDataset';
import { fromBlob, type ByteSource } from '../../source/byteSource';
import type { Instance } from '../readInstance';

const noBytes = fromBlob(new Blob([]));

/** An instance as `readInstance` returns it, from a header built in memory. */
export const instanceFor = (
  dataset: DicomDataset,
  source: ByteSource = noBytes
): Instance =>
  Object.freeze({
    source,
    dataset,
    layout: null,
    ultrasoundRegions: null,
    transferSyntaxUid: null,
    pixelData: null,
  });
