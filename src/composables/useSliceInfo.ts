import type { Vector3 } from '@kitware/vtk.js/types';
import type { MaybeRef } from 'vue';
import { computed, unref } from 'vue';
import { useImage } from '@/src/composables/useCurrentImage';
import { Maybe } from '@/src/types';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import { useEffectiveView } from '@/src/composables/useEffectiveView';
import { AXIAL_FRAME_OF_REFERENCE } from '@/src/utils/frameOfReference';
import {
  get2DViewingVectors,
  lpsAxisOfSourceAxis,
} from '@/src/utils/getViewingVectors';
import { useEnFaceViewStore } from '@/src/enface/store';
import { slabDepthRange } from '@/src/core/slab/range';

/** Whether a view shows a slice: its own, or any within an En face slab. */
export const showsSlice = (
  info: Maybe<{ sliceRange: readonly [number, number] }>,
  slice: Maybe<number>
) =>
  !!info &&
  slice != null &&
  slice >= info.sliceRange[0] &&
  slice <= info.sliceRange[1];

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
    if (eff?.kind === 'volume2D')
      return {
        axis: eff.axis,
        slice: slice.value,
        range: [slice.value, slice.value] as const,
      };
    if (eff?.kind !== 'enface') return null;
    const settings = enFaceStore.settingsFor(unref(viewID), unref(imageID));
    const { dimensions, lpsOrientation } = imageMetadata.value;
    const { first, last } = slabDepthRange(settings, dimensions[settings.axis]);
    return {
      axis: lpsAxisOfSourceAxis(settings.axis, lpsOrientation),
      slice: Math.round((first + last) / 2),
      range: [first, last] as const,
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
        sliceRange: [0, 0] as const,
        planeNormal: AXIAL_FRAME_OF_REFERENCE.planeNormal,
        planeOrigin: AXIAL_FRAME_OF_REFERENCE.planeOrigin,
      };
    }

    if (!cursor.value) return null;

    const { axis, slice: currentSlice, range } = cursor.value;
    const { viewDirection } = get2DViewingVectors(axis);
    const { lpsOrientation } = imageMetadata.value;
    const planeOrigin = [0, 0, 0] as Vector3;
    planeOrigin[lpsOrientation[axis]] = currentSlice;
    return {
      axisName: axis,
      axisIndex: lpsOrientation[axis],
      slice: currentSlice,
      sliceRange: range,
      planeNormal: lpsOrientation[viewDirection] as Vector3,
      planeOrigin,
    };
  });
}
