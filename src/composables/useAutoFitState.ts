import { onPausableVTKEvent } from '@/src/composables/onPausableVTKEvent';
import vtkCamera from '@kitware/vtk.js/Rendering/Core/Camera';
import { MaybeRef, Ref } from 'vue';

export function useAutoFitState(
  camera: MaybeRef<vtkCamera>,
  autoFit: Ref<boolean>
) {
  const { withPaused, pause, resume } = onPausableVTKEvent(
    camera,
    'onModified',
    () => {
      if (autoFit.value) autoFit.value = false;
    }
  );

  // auto-fit state starts off paused
  pause();

  return { autoFit, pause, resume, withPaused };
}
