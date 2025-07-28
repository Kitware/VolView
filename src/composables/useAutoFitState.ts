import { onPausableVTKEvent } from '@/src/composables/onPausableVTKEvent';
import vtkCamera from '@kitware/vtk.js/Rendering/Core/Camera';
import { MaybeRef, ref } from 'vue';

export function useAutoFitState(camera: MaybeRef<vtkCamera>) {
  const autoFit = ref(true);

  const { withPaused, pause, resume } = onPausableVTKEvent(
    camera,
    'onModified',
    () => {
      autoFit.value = false;
    }
  );

  // auto-fit state starts off paused
  pause();

  return { autoFit, pause, resume, withPaused };
}
