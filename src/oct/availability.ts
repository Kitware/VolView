import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { useImageCacheStore } from '@/src/store/image-cache';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import type { Maybe } from '@/src/types';
import type { ProgressiveImage } from '@/src/core/progressiveImage';
import {
  isOCTMetadata,
  octCalibratedAxes,
  octGeometryReason,
} from '@/src/oct/detection';

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
  if (!loaded) {
    return 'Wait for the complete OCT volume to load.';
  }
  return gridReason(data);
}

function dicomMetadata(image: Maybe<ProgressiveImage>) {
  return image instanceof DicomChunkImage && image.getChunks().length
    ? (image.getDicomMetadata() ?? [])
    : [];
}
export function getOCTAvailability(imageID: Maybe<string>) {
  const cache = useImageCacheStore();
  const image = imageID ? cache.imageById[imageID] : null;
  // Chunk metadata is raw. Track allocation and progress even before chunks arrive.
  const loaded = image?.isLoaded() ?? false;
  const loading = image?.isLoading() ?? false;
  const data = cache.getVtkImageData(imageID);
  const metadata = dicomMetadata(image);
  const isOCT = isOCTMetadata(metadata);
  const calibratedAxes = octCalibratedAxes(metadata);
  const reason = isOCT
    ? (octGeometryReason(metadata) ??
      loadReason(imageID, loaded && !loading, data))
    : 'Load an ophthalmic OCT DICOM volume to use En face.';
  return {
    available: reason === null,
    isOCT,
    reason,
    calibrated: calibratedAxes[1],
    calibratedAxes,
  };
}
