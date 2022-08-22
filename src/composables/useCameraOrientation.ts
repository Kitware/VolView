import { computed, Ref, unref } from '@vue/composition-api';
import { MaybeRef } from '@vueuse/core';
import { mat3 } from 'gl-matrix';
import { ImageMetadata } from '../store/datasets-images';
import { getLPSDirections, LPSAxisDir } from '../utils/lps';

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
    () => lpsDirections.value[unref(viewDirection)]
  );
  const cameraUpVec = computed(() => lpsDirections.value[unref(viewUp)]);

  return {
    cameraDirVec,
    cameraUpVec,
  };
}
