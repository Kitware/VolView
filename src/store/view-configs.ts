import { defineStore } from 'pinia';

import useViewSliceStore from './view-configs/slicing';
import useWindowingStore from './view-configs/windowing';
import { setupLayersConfig } from './view-configs/layers';
import useViewCameraStore from './view-configs/camera';
import { setupVolumeColorConfig } from './view-configs/volume-coloring';
import { StateFile, ViewConfig } from '../io/state-file/schema';
import { useImageStore } from './datasets-images';

/**
 * This store saves view configuration that is associated with a specific
 * view. The key is a synthetic id generated from the view ID and data ID.
 */
export const useViewConfigStore = defineStore('viewConfig', () => {
  const viewSliceStore = useViewSliceStore();
  const windowingStore = useWindowingStore();
  const layersConfig = setupLayersConfig();
  const viewCameraStore = useViewCameraStore();
  const volumeColorConfig = setupVolumeColorConfig();

  const removeView = (viewID: string) => {
    viewSliceStore.removeView(viewID);
    windowingStore.removeView(viewID);
    layersConfig.removeView(viewID);
    viewCameraStore.removeView(viewID);
    volumeColorConfig.removeView(viewID);
  };

  const removeData = (dataID: string, viewID?: string) => {
    viewSliceStore.removeData(dataID, viewID);
    windowingStore.removeData(dataID, viewID);
    layersConfig.removeData(dataID, viewID);
    viewCameraStore.removeData(dataID, viewID);
    volumeColorConfig.removeData(dataID, viewID);
  };

  const serialize = (stateFile: StateFile) => {
    viewSliceStore.serialize(stateFile);
    windowingStore.serialize(stateFile);
    layersConfig.serialize(stateFile);
    viewCameraStore.serialize(stateFile);
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

    viewSliceStore.deserialize(viewID, updatedConfig);
    windowingStore.deserialize(viewID, updatedConfig);
    layersConfig.deserialize(viewID, updatedConfig);
    viewCameraStore.deserialize(viewID, updatedConfig);
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
    ...volumeColorConfig.actions,
    layers: layersConfig.actions,
  };
});
