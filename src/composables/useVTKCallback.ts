import { vtkSubscription } from '@kitware/vtk.js/interfaces';
import { isRef, onUnmounted, watchEffect } from '@vue/composition-api';
import { MaybeRef } from '@vueuse/core';

type Listener = (obj: any) => void;
type VTKCallback = (listener: Listener) => vtkSubscription;

export function useVTKCallback(
  callback: MaybeRef<VTKCallback | null | undefined>
) {
  const handleListener = (listener: Listener) => {
    let subscription: vtkSubscription | null = null;

    const cleanup = () => {
      subscription?.unsubscribe();
      subscription = null;
    };
    onUnmounted(cleanup);

    if (isRef(callback)) {
      watchEffect(() => {
        cleanup();
        if (callback.value) {
          subscription = callback.value(listener);
        }
      });
    } else if (callback) {
      subscription = callback(listener);
    }
  };

  return handleListener;
}
