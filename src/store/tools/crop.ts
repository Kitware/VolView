import { getImageSpatialExtent } from '@/src/composables/useCurrentImage';
import { LPSAxis } from '@/src/types/lps';
import { getAxisBounds } from '@/src/utils/lps';
import { NOOP } from '@/src/constants';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import type { Vector2, Vector3 } from '@kitware/vtk.js/types';
import type { MaybeRef } from 'vue';
import { computed, reactive, readonly, unref } from 'vue';
import { vec3 } from 'gl-matrix';
import { defineStore } from 'pinia';
import { arrayEqualsWithComparator } from '@/src/utils';
import { Maybe } from '@/src/types';
import { useImageCacheStore } from '@/src/store/image-cache';
import { LPSCroppingPlanes } from '../../types/crop';
import { ImageMetadata } from '../../types/image';
import { StateFile, Manifest } from '../../io/state-file/schema';

type Plane = {
  origin: Vector3;
  normal: Vector3;
};

function clampRangeToBounds(range: Vector2, bounds: Vector2) {
  return [
    Math.max(bounds[0], Math.min(bounds[1], range[0])),
    Math.max(bounds[0], Math.min(bounds[1], range[1])),
  ] as Vector2;
}

/**
 * Converts a cropping boundary to a plane origin + normal.
 * @param cropBounds
 * @param metadata
 * @param axis
 * @param lowerUpper 0 for the lower boundary, 1 for the upper boundary
 * @returns
 */
function convertCropBoundaryToPlane(
  cropBounds: LPSCroppingPlanes,
  metadata: ImageMetadata,
  axis: LPSAxis,
  lowerUpper: 0 | 1
): Plane {
  const { indexToWorld, orientation, lpsOrientation: lpsDirs } = metadata;

  const origin = [0, 0, 0] as Vector3;
  const axisIndex = lpsDirs[axis];
  origin[axisIndex] = cropBounds[axis][lowerUpper];
  vec3.transformMat4(origin, origin, indexToWorld);

  // The lower bound normal is the associated column in the
  // image orientation matrix. The upper bound normal is the
  // lower bound normal, but negated.
  // 0|1 => 1|-1
  const neg = -(lowerUpper * 2 - 1);
  const normal = [
    ...orientation.slice(axisIndex * 3, axisIndex * 3 + 3).map((c) => c * neg),
  ] as Vector3;

  return { origin, normal };
}

/**
 * Re-orients the lower/upper plane normals to point at each other.
 *
 * Assumes the planes are parallel.
 * @param lowerPlane
 * @param upperPlane
 */
function reorientBoundaryNormals(lowerPlane: Plane, upperPlane: Plane) {
  const lowerToUpper = lowerPlane.normal;
  vec3.sub(lowerToUpper, upperPlane.origin, lowerPlane.origin);
  vec3.normalize(lowerToUpper, lowerToUpper);
  vec3.negate(upperPlane.normal, lowerPlane.normal);
}

export function croppingPlanesEqual(a1: vtkPlane[], a2: vtkPlane[]) {
  return arrayEqualsWithComparator<vtkPlane>(a1, a2, (p1, p2) => {
    return (
      vec3.equals(p1.getOrigin(), p2.getOrigin()) &&
      vec3.equals(p1.getNormal(), p2.getNormal())
    );
  });
}

export const useCropStore = defineStore('crop', () => {
  const imageCacheStore = useImageCacheStore();

  const state = reactive({
    croppingByImageID: {} as Record<string, LPSCroppingPlanes>,
  });

  const getComputedVTKPlanes = (imageID: MaybeRef<Maybe<string>>) =>
    computed(() => {
      const id = unref(imageID);
      const metadata = imageCacheStore.getImageMetadata(id);
      if (id && id in state.croppingByImageID && metadata) {
        const cropBounds = state.croppingByImageID[id];
        const planes = [
          convertCropBoundaryToPlane(cropBounds, metadata, 'Sagittal', 0),
          convertCropBoundaryToPlane(cropBounds, metadata, 'Sagittal', 1),
          convertCropBoundaryToPlane(cropBounds, metadata, 'Coronal', 0),
          convertCropBoundaryToPlane(cropBounds, metadata, 'Coronal', 1),
          convertCropBoundaryToPlane(cropBounds, metadata, 'Axial', 0),
          convertCropBoundaryToPlane(cropBounds, metadata, 'Axial', 1),
        ];

        reorientBoundaryNormals(planes[0], planes[1]);
        reorientBoundaryNormals(planes[2], planes[3]);
        reorientBoundaryNormals(planes[4], planes[5]);

        return planes.map((plane) => vtkPlane.newInstance(plane));
      }
      return null;
    });

  const clampCroppingPlanes = (
    imageID: string,
    planes: LPSCroppingPlanes
  ): LPSCroppingPlanes => {
    const lpsBounds = getImageSpatialExtent(imageID);
    // if perf becomes an issue, change this to modify the planes arg
    return {
      Sagittal: clampRangeToBounds(planes.Sagittal, lpsBounds.Sagittal),
      Coronal: clampRangeToBounds(planes.Coronal, lpsBounds.Coronal),
      Axial: clampRangeToBounds(planes.Axial, lpsBounds.Axial),
    };
  };

  const setCropping = (imageID: string, planes: LPSCroppingPlanes) => {
    state.croppingByImageID[imageID] = clampCroppingPlanes(imageID, planes);
  };

  const setCroppingForAxis = (
    imageID: string,
    axis: LPSAxis,
    planes: Vector2
  ) => {
    if (imageID in state.croppingByImageID) {
      setCropping(imageID, {
        ...state.croppingByImageID[imageID],
        [axis]: planes,
      });
    }
  };

  const resetCropping = (imageID: string) => {
    const image = imageCacheStore.getVtkImageData(imageID);
    if (!image) return;

    const metadata = imageCacheStore.getImageMetadata(imageID);
    if (!metadata) return;

    const { lpsOrientation } = metadata;
    const extent = image.getSpatialExtent();
    setCropping(imageID, {
      Sagittal: getAxisBounds(extent, 'Sagittal', lpsOrientation),
      Coronal: getAxisBounds(extent, 'Coronal', lpsOrientation),
      Axial: getAxisBounds(extent, 'Axial', lpsOrientation),
    });
  };

  function serialize(stateFile: StateFile) {
    const { tools } = stateFile.manifest;
    tools.crop = state.croppingByImageID;
  }

  function deserialize(manifest: Manifest, dataIDMap: Record<string, string>) {
    const cropping = manifest.tools.crop;

    Object.entries(cropping).forEach(([imageID, planes]) => {
      const newImageID = dataIDMap[imageID];
      setCropping(newImageID, planes);
    });
  }

  const activateTool = () => true;
  const deactivateTool = NOOP;

  return {
    croppingByImageID: readonly(state.croppingByImageID),
    getComputedVTKPlanes,
    setCropping,
    setCroppingForAxis,
    resetCropping,
    serialize,
    deserialize,
    activateTool,
    deactivateTool,
  };
});
