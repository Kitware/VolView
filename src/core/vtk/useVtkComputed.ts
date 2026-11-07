import {
  MaybeRef,
  computed,
  unref,
  ref,
  Ref,
  watchEffect,
  onScopeDispose,
} from 'vue';
import type { vtkObject } from '@kitware/vtk.js/interfaces';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { batchForNextTask } from '@/src/utils/batchForNextTask';
import { arrayEquals } from '@/src/utils';
import type { Maybe } from '@/src/types';

/**
 * A computed property that derives a reactive property from a VTK object using a getter function.
 * The computed property updates when the underlying VTK object emits an 'onModified' event.
 *
 * @param vtkObjectRef A Vue Ref or direct reference to a VTK object (or null/undefined).
 * @param propertyGetter A function that computes the property value. It will be called reactively.
 * @returns A read-only ComputedRef to the derived property.
 */
export function useVtkComputed<R>(
  obj: MaybeRef<Maybe<vtkObject>>,
  propertyGetter: () => R
) {
  const trackedValue = ref() as Ref<R>;
  let previousValue: R;
  const refresh = () => {
    if (unref(obj)?.isDeleted()) return;

    const currentValue = propertyGetter(); // Avoid unnecessary updates when array contents haven't changed
    if (Array.isArray(currentValue)) {
      if (
        Array.isArray(previousValue) &&
        arrayEquals<unknown[]>(previousValue, currentValue)
      )
        return;
      previousValue = [...currentValue] as R;
    } else {
      previousValue = currentValue;
    }
    trackedValue.value = previousValue;
  };
  watchEffect(refresh);
  const onModified = batchForNextTask(refresh);
  onScopeDispose(onModified.cancel);

  onVTKEvent(obj, 'onModified', onModified);
  return computed(() => {
    return trackedValue.value;
  });
}
