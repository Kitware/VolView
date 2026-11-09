import type { Vector3 } from '@kitware/vtk.js/types';
import type { MaybeRef } from 'vue';
import { computed, unref } from 'vue';
import { useImage } from '@/src/composables/useCurrentImage';
import { Maybe } from '@/src/types';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import { useEffectiveView } from '@/src/composables/useEffectiveView';
import { AXIAL_FRAME_OF_REFERENCE } from '@/src/utils/frameOfReference';
import { get2DViewingVectors } from '@/src/utils/getViewingVectors';
import { useEnFaceViewStore } from '@/src/enface/store';
import { clampValue } from '@/src/utils';
import { LPSAxes } from '@/src/utils/lps';

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
  const enFaceStore = useEnFaceViewStore();
  const cursor = computed(() => {
    const eff = effective.value;
    if (eff?.kind === 'volume2D') return { axis: eff.axis, slice: slice.value };
    if (eff?.kind !== 'enface') return null;
    const settings = enFaceStore.settingsFor(unref(viewID), unref(imageID));
    const { dimensions, lpsOrientation } = imageMetadata.value;
    const maximum = Math.max(0, dimensions[settings.axis] - 1);
    const first = clampValue(settings.depthStart, 0, maximum);
    const last = clampValue(settings.depthEnd ?? maximum, first, maximum);
    return {
      axis: LPSAxes.find((axis) => lpsOrientation[axis] === settings.axis)!,
      slice: Math.round((first + last) / 2),
    };
  });
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

    if (!cursor.value) return null;

    const { axis, slice: currentSlice } = cursor.value;
    const { viewDirection } = get2DViewingVectors(axis);
    const { lpsOrientation } = imageMetadata.value;
    const planeOrigin = [0, 0, 0] as Vector3;
    planeOrigin[lpsOrientation[axis]] = currentSlice;
    return {
      axisName: axis,
      axisIndex: lpsOrientation[axis],
      slice: currentSlice,
      planeNormal: lpsOrientation[viewDirection] as Vector3,
      planeOrigin,
    };
  });
}
