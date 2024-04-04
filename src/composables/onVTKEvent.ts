import { Maybe } from '@/src/types';
import { vtkObject, vtkSubscription } from '@kitware/vtk.js/interfaces';
import { MaybeRef, computed, onScopeDispose, unref, watch } from 'vue';

export type VTKEventHandler = (ev?: any) => any;
export type VTKEventListener = (
  handler: VTKEventHandler,
  priority?: number
) => vtkSubscription;
export type OnVTKEventOptions = {
  priority?: number;
};

export function onVTKEvent<T extends vtkObject, K extends keyof T>(
  vtkObj: MaybeRef<Maybe<T>>,
  eventHookName: T[K] extends VTKEventListener ? K : never,
  callback: VTKEventHandler,
  options?: OnVTKEventOptions
) {
  const listenerRef = computed(() => {
    const obj = unref(vtkObj);
    return obj ? (obj[eventHookName] as VTKEventListener) : null;
  });

  let subscription: Maybe<vtkSubscription> = null;

  const cleanup = () => {
    subscription?.unsubscribe();
    subscription = null;
  };

  const stop = watch(
    listenerRef,
    (listener) => {
      cleanup();
      if (listener) {
        subscription = listener(callback, options?.priority ?? 0);
      }
    },
    { immediate: true }
  );

  onScopeDispose(() => {
    cleanup();
  });

  return {
    stop: () => {
      cleanup();
      stop();
    },
  };
}
