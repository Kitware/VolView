import { StopSignal } from '@/src/core/streaming/cachedStreamFetcher';
import { Fetcher } from '@/src/core/streaming/types';

/** Read enough per pull that a header rarely needs a second slice. */
const CHUNK_SIZE = 64 * 1024;

/**
 * A Fetcher over bytes that are already addressable, so a local file and a
 * remote URI reach the same loaders. Slicing rather than reading the whole
 * blob keeps a header read off the rest of the file.
 *
 * The blob is its own cache: every stream starts at its first byte and keeps
 * nothing, so a header the meta loader is done with is not pinned for the
 * chunk's lifetime, and a stream cut short leaves nothing behind for the next
 * one to trip over. Closing ends a stream in flight the way a cancelled
 * download ends a network stream.
 */
export const blobFetcher = (blob: Blob): Fetcher => {
  let abortController: AbortController | null = null;

  return {
    connect: async () => {
      abortController ??= new AbortController();
    },
    getStream: () => {
      // The stream belongs to the connection it was opened on: a close then
      // a reconnect must not revive it.
      const connection = abortController;
      let offset = 0;
      return new ReadableStream<Uint8Array>({
        pull: async (controller) => {
          if (!connection) {
            controller.close();
            return;
          }
          if (connection.signal.aborted) {
            controller.error(StopSignal);
            return;
          }
          if (offset >= blob.size) {
            controller.close();
            return;
          }
          const slice = blob.slice(offset, offset + CHUNK_SIZE);
          const chunk = new Uint8Array(await slice.arrayBuffer());
          offset += chunk.length;
          controller.enqueue(chunk);
        },
      });
    },
    blob: async () => blob,
    close: () => {
      abortController?.abort(StopSignal);
      abortController = null;
    },
    get connected() {
      return !!abortController;
    },
    get size() {
      return blob.size;
    },
    contentType: blob.type,
    get abortSignal() {
      return abortController?.signal;
    },
  };
};
