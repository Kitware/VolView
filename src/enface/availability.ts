import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { useImageCacheStore } from '@/src/store/image-cache';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import type { Maybe } from '@/src/types';
import type { ProgressiveImage } from '@/src/core/progressiveImage';
import { isOCTMetadata, octGeometryReason } from '@/src/enface/detection';

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

function dicomMetadata(image: Maybe<ProgressiveImage>) {
  return image instanceof DicomChunkImage && image.getChunks().length
    ? (image.getDicomMetadata() ?? [])
    : [];
}

function acquisitionReason(image: Maybe<ProgressiveImage>) {
  if (!(image instanceof DicomChunkImage)) return null;
  return (
    image
      .getChunks()
      .map((chunk) => octGeometryReason(chunk.metadata ?? []))
      .find((reason) => reason !== null) ?? null
  );
}

export function getEnFaceAvailability(imageID: Maybe<string>) {
  const cache = useImageCacheStore();
  const image = cache.imageById[imageID || ''];
  // Track allocation and progress even before raw DICOM chunks arrive.
  const loaded = Boolean(image?.isLoaded());
  const loading = Boolean(image?.isLoading());
  const data = cache.getVtkImageData(imageID);
  const metadata = dicomMetadata(image);
  const isOCT = isOCTMetadata(metadata);
  const reason = image
    ? (acquisitionReason(image) ??
      loadReason(imageID, loaded && !loading, data))
    : 'Load a grayscale 3D volume to use En face.';
  return {
    available: reason === null,
    isOCT,
    reason,
  };
}
