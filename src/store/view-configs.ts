import { defineStore } from 'pinia';

import { setupSlicingConfig } from './view-configs/slicing';
import { setupWindowingConfig } from './view-configs/windowing';
import { setupCameraConfig } from './view-configs/camera';
import { setupVolumeColorConfig } from './view-configs/volume-coloring';

/**
 * This store saves view configuration that is associated with a specific
 * view. The key is a synthetic id generated from the view ID and data ID.
 */
export const useViewConfigStore = defineStore('viewConfig', () => {
  const sliceConfig = setupSlicingConfig();
  const windowingConfig = setupWindowingConfig();
  const cameraConfig = setupCameraConfig();
  const volumeColorConfig = setupVolumeColorConfig();

  const removeView = (viewID: string) => {
    sliceConfig.removeView(viewID);
    windowingConfig.removeView(viewID);
    cameraConfig.removeView(viewID);
    volumeColorConfig.removeView(viewID);
  };

  const removeData = (dataID: string, viewID?: string) => {
    sliceConfig.removeData(dataID, viewID);
    windowingConfig.removeData(dataID, viewID);
    cameraConfig.removeData(dataID, viewID);
    volumeColorConfig.removeData(dataID, viewID);
  };

  return {
    removeView,
    removeData,
    ...sliceConfig.actions,
    ...windowingConfig.actions,
    ...cameraConfig.actions,
    ...volumeColorConfig.actions,
  };
});
