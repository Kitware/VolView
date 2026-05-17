import type { Vector3 } from '@kitware/vtk.js/types';
import type { MaybeRef } from 'vue';
import { computed } from 'vue';
import { useImage } from '@/src/composables/useCurrentImage';
import { Maybe } from '@/src/types';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import { useEffectiveView } from '@/src/composables/useEffectiveView';
import { AXIAL_FRAME_OF_REFERENCE } from '@/src/utils/frameOfReference';
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
  const effective = useEffectiveView(viewID);
  const { metadata: imageMetadata } = useImage(imageID);
  const { slice } = useSliceConfig(viewID, imageID);
  return computed(() => {
    const eff = effective.value;
    if (!eff) return null;

    if (eff.kind === 'cine') {
      return {
        axisName: 'Axial' as const,
        axisIndex: 2,
        slice: 0,
        planeNormal: AXIAL_FRAME_OF_REFERENCE.planeNormal,
        planeOrigin: AXIAL_FRAME_OF_REFERENCE.planeOrigin,
      };
    }

    if (eff.kind !== 'volume2D') return null;

    const { axis } = eff;
    const { viewDirection } = get2DViewingVectors(axis);
    const { lpsOrientation } = imageMetadata.value;
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
