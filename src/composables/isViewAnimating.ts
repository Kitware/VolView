import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import { computed, ref, unref } from 'vue';
import { MaybeRef } from '@vueuse/core';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { View } from '@/src/core/vtk/useVtkView';

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
export function isViewAnimatingNew(view: View) {
  const isAnimating = ref(false);

  onVTKEvent(view.interactor, 'onStartAnimation', () => {
    isAnimating.value = true;
  });
  onVTKEvent(view.interactor, 'onEndAnimation', () => {
    isAnimating.value = false;
  });

  return isAnimating;
}
