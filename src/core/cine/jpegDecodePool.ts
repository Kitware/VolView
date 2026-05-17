import * as Comlink from 'comlink';
import type { DecodedFrame } from './frameCache';
import type { JpegDecoderWorker } from './jpegDecode.worker';

// 2 workers is enough: createImageBitmap is async inside each worker, so the
// browser's JPEG thread pool can already pipeline decodes within a single one.
const MAX_WORKERS = 2;

let proxies: Comlink.Remote<JpegDecoderWorker>[] | null = null;
let nextWorkerIndex = 0;

function ensureWorkers(): Comlink.Remote<JpegDecoderWorker>[] {
  if (proxies) return proxies;
  const count = Math.min(
    MAX_WORKERS,
    Math.max(1, Math.floor((navigator.hardwareConcurrency || 4) / 2))
  );
  proxies = Array.from({ length: count }, () =>
    Comlink.wrap<JpegDecoderWorker>(
      new Worker(new URL('./jpegDecode.worker.ts', import.meta.url), {
        type: 'module',
      })
    )
  );
  return proxies;
}

export function decodeJpegInWorker(
  bytes: Uint8Array,
  expectedWidth: number,
  expectedHeight: number
): Promise<DecodedFrame> {
  const pool = ensureWorkers();
  // Bytes are a view into the parent DICOM buffer; slice copies them into a
  // standalone ArrayBuffer that can be transferred without detaching the shared buffer.
  const standalone = bytes.slice();
  const proxy = pool[nextWorkerIndex];
  nextWorkerIndex = (nextWorkerIndex + 1) % pool.length;
  return proxy.decodeJpeg(
    Comlink.transfer(standalone, [standalone.buffer]),
    expectedWidth,
    expectedHeight
  );
}
