import { Maybe } from '@/src/types';
import { vtkObject, vtkSubscription } from '@kitware/vtk.js/interfaces';
import { MaybeRef, computed, onBeforeUnmount, unref, watch } from 'vue';

export type VTKEventHandler = (ev?: any) => any;
export type VTKEventListener = (handler: VTKEventHandler) => vtkSubscription;

export function onVTKEvent<T extends vtkObject, K extends keyof T>(
  vtkObj: MaybeRef<Maybe<T>>,
  eventHookName: T[K] extends VTKEventListener ? K : never,
  callback: VTKEventHandler
) {
  const listenerRef = computed(() => {
    const obj = unref(vtkObj);
    return obj ? (obj[eventHookName] as VTKEventListener) : null;
  });

  let subscription: Maybe<vtkSubscription> = null;
  const stop = () => {
    subscription?.unsubscribe();
    subscription = null;
  };

  watch(
    listenerRef,
    (listener) => {
      stop();
      if (listener) {
        subscription = listener(callback);
      }
    },
    { immediate: true }
  );

  onBeforeUnmount(() => {
    stop();
  });
}
