import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { WLAutoRanges } from '@/src/constants';
import type { SlabMethod, SlabSpecification } from './types';
import { slabThickness } from './geometry';

type WindowRanges = Record<keyof typeof WLAutoRanges, [number, number]>;
type ProjectionRanges = Record<SlabMethod, WindowRanges>;
type CachedRanges = {
  revision: string;
  slabs: Map<string, ProjectionRanges>;
};

const summaries = new WeakMap<vtkImageData, CachedRanges>();
const voxelReadBudget = 1024 * 1024;
const maximumRays = 2048;
const maximumDepthSamples = 512;
const maximumCachedSlabs = 8;

function sampleGrid(width: number, height: number, depthSamples: number) {
  const budget = Math.min(
    maximumRays,
    Math.floor(voxelReadBudget / (2 * depthSamples))
  );
  const initialColumns = Math.min(width, Math.floor(Math.sqrt(budget)));
  const rows = Math.min(height, Math.floor(budget / initialColumns));
  return [Math.min(width, Math.floor(budget / rows)), rows];
}

function sampleRay(
  values: ArrayLike<number>,
  start: number,
  stride: number,
  depths: number[]
) {
  let total = 0;
  let maximum = -Infinity;
  for (const depth of depths) {
    const lower = Math.floor(depth);
    const fraction = depth - lower;
    const a = values[start + lower * stride];
    const b = values[start + Math.ceil(depth) * stride];
    const value = a + fraction * (b - a);
    total += value;
    maximum = Math.max(maximum, value);
  }
  return { mean: total / depths.length, max: maximum };
}

function slabSampleCount(thickness: number, spacing: number) {
  const halfThickness = Math.fround(Math.fround(thickness) * 0.5);
  if (halfThickness === 0) return 1;
  const step = Math.fround(Math.fround(spacing) * 0.5);
  if (!(step > 0) || !Number.isFinite(halfThickness)) return NaN;
  // Match the Float32 endpoint test in the patched vtk slab shader.
  const tolerance = Math.fround(halfThickness * 4.76837158203125e-7);
  const atBoundary = (index: number) =>
    Math.fround(halfThickness - Math.fround(Math.fround(index) * step)) <=
    tolerance;
  let first = 1;
  let last = Math.max(1, Math.ceil(halfThickness / step));
  if (!Number.isSafeInteger(last)) return NaN;
  while (first < last) {
    const middle = first + Math.floor((last - first) / 2);
    if (atBoundary(middle)) last = middle;
    else first = middle + 1;
  }
  return 1 + 2 * first;
}

/** Bounded physical-depth samples estimate contrast without generating an image. */
function sampleProjection(image: vtkImageData, spec: SlabSpecification) {
  const dimensions = image.getDimensions();
  const axes = [0, 1, 2].filter((axis) => axis !== spec.axis);
  const [width, height] = axes.map((axis) => dimensions[axis]);
  const spacing = Math.min(...image.getSpacing().map(Math.abs));
  const sampleCount = slabSampleCount(slabThickness(image, spec), spacing);
  if (!(sampleCount > 0) || !Number.isFinite(sampleCount)) return null;
  const depthSamples = Math.min(maximumDepthSamples, sampleCount);
  const depths = Array.from({ length: depthSamples }, (_, index) =>
    depthSamples === 1
      ? spec.first
      : spec.first + ((spec.last - spec.first) * index) / (depthSamples - 1)
  );
  const [columns, rows] = sampleGrid(width, height, depthSamples);
  const strides = [1, dimensions[0], dimensions[0] * dimensions[1]];
  const values = image.getPointData().getScalars().getData();
  const samples: Record<SlabMethod, number[]> = { mean: [], max: [], sum: [] };
  for (let row = 0; row < rows; row++) {
    const y = Math.floor(((row + 0.5) * height) / rows) * strides[axes[1]];
    for (let column = 0; column < columns; column++) {
      const x =
        Math.floor(((column + 0.5) * width) / columns) * strides[axes[0]];
      const ray = sampleRay(values, x + y, strides[spec.axis], depths);
      samples.mean.push(ray.mean);
      samples.max.push(ray.max);
      samples.sum.push(ray.mean * sampleCount);
    }
  }
  return { samples, sampleCount };
}

function windowRanges(
  samples: number[],
  complete: [number, number]
): WindowRanges {
  const sorted = samples.filter(Number.isFinite).sort((a, b) => a - b);
  const percentile = (
    percentage: number,
    fallback: [number, number]
  ): [number, number] => {
    if (!sorted.length || sorted[0] === sorted[sorted.length - 1])
      return complete;
    const lower = Math.max(
      0,
      Math.ceil((sorted.length * percentage) / 100) - 1
    );
    const upper = Math.ceil(sorted.length * (1 - percentage / 100)) - 1;
    return sorted[lower] < sorted[upper]
      ? [sorted[lower], sorted[upper]]
      : fallback;
  };
  const low = percentile(WLAutoRanges.LowContrast, [
    sorted[0],
    sorted[sorted.length - 1],
  ]);
  const medium = percentile(WLAutoRanges.MediumContrast, low);
  return {
    FullRange: complete,
    LowContrast: low,
    MediumContrast: medium,
    HighContrast: percentile(WLAutoRanges.HighContrast, medium),
  };
}

/** Percentile presets estimate the slab; manual contrast uses the normal view path. */
export function slabWindowRanges(image: vtkImageData, spec: SlabSpecification) {
  const scalars = image.getPointData().getScalars();
  const [min, max] = scalars.getRange();
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return null;
  const revision = `${image.getMTime()}:${scalars.getMTime()}`;
  let cached = summaries.get(image);
  if (cached?.revision !== revision) {
    cached = { revision, slabs: new Map() };
    summaries.set(image, cached);
  }
  const key = `${spec.axis}:${spec.first}:${spec.last}`;
  const previous = cached.slabs.get(key);
  if (previous) return previous[spec.method];
  const projection = sampleProjection(image, spec);
  if (!projection) return null;
  const { samples, sampleCount } = projection;
  const sumBounds: [number, number] = [
    Math.min(0, min * sampleCount),
    Math.max(0, max * sampleCount),
  ];
  const sumRange: [number, number] = sumBounds.every(Number.isFinite)
    ? sumBounds
    : [min, max];
  const ranges = {
    mean: windowRanges(samples.mean, [min, max]),
    max: windowRanges(samples.max, [min, max]),
    sum: windowRanges(samples.sum, sumRange),
  };
  if (cached.slabs.size >= maximumCachedSlabs)
    cached.slabs.delete(cached.slabs.keys().next().value!);
  cached.slabs.set(key, ranges);
  return ranges[spec.method];
}
