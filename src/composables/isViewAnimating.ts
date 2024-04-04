import { ref } from 'vue';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { View } from '@/src/core/vtk/types';

export function isViewAnimating(view: View) {
  const isAnimating = ref(false);

  onVTKEvent(view.interactor, 'onStartAnimation', () => {
    isAnimating.value = true;
  });
  onVTKEvent(view.interactor, 'onEndAnimation', () => {
    isAnimating.value = false;
  });

  return isAnimating;
}
