import type { Vector3 } from '@kitware/vtk.js/types';
import { computed, unref } from 'vue';
import { MaybeRef } from '@vueuse/core';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import { useImage } from '@/src/composables/useCurrentImage';
import useViewSliceStore from '@/src/store/view-configs/slicing';
import { Maybe } from '@/src/types';

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
export function useSliceInfo(
  viewID: MaybeRef<string | null>,
  imageID: MaybeRef<Maybe<string>>
) {
  const viewSliceStore = useViewSliceStore();
  const { metadata: imageMetadata } = useImage(imageID);
  return computed(() => {
    const config = viewSliceStore.getConfig(unref(viewID), unref(imageID));
    if (!config) {
      return null;
    }

    const { lpsOrientation } = imageMetadata.value;
    const axis = getLPSAxisFromDir(config.axisDirection);
    const planeOrigin = [0, 0, 0] as Vector3;
    planeOrigin[lpsOrientation[axis]] = config.slice;
    return {
      axisName: axis,
      axisIndex: lpsOrientation[axis],
      slice: config.slice,
      planeNormal: lpsOrientation[config.axisDirection] as Vector3,
      planeOrigin,
    };
  });
}
