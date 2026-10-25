import * as Comlink from 'comlink';
import { readDicomTags } from '@/src/io/readDicomTags';
import type { ReadDicomTagsWorker } from '@/src/io/readDicomTags.worker';

/**
 * How many workers share the headers. Parsing one takes a few milliseconds,
 * so two keep up with the file reads that feed them; each carries its own copy
 * of the parser, so more would cost memory for nothing.
 */
const POOL_SIZE = 2;

let pool: Array<Comlink.Remote<ReadDicomTagsWorker>> | null = null;
let next = 0;

const nextWorker = () => {
  pool ??= Array.from({ length: POOL_SIZE }, () =>
    Comlink.wrap<ReadDicomTagsWorker>(
      new Worker(new URL('./readDicomTags.worker.ts', import.meta.url), {
        type: 'module',
      })
    )
  );
  next = (next + 1) % pool.length;
  return pool[next];
};

/** Bytes that own their whole buffer, so it can be handed over, not copied. */
const owned = (bytes: Uint8Array) =>
  bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes
    : bytes.slice();

/**
 * `readDicomTags` off the main thread. A dropped folder starts every file at
 * once, and a few thousand synchronous parses landing between frames would
 * stall the progress display; the workers take them in turn instead. The
 * header is transferred, not copied: the caller is done with it. Where there
 * are no workers, as in tests, the parse runs in place.
 */
export async function readDicomTagsOffThread(
  bytes: Uint8Array
): Promise<Array<[string, string]>> {
  if (typeof Worker === 'undefined') return readDicomTags(bytes);
  const header = owned(bytes);
  return nextWorker().readDicomTags(
    Comlink.transfer(header, [header.buffer as ArrayBuffer])
  );
}
