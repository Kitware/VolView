import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import type { VolumeColorConfig } from '@/src/store/view-configs/types';

import {
  ADAPTIVE_VOLUME_PROFILES,
  isAdaptiveVolumePreset,
} from './adaptiveVolumePresets';

export {
  ADAPTIVE_VOLUME_PRESETS,
  DEFAULT_ADAPTIVE_VOLUME_PRESET,
  getAdaptiveVolumePresetDescription,
  isAdaptiveVolumePreset,
} from './adaptiveVolumePresets';

export const ADAPTIVE_VOLUME_LIGHTING = {
  enabled: true,
  ambient: 0.6,
  diffuse: 0.4,
  specular: 0.1,
  useLocalAmbientOcclusion: false,
};

export function getAdaptiveVolumePresetUnavailableReason(
  image: vtkImageData | null | undefined,
  isLoaded: boolean
) {
  if (!image) return 'Load a grayscale volume to use adaptive presets';
  if (!isLoaded) return 'Wait for the complete volume to load';
  const scalars = image.getPointData().getScalars();
  if (!scalars || scalars.getNumberOfComponents() !== 1)
    return 'Adaptive presets require a grayscale volume';
  if (!scalars.getRange().every(Number.isFinite))
    return 'Adaptive presets require finite intensities';
  return '';
}

type AdaptiveColoring = Pick<
  VolumeColorConfig,
  'transferFunction' | 'opacityFunction'
>;

const sampleBudget = 131072;
const summaries = new WeakMap<
  vtkImageData,
  {
    revision: string;
    samples: number[];
    colorRange: [number, number];
    low: number;
    high: number;
    meanWeight: number;
    maxDimension: number;
  }
>();

function sampleScalars(image: vtkImageData) {
  const values = image.getPointData().getScalars()?.getData();
  if (!values?.length) return [];
  const count = Math.min(values.length, sampleBudget);
  return Array.from({ length: count }, (_, index) => {
    // Stratification covers the whole volume; deterministic jitter avoids aliasing
    // repeated voxel patterns when the sampling stride is an integer.
    let hash = Math.imul(index + 1, 0x9e3779b1);
    hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
    const offset = ((hash ^ (hash >>> 13)) >>> 0) / 0x100000000;
    return values[Math.floor(((index + offset) * values.length) / count)];
  }).filter(Number.isFinite);
}

export function getAdaptiveVolumeHistogram(
  image: vtkImageData,
  range: [number, number]
) {
  return [
    ...range,
    ...(summarize(image)?.samples ?? []).filter(
      (value) => value >= range[0] && value <= range[1]
    ),
  ];
}

function meanIntensityWeight(samples: number[], low: number, high: number) {
  const span = high - low;
  return (
    samples.reduce((total, value) => {
      if (value <= low) return total;
      const t = Math.min(1, (value - low) / span);
      return total + 1 - (1 - t) ** 2;
    }, 0) / Math.max(1, samples.length)
  );
}

function fitSparseIntensities(samples: number[], range: [number, number]) {
  const [low, maximum] = range;
  // Fit the sparse upper tail robustly; use the known range if sampling missed it.
  const upperTail = samples
    .filter((value) => value > low)
    .sort((a, b) => a - b);
  const high =
    upperTail[Math.floor(0.995 * (upperTail.length - 1))] ??
    (maximum > low ? maximum : low + 1);
  const colorRange: [number, number] = [low, high];
  return {
    colorRange,
    low,
    high,
    meanWeight:
      maximum > low
        ? Math.max(
            meanIntensityWeight(samples, low, high),
            1 / Math.max(1, samples.length)
          )
        : 0,
  };
}

function fitIntensities(samples: number[], range: [number, number]) {
  // Exclude the zero peak from fitting nonnegative intensity volumes.
  const foreground = samples
    .filter((value) => range[0] < 0 || value !== 0)
    .sort((a, b) => a - b);
  if (!foreground.length) return fitSparseIntensities(samples, range);
  const percentile = (fraction: number) =>
    foreground[Math.floor(fraction * (foreground.length - 1))];
  const high = percentile(0.995);
  if (high === range[0] && range[1] > range[0]) {
    return fitSparseIntensities(samples, range);
  }
  const lower = percentile(0.85);
  // Binary foreground needs a ramp across its background-to-signal interval
  // so linearly interpolated samples remain visible.
  const low =
    lower < high
      ? lower
      : range[0] < high
        ? range[0]
        : high - (high === 0 ? 1 : Math.abs(high) * 0.01);
  const meanWeight = meanIntensityWeight(samples, low, high);
  // Use a wider color ramp than the opacity ramp so visible tissue is bright
  // while low-intensity background remains transparent.
  const colorLow = percentile(0.5);
  const colorHigh = percentile(0.98);
  const colorRange: [number, number] =
    colorHigh > colorLow ? [colorLow, colorHigh] : [low, high];
  return { colorRange, low, high, meanWeight };
}

function summarize(image: vtkImageData) {
  const scalars = image.getPointData().getScalars();
  if (!scalars || scalars.getNumberOfComponents() !== 1) return null;
  const revision = `${image.getMTime()}:${scalars.getMTime()}`;
  const previous = summaries.get(image);
  if (previous?.revision === revision) return previous;

  const values = scalars.getData();
  if (!values.length) return null;
  const [minimum, maximum] = scalars.getRange();
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return null;
  const range: [number, number] = [minimum, maximum];
  const samples = sampleScalars(image);
  const summary = {
    revision,
    samples,
    maxDimension: Math.max(...image.getDimensions()),
    ...fitIntensities(samples, range),
  };
  summaries.set(image, summary);
  return summary;
}

export function getAdaptiveVolumePreset(
  image: vtkImageData,
  preset: string
): AdaptiveColoring | null {
  if (!isAdaptiveVolumePreset(preset)) return null;
  const summary = summarize(image);
  if (!summary) return null;
  const { colorRange, low, high, meanWeight, maxDimension } = summary;
  const profile = ADAPTIVE_VOLUME_PROFILES[preset];
  // Opacity is defined over half the volume diagonal / max dimension. Fit a
  // representative third-diagonal ray to 40%, 75%, or 95% integrated opacity.
  const unitsPerRay = (2 * maxDimension) / 3;
  const height =
    meanWeight > 0
      ? Math.min(
          profile.maximumOpacity,
          -Math.expm1(-profile.opticalDepth / (unitsPerRay * meanWeight))
        )
      : 0;
  return {
    transferFunction: {
      preset,
      mappingRange: [...colorRange],
    },
    opacityFunction: {
      mode: vtkPiecewiseFunctionProxy.Mode.Gaussians,
      mappingRange: [low, high],
      gaussians:
        height > 0
          ? [{ position: 1, width: 1, height, xBias: 0, yBias: 1 }]
          : [],
    },
  };
}
