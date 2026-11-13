import { StopSignal } from '@/packages/dicom/core/streaming/cachedStreamFetcher';
import type { Fetcher } from '@/packages/dicom/core/streaming/types';
import { FILE_EXT_TO_MIME } from '@/src/io/mimeTypes';
import {
  readInstance,
  type ReadInstanceOptions,
} from '@/packages/dicom/core/instance/readInstance';
import { trackedSource } from '@/packages/dicom/core/source/__tests__/sourceFixtures';
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

export const dicomFile = (bytes: Uint8Array, name = 'slice.dcm') =>
  new File([bytes as BlobPart], name, { type: FILE_EXT_TO_MIME.dcm });

/**
 * A byte source that hands out its bytes a chunk at a time as the reader pulls
 * them, so what a loader left undelivered says where it stopped.
 */
export const bytesFetcher = (bytes: Uint8Array, chunkSize = bytes.length) => {
  let delivered = 0;
  let abortController: AbortController | null = null;

  const fetcher: Fetcher = {
    connect: async () => {
      abortController ??= new AbortController();
    },
    getStream: () => {
      let offset = 0;
      return new ReadableStream<Uint8Array>({
        pull: (controller) => {
          if (offset >= bytes.length) {
            controller.close();
            return;
          }
          const chunk = bytes.slice(offset, offset + chunkSize);
          offset += chunk.length;
          delivered += chunk.length;
          controller.enqueue(chunk);
        },
      });
    },
    blob: async () =>
      new Blob([bytes as BlobPart], { type: FILE_EXT_TO_MIME.dcm }),
    close: () => {
      abortController?.abort(StopSignal);
    },
    get connected() {
      return !!abortController;
    },
    get size() {
      return delivered;
    },
    contentType: FILE_EXT_TO_MIME.dcm,
    get abortSignal() {
      return abortController?.signal;
    },
  };
  return fetcher;
};

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
