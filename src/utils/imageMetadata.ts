import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { vec3 } from 'gl-matrix';
import type { ImageMetadata } from '@/src/types/image';
import { getLPSDirections } from '@/src/utils/lps';

export function metadataFromVtkImageData(
  imageData: vtkImageData
): Omit<ImageMetadata, 'name'> {
  return {
    dimensions: imageData.getDimensions() as vec3,
    spacing: imageData.getSpacing() as vec3,
    origin: imageData.getOrigin() as vec3,
    orientation: imageData.getDirection(),
    lpsOrientation: getLPSDirections(imageData.getDirection()),
    worldBounds: imageData.getBounds(),
    worldToIndex: imageData.getWorldToIndex(),
    indexToWorld: imageData.getIndexToWorld(),
  };
}
