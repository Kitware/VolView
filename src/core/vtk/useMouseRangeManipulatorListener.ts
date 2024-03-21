import { Maybe } from '@/src/types';
import { watchCompare } from '@/src/utils/watchCompare';
import vtkMouseRangeManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseRangeManipulator';
import { capitalize } from '@kitware/vtk.js/macros';
import { MaybeRef, ref, toRef, unref } from 'vue';
import deepEqual from 'fast-deep-equal';

type ListenerType = 'vertical' | 'horizontal' | 'scroll';

const DEFAULT_STEP = 1;

export function useMouseRangeManipulatorListener(
  manipulator: MaybeRef<Maybe<vtkMouseRangeManipulator>>,
  type: ListenerType,
  range: MaybeRef<Maybe<[number, number]>>,
  step: MaybeRef<Maybe<number>>,
  initialValue?: number
) {
  const internalValue = ref(initialValue ?? 0);

  watchCompare(
    [toRef(range), toRef(step), toRef(manipulator)],
    ([newRange, , manip], _, onCleanup) => {
      if (!newRange || !manip) return;

      const setterName = `set${
        capitalize(type) as Capitalize<ListenerType>
      }Listener` as const;
      const removerName = `remove${
        capitalize(type) as Capitalize<ListenerType>
      }Listener` as const;

      manip[setterName](
        newRange[0],
        newRange[1],
        unref(step) ?? DEFAULT_STEP,
        () => internalValue.value,
        (val) => {
          internalValue.value = val;
        }
      );

      onCleanup(() => {
        manip[removerName]();
      });
    },
    {
      immediate: true,
      compare: deepEqual,
    }
  );

  return internalValue;
}
