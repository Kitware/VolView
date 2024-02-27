import { MaybeRef, Ref, computed, customRef, triggerRef, unref } from 'vue';
import { vtkObject } from '@kitware/vtk.js/interfaces';
import { capitalize } from '@kitware/vtk.js/macros';
import { onPausableVTKEvent } from '@/src/composables/onPausableVTKEvent';
import { batchForNextTask } from '@/src/utils/batchForNextTask';

type NonEmptyString<T extends string> = T extends '' ? never : T;

type FilterGetters<T extends string> = T extends `get${infer R}`
  ? NonEmptyString<Uncapitalize<R>>
  : never;

type GettableFields<T> = FilterGetters<string & keyof T>;

type NameToGetter<T extends string> = `get${Capitalize<T>}`;

type GetterReturnType<T, F extends string> = NameToGetter<F> extends keyof T
  ? T[NameToGetter<F>] extends (...args: any[]) => infer R
    ? R
    : never
  : never;

type ArraySetter = (...args: any[]) => boolean;

export function vtkFieldRef<T extends vtkObject, F extends GettableFields<T>>(
  obj: MaybeRef<T>,
  fieldName: F
): Ref<GetterReturnType<T, F>> {
  const getterName = `get${capitalize(fieldName)}` as keyof T;
  const setterName = `set${capitalize(fieldName)}` as keyof T;

  const getter = computed(
    () => unref(obj)[getterName] as () => GetterReturnType<T, F>
  );
  const setter = computed(
    () => unref(obj)[setterName] as ((v: any) => boolean) | undefined
  );

  let pause: () => void;
  let resume: () => void;

  const ref = customRef<GetterReturnType<T, F>>((track, trigger) => {
    return {
      get: () => {
        track();
        return getter.value();
      },
      set: (v) => {
        const set = setter.value;
        if (!set) throw new Error(`No setter for field '${fieldName}'`);

        let changed = false;
        pause();

        try {
          // handle certain array setters not accepting an array as input
          if (Array.isArray(v) && set.length === v.length) {
            changed = (set as ArraySetter)(...v);
          } else {
            changed = set(v);
          }
        } finally {
          resume();
        }

        // in the event a setter returns undefined, assume something changed.
        if (changed === true || changed === undefined) {
          trigger();
        }
      },
    };
  });

  const onModified = batchForNextTask(() => {
    triggerRef(ref);
  });

  ({ pause, resume } = onPausableVTKEvent(
    obj as vtkObject,
    'onModified',
    onModified
  ));

  return ref;
}
