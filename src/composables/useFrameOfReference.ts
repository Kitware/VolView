import { ImageMetadata } from '@/src/types/image';
import { LPSAxisDir } from '@/src/types/lps';
import { FrameOfReference } from '@/src/utils/frameOfReference';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import { Vector3 } from '@kitware/vtk.js/types';
import { vec3 } from 'gl-matrix';
import { computed, unref } from 'vue';
import type { ComputedRef, MaybeRef } from 'vue';

export function useFrameOfReference(
  viewDirection: MaybeRef<LPSAxisDir>,
  slice: MaybeRef<number>,
  imageMetadata: MaybeRef<ImageMetadata>
): ComputedRef<FrameOfReference> {
  const viewAxis = computed(() => getLPSAxisFromDir(unref(viewDirection)));

  return computed(() => {
    const { lpsOrientation, indexToWorld } = unref(imageMetadata);
    const planeNormal = lpsOrientation[unref(viewDirection)] as Vector3;

    const lpsIdx = lpsOrientation[viewAxis.value];
    const planeOrigin: Vector3 = [0, 0, 0];
    planeOrigin[lpsIdx] = unref(slice);
    // convert index pt to world pt
    vec3.transformMat4(planeOrigin, planeOrigin, indexToWorld);

    return {
      planeNormal,
      planeOrigin,
    };
  });
}
