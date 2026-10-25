import { StopSignal } from '@/src/core/streaming/cachedStreamFetcher';
import type { Fetcher } from '@/src/core/streaming/types';
import { FILE_EXT_TO_MIME } from '@/src/io/mimeTypes';
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
  const cachedChunks: Uint8Array<ArrayBuffer>[] = [];
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
          cachedChunks.push(chunk);
          controller.enqueue(chunk);
        },
      });
    },
    blob: async () =>
      new Blob([bytes as BlobPart], { type: FILE_EXT_TO_MIME.dcm }),
    close: () => {
      abortController?.abort(StopSignal);
    },
    cachedChunks,
    get connected() {
      return !!abortController;
    },
    get size() {
      return cachedChunks.reduce((total, chunk) => total + chunk.length, 0);
    },
    contentType: FILE_EXT_TO_MIME.dcm,
    get abortSignal() {
      return abortController?.signal;
    },
  };
  return fetcher;
};

export const deliveredBytes = (fetcher: Fetcher) =>
  (fetcher.cachedChunks ?? []).reduce(
    (total, chunk) => total + chunk.length,
    0
  );

export type FetcherCounts = {
  connect: number;
  getStream: number;
  blob: number;
  close: number;
};

/** Counts what a loader asks of its byte source, delegating to the real one. */
export const countingFetcher = (inner: Fetcher) => {
  const counts: FetcherCounts = {
    connect: 0,
    getStream: 0,
    blob: 0,
    close: 0,
  };
  const fetcher: Fetcher = {
    connect: () => {
      counts.connect += 1;
      return inner.connect();
    },
    getStream: () => {
      counts.getStream += 1;
      return inner.getStream();
    },
    blob: () => {
      counts.blob += 1;
      return inner.blob();
    },
    close: () => {
      counts.close += 1;
      inner.close();
    },
    get cachedChunks() {
      return inner.cachedChunks;
    },
    get connected() {
      return inner.connected;
    },
    get size() {
      return inner.size;
    },
    get contentType() {
      return inner.contentType;
    },
    get abortSignal() {
      return inner.abortSignal;
    },
  };
  return { fetcher, counts };
};
