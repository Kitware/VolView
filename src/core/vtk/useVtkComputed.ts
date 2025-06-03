import { MaybeRef, computed, unref, ref, Ref } from 'vue';
import type { vtkObject } from '@kitware/vtk.js/interfaces';
import { onPausableVTKEvent } from '@/src/composables/onPausableVTKEvent';
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
export function useVtkComputed<T extends Maybe<vtkObject>, R>(
  obj: MaybeRef<T>,
  propertyGetter: () => R
) {
  const initialValue = propertyGetter();
  const trackedValue = ref(
    Array.isArray(initialValue) ? [...initialValue] : initialValue
  ) as Ref<R>;
  let lastValueIsArray = Array.isArray(initialValue);
  const onModified = batchForNextTask(() => {
    if (unref(obj)?.isDeleted()) return;

    const currentValue = propertyGetter(); // Avoid unnecessary updates when array contents haven't changed
    if (lastValueIsArray && Array.isArray(currentValue)) {
      const previousValue = trackedValue.value;
      if (
        Array.isArray(previousValue) &&
        !arrayEquals(previousValue as any[], currentValue as any[])
      ) {
        trackedValue.value = [...currentValue] as R;
        return;
      }
      return;
    }

    if (Array.isArray(currentValue)) {
      trackedValue.value = [...currentValue] as R;
      lastValueIsArray = true;
    } else {
      trackedValue.value = currentValue;
      lastValueIsArray = false;
    }
  });

  onPausableVTKEvent(obj as vtkObject, 'onModified', onModified);
  return computed(() => {
    return trackedValue.value;
  });
}
