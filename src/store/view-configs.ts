import { defineStore } from 'pinia';

import { setupSlicingConfig } from './view-configs/slicing';
import useWindowingStore from './view-configs/windowing';
import { setupLayersConfig } from './view-configs/layers';
import { setupCameraConfig } from './view-configs/camera';
import { setupVolumeColorConfig } from './view-configs/volume-coloring';
import { StateFile, ViewConfig } from '../io/state-file/schema';
import { useImageStore } from './datasets-images';

/**
 * This store saves view configuration that is associated with a specific
 * view. The key is a synthetic id generated from the view ID and data ID.
 */
export const useViewConfigStore = defineStore('viewConfig', () => {
  const sliceConfig = setupSlicingConfig();
  const windowingStore = useWindowingStore();
  const layersConfig = setupLayersConfig();
  const cameraConfig = setupCameraConfig();
  const volumeColorConfig = setupVolumeColorConfig();

  const removeView = (viewID: string) => {
    sliceConfig.removeView(viewID);
    windowingStore.removeView(viewID);
    layersConfig.removeView(viewID);
    cameraConfig.removeView(viewID);
    volumeColorConfig.removeView(viewID);
  };

  const removeData = (dataID: string, viewID?: string) => {
    sliceConfig.removeData(dataID, viewID);
    windowingStore.removeData(dataID, viewID);
    layersConfig.removeData(dataID, viewID);
    cameraConfig.removeData(dataID, viewID);
    volumeColorConfig.removeData(dataID, viewID);
  };

  const serialize = (stateFile: StateFile) => {
    sliceConfig.serialize(stateFile);
    windowingStore.serialize(stateFile);
    layersConfig.serialize(stateFile);
    cameraConfig.serialize(stateFile);
    volumeColorConfig.serialize(stateFile);
  };

  const deserialize = (
    viewID: string,
    config: Record<string, ViewConfig>,
    dataIDMap: Record<string, string>
  ) => {
    // First update the view config map to use the new dataIDs
    const updatedConfig: Record<string, ViewConfig> = {};
    Object.entries(config).forEach(([dataID, viewConfig]) => {
      const newDataID = dataIDMap[dataID];
      updatedConfig[newDataID] = viewConfig;
    });

    sliceConfig.deserialize(viewID, updatedConfig);
    windowingStore.deserialize(viewID, updatedConfig);
    layersConfig.deserialize(viewID, updatedConfig);
    cameraConfig.deserialize(viewID, updatedConfig);
    volumeColorConfig.deserialize(viewID, updatedConfig);
  };

  // delete hook
  const imageStore = useImageStore();
  imageStore.$onAction(({ name, args }) => {
    if (name === 'deleteData') {
      const [id] = args;
      removeData(id);
    }
  });

  return {
    removeView,
    removeData,
    serialize,
    deserialize,
    ...sliceConfig.actions,
    ...cameraConfig.actions,
    ...volumeColorConfig.actions,
    layers: layersConfig.actions,
  };
});
