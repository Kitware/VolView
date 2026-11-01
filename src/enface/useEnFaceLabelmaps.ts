import { computed, onScopeDispose, unref, watch, type MaybeRef } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import type { Vector3 } from '@kitware/vtk.js/types';
import { vec3, type mat4 } from 'gl-matrix';
import type { OccupiedDepthResult } from '@/src/segmentation/measurements/occupiedDepth';
import { createThinRegionMask } from './projectionMasks';

export type MeasurementPlaneGeometry = {
  width: number;
  height: number;
  spacing: readonly number[];
  pixelToWorld: mat4;
};

const sameGeometry = (
  left: MeasurementPlaneGeometry,
  right: MeasurementPlaneGeometry | null | undefined
) =>
  !!right &&
  left.width === right.width &&
  left.height === right.height &&
  left.spacing[0] === right.spacing[0] &&
  left.spacing[1] === right.spacing[1] &&
  left.pixelToWorld.every(
    (value, index) => value === right.pixelToWorld[index]
  );

/** Owns only the binary qualification plane needed by normal labelmap rendering. */
export function useEnFaceLabelmaps(
  geometry: MaybeRef<MeasurementPlaneGeometry | null>,
  measurement: MaybeRef<OccupiedDepthResult | null>,
  threshold: MaybeRef<number>,
  micronsPerVoxel: MaybeRef<number>
) {
  const image = vtkImageData.newInstance();
  const scalars = vtkDataArray.newInstance({
    numberOfComponents: 1,
    values: new Uint8Array(1),
  });
  image.getPointData().setScalars(scalars);
  const pixels = computed(() => {
    const result = unref(measurement);
    return result
      ? createThinRegionMask(result, unref(threshold), unref(micronsPerVoxel))
      : null;
  });
  watch(
    [() => unref(geometry), pixels],
    ([plane, values], [previousPlane, previousValues]) => {
      if (!plane || !values) return;
      const [sx, sy] = plane.spacing;
      if (values === previousValues && sameGeometry(plane, previousPlane))
        return;
      image.setDimensions(plane.width, plane.height, 1);
      image.setSpacing([sx, sy, 1]);
      image.setOrigin(
        vec3.transformMat4(
          [0, 0, 0],
          [0.5, 0.5, 0],
          plane.pixelToWorld
        ) as Vector3
      );
      image.setDirection([
        plane.pixelToWorld[0] / sx,
        plane.pixelToWorld[1] / sx,
        plane.pixelToWorld[2] / sx,
        plane.pixelToWorld[4] / sy,
        plane.pixelToWorld[5] / sy,
        plane.pixelToWorld[6] / sy,
        plane.pixelToWorld[8],
        plane.pixelToWorld[9],
        plane.pixelToWorld[10],
      ]);
      scalars.setData(values, 1);
      image.modified();
    },
    { immediate: true }
  );
  onScopeDispose(() => {
    image.delete();
    scalars.delete();
  });
  return computed(() => (unref(geometry) && pixels.value ? image : null));
}
