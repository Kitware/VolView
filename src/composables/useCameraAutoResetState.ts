import { onPausableVTKEvent } from '@/src/composables/onPausableVTKEvent';
import vtkCamera from '@kitware/vtk.js/Rendering/Core/Camera';
import { MaybeRef, ref } from 'vue';

export function useCameraAutoResetState() {
  const cameraAutoResetState = ref(false);

  return { cameraAutoResetState };
}
