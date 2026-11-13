import { concatBytes, defer } from '../../utils';
import type { ByteSource } from '../byteSource';

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
  const pulled = defer<void>();
  const cancelled = defer<unknown>();
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

export const readBytes = async (stream: ReadableStream<Uint8Array>) => {
  const parts: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return concatBytes(parts);
    parts.push(value);
  }
};
