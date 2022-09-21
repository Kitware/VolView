import { Vector3 } from '@kitware/vtk.js/types';
import { useDoubleRecord } from '@/src/composables/useDoubleRecord';
import { removeDataFromConfig, removeViewFromConfig } from './common';

export interface CameraConfig {
  parallelScale?: number;
  position?: Vector3;
  focalPoint?: Vector3;
  directionOfProjection?: Vector3;
  viewUp?: Vector3;
}

export const setupCameraConfig = () => {
  // (viewID, dataID) -> CameraConfig
  const cameraConfigs = useDoubleRecord<CameraConfig>();

  const getCameraConfig = (viewID: string, dataID: string) =>
    cameraConfigs.get(viewID, dataID);

  const updateCameraConfig = (
    viewID: string,
    dataID: string,
    update: Partial<CameraConfig>
  ) => {
    const config = {
      ...cameraConfigs.get(viewID, dataID),
      ...update,
    };
    cameraConfigs.set(viewID, dataID, config);
  };

  return {
    removeView: removeViewFromConfig(cameraConfigs),
    removeData: removeDataFromConfig(cameraConfigs),
    actions: {
      getCameraConfig,
      updateCameraConfig,
    },
  };
};
