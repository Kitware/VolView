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

// A chunk's tag list is fixed once loaded, so each is scanned at most once.
const metadataReasons = new WeakMap<object, string | null>();

function acquisitionReason(image: ProgressiveImage) {
  if (!(image instanceof DicomChunkImage)) return null;
  for (const { metadata } of image.getChunks()) {
    if (!metadata) continue;
    let reason = metadataReasons.get(metadata);
    if (reason === undefined) {
      reason = acquisitionMetadataReason(metadata);
      metadataReasons.set(metadata, reason);
    }
    if (reason !== null) return reason;
  }
  return null;
}

export function getEnFaceUnavailableReason(imageID: Maybe<string>) {
  const cache = useImageCacheStore();
  const image = cache.imageById[imageID || ''];
  // Track allocation and progress even before raw DICOM chunks arrive.
  const loaded = Boolean(image?.isLoaded());
  const loading = Boolean(image?.isLoading());
  const data = cache.getVtkImageData(imageID);
  return image
    ? (acquisitionReason(image) ??
        loadReason(imageID, loaded && !loading, data))
    : 'Load a grayscale 3D volume to use En face.';
}
