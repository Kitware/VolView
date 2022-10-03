import { useDoubleRecord } from '@/src/composables/useDoubleRecord';
import {
  removeDataFromConfig,
  removeViewFromConfig,
  serializeViewConfig,
} from './common';
import { StateFile, ViewConfig } from '../../io/state-file/schema';
import { CameraConfig } from './types';

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

  const serialize = (stateFile: StateFile) => {
    serializeViewConfig(stateFile, getCameraConfig, 'camera');
  };

  const deserialize = (viewID: string, config: Record<string, ViewConfig>) => {
    Object.entries(config).forEach(([dataID, viewConfig]) => {
      if (viewConfig.camera) {
        cameraConfigs.set(viewID, dataID, viewConfig.camera);
      }
    });
  };

  return {
    removeView: removeViewFromConfig(cameraConfigs),
    removeData: removeDataFromConfig(cameraConfigs),
    serialize,
    deserialize,
    actions: {
      getCameraConfig,
      updateCameraConfig,
    },
  };
};
