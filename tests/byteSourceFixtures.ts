import type { ByteSource } from '@/packages/dicom/core';

/** Hands out bytes a chunk at a time and counts what readers pulled and cancelled. */
export const trackedSource = (bytes: Uint8Array, chunkSize = bytes.length) => {
  const stats = { reads: 0, delivered: 0, cancelled: 0 };
  const source: ByteSource = {
    size: bytes.length,
    read: () => {
      stats.reads += 1;
      let offset = 0;
      return new ReadableStream<Uint8Array>({
        pull: (controller) => {
          if (offset >= bytes.length) {
            controller.close();
            return;
          }
          const chunk = bytes.slice(offset, offset + chunkSize);
          offset += chunk.length;
          stats.delivered += chunk.length;
          controller.enqueue(chunk);
        },
        cancel: () => {
          stats.cancelled += 1;
        },
      });
    },
  };
  return { source, stats };
};

/** A source whose bytes never arrive; it reports when it is pulled and cancelled. */
export const hangingSource = () => {
  const pulled = Promise.withResolvers<void>();
  const cancelled = Promise.withResolvers<unknown>();
  const source: ByteSource = {
    read: () =>
      new ReadableStream<Uint8Array>({
        pull: () => {
          pulled.resolve();
          return new Promise<void>(() => {});
        },
        cancel: (reason) => cancelled.resolve(reason),
      }),
  };
  return { source, pulled: pulled.promise, cancelled: cancelled.promise };
};
