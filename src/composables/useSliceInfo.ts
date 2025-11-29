import type { Vector3 } from '@kitware/vtk.js/types';
import type { MaybeRef } from 'vue';
import { computed, unref } from 'vue';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import { useImage } from '@/src/composables/useCurrentImage';
import { Maybe } from '@/src/types';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import { useViewStore } from '@/src/store/views';
import { get2DViewingVectors } from '@/src/utils/getViewingVectors';

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
  viewID: MaybeRef<string>,
  imageID: MaybeRef<Maybe<string>>
) {
  const viewStore = useViewStore();
  const { metadata: imageMetadata } = useImage(imageID);
  const view = computed(() => viewStore.getView(unref(viewID)));
  const { slice } = useSliceConfig(viewID, imageID);
  return computed(() => {
    if (!view.value || view.value.type !== '2D') return null;

    const { orientation } = view.value.options;
    const { viewDirection } = get2DViewingVectors(orientation);
    const { lpsOrientation } = imageMetadata.value;
    const axis = getLPSAxisFromDir(viewDirection);
    const planeOrigin = [0, 0, 0] as Vector3;
    planeOrigin[lpsOrientation[axis]] = slice.value;
    return {
      axisName: axis,
      axisIndex: lpsOrientation[axis],
      slice: slice.value,
      planeNormal: lpsOrientation[viewDirection] as Vector3,
      planeOrigin,
    };
  });
}
