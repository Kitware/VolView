import type { Vector3 } from '@kitware/vtk.js/types';
import { computed, Ref, unref } from 'vue';
import { MaybeRef } from '@vueuse/core';
import { mat3 } from 'gl-matrix';
import { ImageMetadata } from '@/src/types/image';
import { LPSAxisDir } from '@/src/types/lps';
import { getLPSDirections } from '@/src/utils/lps';

/**
 *
 * @param {Ref<LPSAxisDir>} viewDirection an LPS view look-direction
 * @param {Ref<LPSAxisDir>} viewUp an LPS view up-direction
 * @param {Ref<ImageMetadata>} imageMetadataRef image metadata
 */
export function useCameraOrientation(
  viewDirection: MaybeRef<LPSAxisDir>,
  viewUp: MaybeRef<LPSAxisDir>,
  imageMetadataRef: Ref<ImageMetadata>
) {
  const orientationMatrix = computed(
    () => imageMetadataRef.value.orientation as mat3
  );
  const lpsDirections = computed(() =>
    getLPSDirections(orientationMatrix.value)
  );
  const cameraDirVec = computed(
    () => lpsDirections.value[unref(viewDirection)] as Vector3
  );
  const cameraUpVec = computed(
    () => lpsDirections.value[unref(viewUp)] as Vector3
  );

  return {
    cameraDirVec,
    cameraUpVec,
  };
}
