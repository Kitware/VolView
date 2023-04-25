import { Vector3 } from '@kitware/vtk.js/types';
import { computed, unref } from 'vue';
import { MaybeRef } from '@vueuse/core';
import { getLPSAxisFromDir } from '../utils/lps';
import { useCurrentImage } from './useCurrentImage';
import useViewSliceStore from '../store/view-configs/slicing';

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
  const viewSliceStore = useViewSliceStore();
  const { currentImageMetadata, currentImageID } = useCurrentImage();
  return computed(() => {
    const config = viewSliceStore.getConfig(
      unref(viewID),
      currentImageID.value
    );
    if (!config) {
      return null;
    }

    const { lpsOrientation } = currentImageMetadata.value;
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
  });
}
