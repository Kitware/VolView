import { getImageSpatialExtent } from '@/src/composables/useCurrentImage';
import { LPSAxis } from '@/src/types/lps';
import { getAxisBounds } from '@/src/utils/lps';
import { Vector2 } from '@kitware/vtk.js/types';
import { reactive, readonly, set } from '@vue/composition-api';
import { defineStore } from 'pinia';
import { useImageStore } from '../datasets-images';

export type LPSCroppingPlanes = {
  Sagittal: [number, number];
  Coronal: [number, number];
  Axial: [number, number];
};

function clampRangeToBounds(range: Vector2, bounds: Vector2) {
  return [
    Math.max(bounds[0], Math.min(bounds[1], range[0])),
    Math.max(bounds[0], Math.min(bounds[1], range[1])),
  ] as Vector2;
}

export const useCropStore = defineStore('crop', () => {
  const imageStore = useImageStore();

  const croppingByImageID = reactive<Record<string, LPSCroppingPlanes>>({});

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
    set(croppingByImageID, imageID, clampCroppingPlanes(imageID, planes));
  };

  const setCroppingForAxis = (
    imageID: string,
    axis: LPSAxis,
    planes: Vector2
  ) => {
    if (imageID in croppingByImageID) {
      setCropping(imageID, {
        ...croppingByImageID[imageID],
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

  return {
    croppingByImageID: readonly(croppingByImageID),
    setCropping,
    setCroppingForAxis,
    resetCropping,
  };
});
