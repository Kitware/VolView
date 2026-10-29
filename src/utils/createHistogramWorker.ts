import * as Comlink from 'comlink';
import type { HistogramWorker } from '@/src/utils/histogram.worker';

export function createHistogramWorker() {
  const worker = new Worker(
    new URL('@/src/utils/histogram.worker.ts', import.meta.url),
    { type: 'module' }
  );
  const remote = Comlink.wrap<HistogramWorker>(worker);
  let stopped = false;
  return {
    remote,
    stop() {
      if (stopped) return;
      stopped = true;
      remote[Comlink.releaseProxy]();
      worker.terminate();
    },
  };
}
