import { computed, Ref } from '@vue/composition-api';
import { vec3 } from 'gl-matrix';
import { LPSAxis, ViewDirection } from '@src/storex/views';
import { LPSDirections } from '@src/composables/useLPSDirections';

export function useCameraOrientation(
  axis: Ref<LPSAxis>,
  viewUp: Ref<ViewDirection>,
  lpsDirections: Ref<LPSDirections>
) {
  const direction = computed(() => lpsDirections.value[axis.value]);

  const up = computed(() => {
    const vec = lpsDirections.value[viewUp.value.axis];
    const sign = viewUp.value.dir === 'Negative' ? -1 : 1;
    return vec.map((c: number) => c * sign) as vec3;
  });

  return {
    direction,
    up,
  };
}
