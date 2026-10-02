import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { useImageCacheStore } from '@/src/store/image-cache';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import type { Maybe } from '@/src/types';
import type { ProgressiveImage } from '@/src/core/progressiveImage';
import { LoadedVtkImage } from '@/src/core/progressiveImage';
import { CALIBRATED_SPACING_AXES } from '@/src/io/imageHeaderMetadata';
import { isOCTMetadata, octGeometryReason } from '@/src/oct/detection';
import { octSeriesGeometry } from '@/src/oct/seriesGeometry';
import { octPadding } from '@/src/oct/padding';

function gridReason(data: Maybe<vtkImageData>) {
  if (!data || data.getDimensions().some((n) => n < 2)) {
    return 'En face requires a three-dimensional OCT volume.';
  }
  if (data.getPointData().getScalars().getNumberOfComponents() !== 1) {
    return 'En face requires a grayscale OCT volume.';
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
    return 'The OCT volume failed to load completely.';
  }
  if (!loaded) return 'Wait for the complete OCT volume to load.';
  return gridReason(data);
}

function dicomMetadata(image: Maybe<ProgressiveImage>) {
  return image instanceof DicomChunkImage && image.getChunks().length
    ? (image.getDicomMetadata() ?? [])
    : [];
}

function genericCalibratedAxes(
  image: Maybe<ProgressiveImage>,
  data: Maybe<vtkImageData>
) {
  const declared = image?.headerMetadata
    ?.get(CALIBRATED_SPACING_AXES)
    ?.split(',');
  const spacing = data?.getSpacing() ?? [];
  return [0, 1, 2].map(
    (axis) =>
      declared?.[axis] === '1' &&
      Number.isFinite(spacing[axis]) &&
      spacing[axis] > 0
  );
}

function inputReason(
  eligible: boolean,
  metadata: Iterable<[string, string]>,
  loadedReason: string | null
) {
  if (!eligible)
    return 'Load an ophthalmic OCT DICOM volume, or select a grayscale 3D volume to use En face.';
  return octGeometryReason(metadata) ?? loadedReason;
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
  const series = octSeriesGeometry(metadata, loadedGrid(data, loaded));
  const padding = octPadding(metadata, data?.getDimensions()[2] ?? 0);
  return {
    reason: series.reason ?? padding.reason,
    calibratedAxes: series.calibratedAxes,
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
    calibratedAxes: genericCalibratedAxes(image, data),
    paddingRanges: undefined,
  };
}

export function getOCTAvailability(imageID: Maybe<string>) {
  const cache = useImageCacheStore();
  const image = cache.imageById[imageID || ''];
  // Track allocation and progress even before raw DICOM chunks arrive.
  const loaded = Boolean(image?.isLoaded());
  const loading = Boolean(image?.isLoading());
  const data = cache.getVtkImageData(imageID);
  const metadata = dicomMetadata(image);
  const isOCT = isOCTMetadata(metadata);
  const manualVolume = image instanceof LoadedVtkImage;
  const geometry = inputGeometry(image, data, loaded);
  const reason = inputReason(
    isOCT || manualVolume,
    metadata,
    geometry.reason ?? loadReason(imageID, loaded && !loading, data)
  );
  return {
    available: reason === null,
    isOCT,
    reason,
    calibrated: geometry.calibratedAxes[1],
    calibratedAxes: geometry.calibratedAxes,
    paddingRanges: geometry.paddingRanges,
  };
}
