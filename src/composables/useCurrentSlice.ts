import { Vector3 } from '@kitware/vtk.js/types';
import { computed } from 'vue';
import { MaybeRef } from '@vueuse/core';
import { useViewConfigStore } from '../store/view-configs';
import { getLPSAxisFromDir } from '../utils/lps';
import { useCurrentImage } from './useCurrentImage';

/**
 * Returns information about the current slice.
 *
 * axisName: the name of the axis
 * axisIndex: corresponding index in an LPS coordinate array
 * number: slice value
 * planeNormal: slice plane normal
 * planeOrigin: slice plane origin
 * @param viewID
 */
export function useCurrentSlice(viewID: MaybeRef<string | null>) {
  const viewConfigStore = useViewConfigStore();
  const currentImage = useCurrentImage();
  const { currentImageMetadata } = currentImage;
  const sliceConfig = viewConfigStore.getComputedSliceConfig(
    viewID,
    currentImage.currentImageID
  );
  return computed(() => {
    const config = sliceConfig.value;
    const { lpsOrientation } = currentImageMetadata.value;
    if (config) {
      const axis = getLPSAxisFromDir(config.axisDirection);
      const planeOrigin = [0, 0, 0] as Vector3;
      planeOrigin[lpsOrientation[axis]] = config.slice;
      return {
        axisName: axis,
        axisIndex: lpsOrientation[axis],
        number: config.slice,
        planeNormal: lpsOrientation[config.axisDirection] as Vector3,
        planeOrigin,
      };
    }
    return null;
  });
}
