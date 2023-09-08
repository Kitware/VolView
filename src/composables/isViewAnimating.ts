import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import { computed, ref, unref } from 'vue';
import { MaybeRef } from '@vueuse/core';
import { onVTKEvent } from '@/src/composables/onVTKEvent';

export function isViewAnimating(viewProxy: MaybeRef<vtkViewProxy>) {
  const isAnimating = ref(false);
  const interactor = computed(() => unref(viewProxy).getInteractor());

  onVTKEvent(interactor, 'onStartAnimation', () => {
    isAnimating.value = true;
  });
  onVTKEvent(interactor, 'onEndAnimation', () => {
    isAnimating.value = false;
  });

  return isAnimating;
}
