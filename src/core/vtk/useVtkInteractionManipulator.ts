import { MaybeRef, computed, ref, unref, watch, watchEffect } from 'vue';
import vtkInteractorStyleManipulator from '@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator';
import { VtkObjectConstructor } from '@/src/core/vtk/types';
import { FirstParam } from '@/src/types';

function addManipulator(style: vtkInteractorStyleManipulator, manip: any) {
  if (manip.isA('vtkCompositeMouseManipulator')) {
    style.addMouseManipulator(manip);
  } else if (manip.isA('vtkCompositeGestureManipulator')) {
    style.addGestureManipulator(manip);
  } else if (manip.isA('vtkCompositeKeyboardManipulator')) {
    style.addKeyboardManipulator(manip);
  }
}

function removeManipulator(style: vtkInteractorStyleManipulator, manip: any) {
  if (manip.isA('vtkCompositeMouseManipulator')) {
    style.removeMouseManipulator(manip);
  } else if (manip.isA('vtkCompositeGestureManipulator')) {
    style.removeGestureManipulator(manip);
  } else if (manip.isA('vtkCompositeKeyboardManipulator')) {
    style.removeKeyboardManipulator(manip);
  }
}

export function useVtkInteractionManipulator<
  T extends VtkObjectConstructor<any>
>(
  style: vtkInteractorStyleManipulator,
  vtkCtor: T,
  props: MaybeRef<FirstParam<T['newInstance']>>
) {
  const manipulator = computed(() => {
    return vtkCtor.newInstance(unref(props));
  });

  const enabled = ref(true);

  watch(manipulator, (_, oldManipulator) => {
    oldManipulator?.delete();
  });

  watchEffect((onCleanup) => {
    if (!enabled.value) return;

    const manip = manipulator.value;
    addManipulator(style, manip);
    onCleanup(() => {
      removeManipulator(style, manip);
    });
  });

  return {
    instance: manipulator,
    enabled,
  };
}
