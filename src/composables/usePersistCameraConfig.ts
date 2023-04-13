import { manageVTKSubscription } from '@src/composables/manageVTKSubscription';
import { Ref } from 'vue';
import { useViewConfigStore } from '../store/view-configs';
import { CameraConfig } from '../store/view-configs/types';
import { vtkLPSViewProxy } from '../types/vtk-types';

export function usePersistCameraConfig(
  viewID: Ref<string>,
  dataID: Ref<string | null>,
  viewProxy: Ref<vtkLPSViewProxy>,
  ...toPersist: (keyof CameraConfig)[]
) {
  const viewConfigStore = useViewConfigStore();
  let persistCameraConfig = true;

  // We setup this list of functions to avoid if and indexOf in the onModified
  // call.
  const persist: (() => void)[] = [];

  if (toPersist.indexOf('position') > -1) {
    persist.push(() => {
      if (dataID.value !== null && persistCameraConfig) {
        viewConfigStore.updateCameraConfig(viewID.value, dataID.value, {
          position: viewProxy.value.getCamera().getPosition(),
        });
      }
    });
  }
  if (toPersist.indexOf('viewUp') > -1) {
    persist.push(() => {
      if (dataID.value !== null && persistCameraConfig) {
        viewConfigStore.updateCameraConfig(viewID.value, dataID.value, {
          viewUp: viewProxy.value.getCamera().getViewUp(),
        });
      }
    });
  }
  if (toPersist.indexOf('focalPoint') > -1) {
    persist.push(() => {
      if (dataID.value !== null && persistCameraConfig) {
        viewConfigStore.updateCameraConfig(viewID.value, dataID.value, {
          focalPoint: viewProxy.value.getCamera().getFocalPoint(),
        });
      }
    });
  }
  if (toPersist.indexOf('directionOfProjection') > -1) {
    persist.push(() => {
      if (dataID.value !== null && persistCameraConfig) {
        viewConfigStore.updateCameraConfig(viewID.value, dataID.value, {
          directionOfProjection: viewProxy.value
            .getCamera()
            .getDirectionOfProjection(),
        });
      }
    });
  }
  if (toPersist.indexOf('parallelScale') > -1) {
    persist.push(() => {
      if (dataID.value !== null && persistCameraConfig) {
        viewConfigStore.updateCameraConfig(viewID.value, dataID.value, {
          parallelScale: viewProxy.value.getCamera().getParallelScale(),
        });
      }
    });
  }

  manageVTKSubscription(
    viewProxy.value.getCamera().onModified(() => {
      persist.forEach((persistFunc) => persistFunc());
    })
  );

  function blockPersistingCameraConfig(func: () => void) {
    persistCameraConfig = false;
    try {
      func();
    } finally {
      persistCameraConfig = true;
    }
  }

  function restoreCameraConfig(cameraConfig: CameraConfig) {
    blockPersistingCameraConfig(() => {
      toPersist.forEach((key: keyof CameraConfig) => {
        // Parallel scale
        if (key === 'parallelScale' && cameraConfig.parallelScale) {
          viewProxy.value
            .getCamera()
            .setParallelScale(cameraConfig.parallelScale);
        }
        // Position
        else if (key === 'position' && cameraConfig.position) {
          const { position } = cameraConfig;
          viewProxy.value
            .getCamera()
            .setPosition(position[0], position[1], position[2]);
        }
        // Focal point
        else if (key === 'focalPoint' && cameraConfig.focalPoint) {
          const { focalPoint } = cameraConfig;
          viewProxy.value
            .getCamera()
            .setFocalPoint(focalPoint[0], focalPoint[1], focalPoint[2]);
          viewProxy.value
            .getInteractorStyle2D()
            .setCenterOfRotation([...focalPoint]);
          viewProxy.value
            .getInteractorStyle3D()
            .setCenterOfRotation([...focalPoint]);
        }
        // Direction of projection
        else if (
          key === 'directionOfProjection' &&
          cameraConfig.directionOfProjection
        ) {
          const { directionOfProjection } = cameraConfig;
          viewProxy.value
            .getCamera()
            .setDirectionOfProjection(
              directionOfProjection[0],
              directionOfProjection[1],
              directionOfProjection[2]
            );
        }
        // View up
        else if (key === 'viewUp' && cameraConfig.viewUp) {
          const { viewUp } = cameraConfig;
          viewProxy.value
            .getCamera()
            .setViewUp(viewUp[0], viewUp[1], viewUp[2]);
        }
      });
    });
  }

  return { restoreCameraConfig };
}
