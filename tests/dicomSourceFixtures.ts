import { readInstance, type ReadInstanceOptions } from '@/packages/dicom/core';
import { trackedSource } from '@/tests/byteSourceFixtures';
import {
  buildSyntheticDicom,
  type SyntheticSliceOptions,
} from '@/tests/specs/syntheticDicom';

export const syntheticSlice = (
  overrides: Partial<SyntheticSliceOptions> = {}
) =>
  buildSyntheticDicom({
    studyUid: '1.2.826.0.1.3680043.10.998.1',
    seriesUid: '1.2.826.0.1.3680043.10.998.2',
    sopUid: '1.2.826.0.1.3680043.10.998.3',
    instanceNumber: 1,
    imageOrientationPatient: [1, 0, 0, 0, 1, 0],
    imagePositionPatient: [0, 0, 0],
    ...overrides,
  });

/** Offset of the (7fe0,0010) tag, found without the streaming parser. */
export const pixelDataStart = (bytes: Uint8Array) => {
  const tag = [0xe0, 0x7f, 0x10, 0x00];
  const at = bytes.findIndex(
    (_, i) => i > 132 && tag.every((byte, j) => bytes[i + j] === byte)
  );
  if (at < 0) throw new Error('fixture has no Pixel Data element');
  return at;
};

/** The same file with its Pixel Data element cut off, as an RT object has. */
export const withoutPixelData = (bytes: Uint8Array) =>
  bytes.slice(0, pixelDataStart(bytes));

/** Reads a header from bytes delivered `chunkSize` at a time. */
export const readHeader = (
  bytes: Uint8Array,
  chunkSize = bytes.length,
  options?: ReadInstanceOptions
) =>
  readInstance(
    trackedSource(bytes, chunkSize).source,
    new AbortController().signal,
    options
  );
