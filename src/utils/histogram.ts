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
