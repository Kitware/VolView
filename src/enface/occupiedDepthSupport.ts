import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { useImageCacheStore } from '@/src/store/image-cache';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import type { Maybe } from '@/src/types';
import { Tags } from '@/src/core/dicomTags';
import { dicomSeriesGeometry } from '@/src/core/streaming/dicom/seriesGeometry';
import type { Chunk } from '@/src/core/streaming/chunk';
import { unitToMm } from '@/src/core/streaming/dicom/ultrasoundRegion';

function measurementMetadata(chunk: Chunk) {
  const tags = new Map(chunk.metadata ?? []);
  const regions = chunk.ultrasoundRegions;
  if (
    tags.get(Tags.Modality)?.trim() !== 'US' ||
    !regions?.region ||
    regions.regionCount > 1
  )
    return tags;
  const { region } = regions;
  const xFactor = unitToMm(region.physicalUnitsXDirection);
  const yFactor = unitToMm(region.physicalUnitsYDirection);
  if (xFactor === null || yFactor === null) return tags;
  const spacing = [
    region.physicalDeltaY * yFactor,
    region.physicalDeltaX * xFactor,
  ];
  if (spacing.every((value) => Number.isFinite(value) && value !== 0))
    tags.set(Tags.PixelSpacing, spacing.map(Math.abs).join('\\'));
  return tags;
}

function dicomSupport(image: DicomChunkImage, data: vtkImageData) {
  const series = dicomSeriesGeometry(
    image.getChunks().map(measurementMetadata),
    {
      spacing: data.getSpacing(),
      direction: data.getDirection(),
      origin: data.getOrigin(),
    }
  );
  return {
    reason: series.reason
      ? `${series.reason} Occupied depth is unavailable.`
      : null,
    calibratedAxes: series.calibratedAxes,
  };
}

const supportCache = new WeakMap<
  vtkImageData,
  { key: string; support: ReturnType<typeof dicomSupport> }
>();

/** DICOM series evidence for physical occupied depth; other images use their loaded grid. */
export function getOccupiedDepthSupport(imageID: Maybe<string>) {
  const cache = useImageCacheStore();
  const image = cache.imageById[imageID || ''];
  const loaded = Boolean(image?.isLoaded()) && !image?.isLoading();
  const data = cache.getVtkImageData(imageID);
  if (!(image instanceof DicomChunkImage) || !loaded || !data)
    return { reason: null, calibratedAxes: undefined };
  const key = [
    ...data.getSpacing(),
    ...data.getDirection(),
    ...data.getOrigin(),
    ...data.getDimensions(),
  ].join(',');
  const cached = supportCache.get(data);
  if (cached?.key === key) return cached.support;
  const support = dicomSupport(image, data);
  supportCache.set(data, { key, support });
  return support;
}
