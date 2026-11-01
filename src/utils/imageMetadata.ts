import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { ImageMetadata } from '@/src/types/image';
import { getLPSDirections } from '@/src/utils/lps';

export function metadataFromVtkImageData(
  imageData: vtkImageData
): Omit<ImageMetadata, 'name'> {
  return {
    dimensions: imageData.getDimensions(),
    spacing: imageData.getSpacing(),
    origin: imageData.getOrigin(),
    orientation: imageData.getDirection(),
    lpsOrientation: getLPSDirections(imageData.getDirection()),
    worldBounds: imageData.getBounds(),
    worldToIndex: imageData.getWorldToIndex(),
    indexToWorld: imageData.getIndexToWorld(),
  };
}
