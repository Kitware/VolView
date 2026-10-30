import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { Vector3 } from '@kitware/vtk.js/types';
import { mat4, vec3 } from 'gl-matrix';
import type { ImageMetadata } from '@/src/types/image';
import { metadataFromVtkImageData } from '@/src/utils/imageMetadata';
import type { SlabSpecification } from './types';

/** World-space gradient of the source index along the slab axis. */
function axisGradient(image: vtkImageData, axis: number): Vector3 {
  const wti = image.getWorldToIndex();
  return [wti[axis], wti[4 + axis], wti[8 + axis]];
}

/** Physical distance between the first and last slab voxel centers. */
export function slabThickness(image: vtkImageData, spec: SlabSpecification) {
  return (spec.last - spec.first) / vec3.length(axisGradient(image, spec.axis));
}

export function deriveSlabGeometry(
  image: vtkImageData,
  spec: SlabSpecification
) {
  const axes = [0, 1, 2].filter((axis) => axis !== spec.axis);
  const dimensions = image.getDimensions();
  const extent = image.getExtent();
  const minimum = [extent[0], extent[2], extent[4]];
  const sourceSpacing = image.getSpacing();
  const width = dimensions[axes[0]];
  const height = dimensions[axes[1]];
  const spacing = axes.map((axis) => Math.abs(sourceSpacing[axis]));
  const midpoint = minimum[spec.axis] + (spec.first + spec.last) / 2;
  const planeIndex = [...minimum] as Vector3;
  planeIndex[spec.axis] = midpoint;
  const planeOrigin = image.indexToWorld(planeIndex) as Vector3;
  const planeNormal = vec3.normalize(
    [0, 0, 0],
    axisGradient(image, spec.axis)
  ) as Vector3;
  const sourceMatrix = image.getIndexToWorld();
  const pixelToWorld = mat4.identity(new Array(16) as mat4);
  axes.forEach((axis, coordinate) => {
    for (let component = 0; component < 3; component++) {
      pixelToWorld[coordinate * 4 + component] =
        sourceMatrix[axis * 4 + component];
    }
  });
  for (let component = 0; component < 3; component++) {
    pixelToWorld[8 + component] = planeNormal[component];
    // Projection pixels use image-box corners; source indices name centers.
    pixelToWorld[12 + component] =
      planeOrigin[component] -
      (pixelToWorld[component] + pixelToWorld[4 + component]) / 2;
  }
  const orientation = image.getDirection();
  const metadata: ImageMetadata = {
    name: '',
    ...metadataFromVtkImageData(image),
  };
  return {
    width,
    height,
    spacing,
    metadata,
    pixelToWorld,
    sourceExtent: extent,
    planeOrigin,
    planeNormal,
    slabThickness: slabThickness(image, spec),
    fitKey: [
      spec.axis,
      ...dimensions,
      ...extent,
      ...sourceSpacing,
      ...image.getOrigin(),
      ...orientation,
    ].join(','),
  };
}

export type SlabGeometry = ReturnType<typeof deriveSlabGeometry>;
