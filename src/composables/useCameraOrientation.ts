import { computed, Ref } from '@vue/composition-api';
import { mat3 } from 'gl-matrix';
import { ImageMetadata } from '../storex/datasets-images';
import { getLPSDirections, LPSAxisDir } from '../utils/lps';

/**
 *
 * @param {Ref<LPSAxisDir>} viewDirection an LPS view look-direction
 * @param {Ref<LPSAxisDir>} viewUp an LPS view up-direction
 * @param {Ref<ImageMetadata>} imageMetadataRef image metadata
 */
export function useCameraOrientation(
  viewDirection: Ref<LPSAxisDir>,
  viewUp: Ref<LPSAxisDir>,
  imageMetadataRef: Ref<ImageMetadata>
) {
  const orientationMatrix = computed(
    () => imageMetadataRef.value.orientation as mat3
  );
  const lpsDirections = computed(() =>
    getLPSDirections(orientationMatrix.value)
  );
  const cameraDirVec = computed(() => lpsDirections.value[viewDirection.value]);
  const cameraUpVec = computed(() => lpsDirections.value[viewUp.value]);

  return {
    cameraDirVec,
    cameraUpVec,
  };
}
