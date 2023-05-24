import { ref } from 'vue';
import vtkCamera from '@kitware/vtk.js/Rendering/Core/Camera';
import { manageVTKSubscription } from '@src/composables/manageVTKSubscription';
import { vec3 } from 'gl-matrix';

export function useResizeToFit(
  camera: vtkCamera,
  initialValue: boolean = false
) {
  const resizeToFit = ref(initialValue);

  let trackResizeToFit = true;
  const cachedCameraInfo = {
    position: [0, 0, 0] as vec3,
    parallelScale: 0,
  };

  manageVTKSubscription(
    camera.onModified(() => {
      if (trackResizeToFit && resizeToFit.value) {
        const position = camera.getPosition();
        const parallelScale = camera.getParallelScale();
        if (
          !vec3.equals(position, cachedCameraInfo.position) ||
          parallelScale !== cachedCameraInfo.parallelScale
        ) {
          resizeToFit.value = false;
        }
      }
    })
  );

  function ignoreResizeToFitTracking(cb: () => void) {
    if (trackResizeToFit) {
      trackResizeToFit = false;
      try {
        cb();
      } finally {
        trackResizeToFit = true;
      }
    }
  }

  function resetResizeToFitTracking() {
    cachedCameraInfo.position = camera.getPosition();
    cachedCameraInfo.parallelScale = camera.getParallelScale();
  }

  return { resizeToFit, ignoreResizeToFitTracking, resetResizeToFitTracking };
}
