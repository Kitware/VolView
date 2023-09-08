import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { LPSAxisDir } from '@/src/types/lps';
import { FrameOfReference } from '@/src/utils/frameOfReference';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import { Vector3 } from '@kitware/vtk.js/types';
import { vec3 } from 'gl-matrix';
import { computed, unref } from 'vue';
import type { ComputedRef, MaybeRef, Ref } from 'vue';

export function useCurrentFrameOfReference(
  viewDirection: MaybeRef<LPSAxisDir>,
  currentSlice: Ref<number>
): ComputedRef<FrameOfReference> {
  const viewAxis = computed(() => getLPSAxisFromDir(unref(viewDirection)));
  const { currentImageMetadata } = useCurrentImage();

  return computed(() => {
    const { lpsOrientation, indexToWorld } = currentImageMetadata.value;
    const planeNormal = lpsOrientation[unref(viewDirection)] as Vector3;

    const lpsIdx = lpsOrientation[viewAxis.value];
    const planeOrigin: Vector3 = [0, 0, 0];
    planeOrigin[lpsIdx] = currentSlice.value;
    // convert index pt to world pt
    vec3.transformMat4(planeOrigin, planeOrigin, indexToWorld);

    return {
      planeNormal,
      planeOrigin,
    };
  });
}
