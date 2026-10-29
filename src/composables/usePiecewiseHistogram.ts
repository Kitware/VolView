import { onScopeDispose } from 'vue';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { getAdaptiveVolumeHistogram } from '@/src/utils/adaptiveVolumePreset';
import { createHistogramWorker } from '@/src/utils/createHistogramWorker';
import { getAllComponentRange } from '@/src/utils/dataArrayRange';
import { logError } from '@/src/utils/loggers';

type HistogramWidget = {
  getNumberOfBins(): number;
  setHistogram(histogram: Float32Array | null, range: number[]): void;
};

type HistogramCache = {
  revision: string;
  histograms: Map<string, Float32Array>;
};

function getImageHistograms(
  cache: WeakMap<vtkImageData, HistogramCache>,
  image: vtkImageData,
  revision: string
) {
  const stored = cache.get(image);
  if (stored?.revision === revision) return stored.histograms;
  const histograms = new Map<string, Float32Array>();
  cache.set(image, { revision, histograms });
  return histograms;
}

function computeHistogram(
  data: ArrayLike<number>,
  range: [number, number],
  bins: number
) {
  const worker = createHistogramWorker();
  return {
    result: worker.remote.piecewiseHistogram(data, range, bins),
    stop: worker.stop,
  };
}

export function usePiecewiseHistogram(widget: HistogramWidget) {
  const cache = new WeakMap<vtkImageData, HistogramCache>();
  let previous:
    | { image: vtkImageData; revision: string; key: string }
    | undefined;
  let active: ReturnType<typeof computeHistogram> | undefined;
  let disposed = false;

  onScopeDispose(() => {
    disposed = true;
    active?.stop();
    active = undefined;
  });

  return (image: vtkImageData, fittedRange?: [number, number]) => {
    if (disposed) return;
    const scalars = image.getPointData().getScalars();
    const revision = `${image.getMTime()}:${scalars.getMTime()}`;
    const range: [number, number] = [
      ...(fittedRange ?? getAllComponentRange(scalars)),
    ];
    const bins = widget.getNumberOfBins();
    const key = `${!!fittedRange}:${range}:${bins}`;
    if (
      previous?.image === image &&
      previous.revision === revision &&
      previous.key === key
    )
      return;
    previous = { image, revision, key };
    active?.stop();
    active = undefined;

    const histograms = getImageHistograms(cache, image, revision);
    const cached = histograms.get(key);
    if (cached) {
      widget.setHistogram(cached, range);
      return;
    }

    const data = fittedRange
      ? Float64Array.from(getAdaptiveVolumeHistogram(image, range))
      : scalars.getData();
    const request = computeHistogram(data, range, bins);
    active = request;
    widget.setHistogram(null, range);
    request.result
      .then((histogram) => {
        if (disposed || active !== request) return;
        histograms.set(key, histogram);
        widget.setHistogram(histogram, range);
      })
      .catch((error) => {
        if (!disposed && active === request) {
          previous = undefined;
          logError(error);
        }
      })
      .finally(() => {
        if (active === request) active = undefined;
        request.stop();
      });
  };
}
