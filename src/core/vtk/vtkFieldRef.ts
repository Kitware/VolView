import { MaybeRef, Ref, computed, customRef, triggerRef, unref } from 'vue';
import { vtkObject } from '@kitware/vtk.js/interfaces';
import { capitalize } from '@kitware/vtk.js/macros';
import { onPausableVTKEvent } from '@/src/composables/onPausableVTKEvent';
import { batchForNextTask } from '@/src/utils/batchForNextTask';
import { Maybe } from '@/src/types';

type NonEmptyString<T extends string> = T extends '' ? never : T;

type FilterGetters<T extends string> = T extends `get${infer R}`
  ? NonEmptyString<Uncapitalize<R>>
  : never;

type GettableFields<T> = FilterGetters<string & keyof T>;

type NameToGetter<T extends string> = `get${Capitalize<T>}`;

type Just<T> = Exclude<T, null | undefined>;

type GetterReturnType<T, F extends string> = T extends null | undefined
  ? undefined
  : NameToGetter<F> extends keyof T
  ? T[NameToGetter<F>] extends (...args: any[]) => infer R
    ? R
    : never
  : never;

type ArraySetter = (...args: any[]) => boolean;

export type GetterSetterFactory<T> = {
  get(): T;
  set(v: T): boolean | undefined;
};

/**
 * A custom set/get vtk object ref that operates based on the given field name.
 * @param obj
 * @param fieldName
 */
export function vtkFieldRef<
  T extends Maybe<vtkObject>,
  F extends GettableFields<Just<T>>
>(obj: MaybeRef<T>, fieldName: F): Ref<GetterReturnType<T, F>>;

/**
 * A customRef wrapper that triggers the ref based on a vtk object modification event.
 * @param obj
 * @param factory
 */
export function vtkFieldRef<T extends Maybe<vtkObject>, R>(
  obj: MaybeRef<T>,
  factory: GetterSetterFactory<R>
): Ref<R>;

export function vtkFieldRef<T extends Maybe<vtkObject>>(
  obj: MaybeRef<T>,
  fieldNameOrFactory: string | GetterSetterFactory<any>
): any {
  let getter: () => any;
  let setter: (v: any) => boolean | undefined;
  let lastValue: any;
  let lastValueIsArray = false;

  if (typeof fieldNameOrFactory === 'string') {
    const getterName = `get${capitalize(fieldNameOrFactory)}` as keyof T;
    const setterName = `set${capitalize(fieldNameOrFactory)}` as keyof T;

    const _getter = computed(
      () => unref(obj)?.[getterName] as (() => any) | undefined
    );
    const _setter = computed(
      () =>
        unref(obj)?.[setterName] as ((...args: any[]) => boolean) | undefined
    );

    const notNull = computed(() => !!unref(obj));
    const hasSetter = computed(() => {
      const val = unref(obj);
      return val ? setterName in val : false;
    });

    getter = () => {
      const value = _getter.value?.();
      // If the value is an array, create a new reference to avoid mutation issues
      if (Array.isArray(value)) {
        lastValue = [...value];
        lastValueIsArray = true;
        return lastValue;
      }
      lastValue = value;
      lastValueIsArray = false;
      return value;
    };

    setter = (v: any) => {
      const set = _setter.value;
      if (!notNull.value) return false;
      if (!hasSetter.value || !set)
        throw new Error(`No setter for field '${fieldNameOrFactory}'`);

      // handle certain array setters not accepting an array as input
      if (Array.isArray(v) && set.length === v.length) {
        return (set as ArraySetter)(...v);
      }
      return set(v);
    };
  } else {
    const originalGetter = fieldNameOrFactory.get;
    getter = () => {
      const value = originalGetter();
      // If the value is an array, create a new reference to avoid mutation issues
      if (Array.isArray(value)) {
        lastValue = [...value];
        lastValueIsArray = true;
        return lastValue;
      }
      lastValue = value;
      lastValueIsArray = false;
      return value;
    };
    setter = fieldNameOrFactory.set;
  }

  let pause: () => void;
  let resume: () => void;

  const ref = customRef<any>((track, trigger) => {
    return {
      get: () => {
        track();
        return getter();
      },
      set: (v) => {
        let changed = false;
        pause();

        try {
          const ret = setter(v);
          // in the event a setter returns undefined, assume something changed.
          changed = ret === undefined ? true : ret;
        } finally {
          resume();
        }

        if (changed) {
          trigger();
        }
      },
    };
  });

  const onModified = batchForNextTask(() => {
    if (unref(obj)?.isDeleted()) return;

    // Special handling for array values that might have been mutated
    if (lastValueIsArray) {
      const currentValue = getter();
      if (Array.isArray(currentValue)) {
        const previousValue = lastValue;
        // Check if array contents changed
        if (
          previousValue.length !== currentValue.length ||
          previousValue.some(
            (val: any, idx: number) => val !== currentValue[idx]
          )
        ) {
          // Values changed, trigger the ref
          triggerRef(ref);
          return;
        }
      }
    }

    // Always trigger for non-array values
    triggerRef(ref);
  });

  ({ pause, resume } = onPausableVTKEvent(
    obj as vtkObject,
    'onModified',
    onModified
  ));

  return ref;
}
