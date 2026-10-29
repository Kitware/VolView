import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { useImageCacheStore } from '@/src/store/image-cache';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import type { Maybe } from '@/src/types';
import type { ProgressiveImage } from '@/src/core/progressiveImage';
import { Tags } from '@/src/core/dicomTags';
import {
  OCT_GEOMETRY_ERROR,
  OCT_SCAN_PATTERN,
} from '@/src/core/streaming/dicom/octMetadataTags';
import { dicomSeriesGeometry } from '@/src/core/streaming/dicom/seriesGeometry';
import { decodedPaddingRanges } from '@/src/core/streaming/dicom/pixelPadding';

function gridReason(data: Maybe<vtkImageData>) {
  if (!data || data.getDimensions().some((n) => n < 2)) {
    return 'En face requires a three-dimensional volume.';
  }
  if (data.getPointData().getScalars()?.getNumberOfComponents() !== 1) {
    return 'En face requires a grayscale volume.';
  }
  return null;
}

function loadReason(
  imageID: Maybe<string>,
  loaded: boolean,
  data: Maybe<vtkImageData>
) {
  const cache = useImageCacheStore();
  if (imageID && cache.imageErrors[imageID]?.length) {
    return 'The volume failed to load completely.';
  }
  if (!loaded) return 'Wait for the complete volume to load.';
  return gridReason(data);
}

function acquisitionMetadataReason(metadata: Iterable<[string, string]>) {
  const tags = new Map(metadata);
  if (tags.get(Tags.OphthalmicVolumetricPropertiesFlag)?.trim() === 'NO') {
    return 'This OCT is marked unsuitable for volumetric processing.';
  }
  const pattern = tags.get(OCT_SCAN_PATTERN);
  if (pattern && !['128279', '128280'].includes(pattern)) {
    return 'En face projection requires a raster or cube OCT volume. This scan pattern needs spatial reconstruction.';
  }
  return tags.get(OCT_GEOMETRY_ERROR) ?? null;
}

function loadedGrid(data: Maybe<vtkImageData>, loaded: boolean) {
  if (!loaded || !data) return undefined;
  return {
    spacing: data.getSpacing(),
    direction: data.getDirection(),
    origin: data.getOrigin(),
  };
}

function dicomGeometry(
  image: DicomChunkImage,
  data: Maybe<vtkImageData>,
  loaded: boolean
) {
  const metadata = image.getChunks().map((chunk) => chunk.metadata ?? []);
  const series = dicomSeriesGeometry(metadata, loadedGrid(data, loaded));
  const padding = decodedPaddingRanges(metadata, data?.getDimensions()[2] ?? 0);
  const acquisitionReason = metadata
    .map(acquisitionMetadataReason)
    .find((reason) => reason !== null);
  return {
    reason: acquisitionReason ?? null,
    paddingReason: padding.reason
      ? `${padding.reason} Occupied depth is unavailable.`
      : null,
    measurementGeometryReason: acquisitionReason ?? series.reason,
    paddingRanges: padding.ranges.length ? padding.ranges : undefined,
  };
}

function inputGeometry(
  image: Maybe<ProgressiveImage>,
  data: Maybe<vtkImageData>,
  loaded: boolean
) {
  if (image instanceof DicomChunkImage)
    return dicomGeometry(image, data, loaded);
  return {
    reason: null,
    paddingReason: null,
    measurementGeometryReason: null,
    paddingRanges: undefined,
  };
}

export function getEnFaceAvailability(imageID: Maybe<string>) {
  const cache = useImageCacheStore();
  const image = cache.imageById[imageID || ''];
  // Track allocation and progress even before raw DICOM chunks arrive.
  const loaded = Boolean(image?.isLoaded());
  const loading = Boolean(image?.isLoading());
  const data = cache.getVtkImageData(imageID);
  const geometry = inputGeometry(image, data, loaded);
  const reason = image
    ? (geometry.reason ?? loadReason(imageID, loaded && !loading, data))
    : 'Load a grayscale 3D volume to use En face.';
  return {
    available: reason === null,
    reason,
    paddingReason: geometry.paddingReason,
    measurementGeometryReason: geometry.measurementGeometryReason,
    paddingRanges: geometry.paddingRanges,
  };
}
