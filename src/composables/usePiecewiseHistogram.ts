import { onScopeDispose } from 'vue';
import * as Comlink from 'comlink';
import { arrayRange } from '@kitware/vtk.js/Common/Core/Math';
import type { HistogramWorker } from '@/src/utils/histogram.worker';
import { logError } from '@/src/utils/loggers';

type HistogramWidget = {
  getNumberOfBins(): number;
  setHistogram(histogram: Float32Array | null, range: number[]): void;
};

function computeHistogram(data: ArrayLike<number>, bins: number) {
  const worker = new Worker(
    new URL('@/src/utils/histogram.worker.ts', import.meta.url),
    { type: 'module' }
  );
  const remote = Comlink.wrap<HistogramWorker>(worker);
  const range = arrayRange(data as number[], 0, 1);
  let stopped = false;
  return {
    range,
    result: remote.piecewiseHistogram(data, range, bins),
    stop() {
      if (stopped) return;
      stopped = true;
      remote[Comlink.releaseProxy]();
      worker.terminate();
    },
  };
}

export function usePiecewiseHistogram(widget: HistogramWidget) {
  let previous: ArrayLike<number> | undefined;
  let active: ReturnType<typeof computeHistogram> | undefined;
  let disposed = false;

  onScopeDispose(() => {
    disposed = true;
    active?.stop();
    active = undefined;
  });

  return (data: ArrayLike<number>) => {
    if (disposed || data === previous) return;
    previous = data;
    active?.stop();
    const request = computeHistogram(data, widget.getNumberOfBins());
    active = request;
    widget.setHistogram(null, request.range);
    request.result
      .then((histogram) => {
        if (disposed || active !== request) return;
        widget.setHistogram(histogram, request.range);
      })
      .catch((error) => {
        if (!disposed && active === request) logError(error);
      })
      .finally(() => request.stop());
  };
}
