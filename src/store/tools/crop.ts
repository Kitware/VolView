import { getImageSpatialExtent } from '@/src/composables/useCurrentImage';
import { LPSAxis } from '@/src/types/lps';
import { getAxisBounds } from '@/src/utils/lps';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import { Vector2, Vector3 } from '@kitware/vtk.js/types';
import { computed, reactive, readonly, set, unref } from '@vue/composition-api';
import { MaybeRef } from '@vueuse/core';
import { vec3 } from 'gl-matrix';
import { defineStore } from 'pinia';
import { useImageStore } from '../datasets-images';
import { LPSCroppingPlanes } from './types';
import { ImageMetadata } from '../../types/image';
import { StateFile, Manifest } from '../../io/state-file/schema';

function clampRangeToBounds(range: Vector2, bounds: Vector2) {
  return [
    Math.max(bounds[0], Math.min(bounds[1], range[0])),
    Math.max(bounds[0], Math.min(bounds[1], range[1])),
  ] as Vector2;
}

function convertCropBoundsToVTKPlane(
  cropBounds: LPSCroppingPlanes,
  metadata: ImageMetadata,
  axis: LPSAxis,
  lowerUpper: 0 | 1
) {
  const { indexToWorld, orientation, lpsOrientation: lpsDirs } = metadata;

  const origin = [0, 0, 0] as Vector3;
  const axisIndex = lpsDirs[axis];
  origin[axisIndex] = cropBounds[axis][lowerUpper];
  vec3.transformMat4(origin, origin, indexToWorld);

  // The lower bound normal is the associated column in the
  // image orientation matrix. The upper bound normal is the
  // lower bound normal, but negated.
  const neg = -(lowerUpper * 2 - 1);
  const normal = [
    ...orientation.slice(axisIndex * 3, axisIndex * 3 + 3).map((c) => c * neg),
  ] as Vector3;

  return vtkPlane.newInstance({ origin, normal });
}

export const useCropStore = defineStore('crop', () => {
  const imageStore = useImageStore();

  const state = reactive({
    croppingByImageID: {} as Record<string, LPSCroppingPlanes>,
  });

  const getComputedVTKPlanes = (imageID: MaybeRef<string | null>) =>
    computed(() => {
      const id = unref(imageID);
      if (id && id in state.croppingByImageID && id in imageStore.metadata) {
        const cropBounds = state.croppingByImageID[id];
        const metadata = imageStore.metadata[id];
        return [
          convertCropBoundsToVTKPlane(cropBounds, metadata, 'Sagittal', 0),
          convertCropBoundsToVTKPlane(cropBounds, metadata, 'Sagittal', 1),
          convertCropBoundsToVTKPlane(cropBounds, metadata, 'Coronal', 0),
          convertCropBoundsToVTKPlane(cropBounds, metadata, 'Coronal', 1),
          convertCropBoundsToVTKPlane(cropBounds, metadata, 'Axial', 0),
          convertCropBoundsToVTKPlane(cropBounds, metadata, 'Axial', 1),
        ];
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
    set(state.croppingByImageID, imageID, clampCroppingPlanes(imageID, planes));
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
    const image = imageStore.dataIndex[imageID];
    if (!image) return;

    const { lpsOrientation } = imageStore.metadata[imageID];
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

  return {
    croppingByImageID: readonly(state.croppingByImageID),
    getComputedVTKPlanes,
    setCropping,
    setCroppingForAxis,
    resetCropping,
    serialize,
    deserialize,
  };
});
