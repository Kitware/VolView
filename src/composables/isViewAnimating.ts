import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import { computed, ref, unref } from '@vue/composition-api';
import { MaybeRef } from '@vueuse/core';
import { useVTKCallback } from './useVTKCallback';

export function isViewAnimating(viewProxy: MaybeRef<vtkViewProxy>) {
  const isAnimating = ref(false);

  const onStartAnimation = useVTKCallback(
    computed(() => unref(viewProxy).getInteractor().onStartAnimation)
  );
  const onEndAnimation = useVTKCallback(
    computed(() => unref(viewProxy).getInteractor().onEndAnimation)
  );

  onStartAnimation(() => {
    isAnimating.value = true;
  });

  onEndAnimation(() => {
    isAnimating.value = false;
  });

  return isAnimating;
}
