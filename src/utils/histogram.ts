import { TypedArray } from '@kitware/vtk.js/types';

export function histogram(
  data: number[] | TypedArray,
  dataRange: number[],
  numberOfBins: number
) {
  const [min, max] = dataRange;
  const width = (max - min + 1) / numberOfBins;
  if (width === 0) return [];
  const hist = new Array(numberOfBins).fill(0);
  data.forEach((value) => hist[Math.floor((value - min) / width)]++);
  return hist;
}

/** The opacity editor places both scalar endpoints at bin centers. */
export function piecewiseHistogram(
  data: ArrayLike<number>,
  [minimum, maximum]: readonly number[],
  numberOfBins: number
) {
  const counts = new Array<number>(numberOfBins).fill(0);
  const span = maximum - minimum;
  for (let index = 0; index < data.length; index += 1) {
    const bin = Math.floor(
      ((numberOfBins - 1) * (Number(data[index]) - minimum)) / span
    );
    if (bin >= 0 && bin < numberOfBins) counts[bin] += 1;
  }
  // Match the widget's scaling: the largest bin does not set chart height.
  const sorted = Array.from(counts).sort((left, right) => left - right);
  const scale = sorted[sorted.length - 2];
  return Float32Array.from(counts, (count) => count / scale);
}
