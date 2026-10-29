import { defineStore } from 'pinia';
import { getLayerId } from '@/src/utils/layers';

import useViewSliceStore from './view-configs/slicing';
import { useWindowingStore } from './view-configs/windowing';
import useLayerColoringStore from './view-configs/layers';
import useViewCameraStore from './view-configs/camera';
import useVolumeColoringStore from './view-configs/volume-coloring';
import useCinePlaybackStore from './view-configs/cine-playback';
import { useEnFaceViewStore } from '@/src/enface/store';
import { StateFile, ViewConfig } from '../io/state-file/schema';

/**
 * This store saves view configuration that is associated with a specific
 * view. The key is a synthetic id generated from the view ID and data ID.
 */
export const useViewConfigStore = defineStore('viewConfig', () => {
  const viewSliceStore = useViewSliceStore();
  const windowingStore = useWindowingStore();
  const layerColoringStore = useLayerColoringStore();
  const viewCameraStore = useViewCameraStore();
  const volumeColoringStore = useVolumeColoringStore();
  const cinePlaybackStore = useCinePlaybackStore();
  const enFaceViewStore = useEnFaceViewStore();

  const removeView = (viewID: string) => {
    viewSliceStore.removeView(viewID);
    windowingStore.removeView(viewID);
    layerColoringStore.removeView(viewID);
    viewCameraStore.removeView(viewID);
    volumeColoringStore.removeView(viewID);
    cinePlaybackStore.removeView(viewID);
    enFaceViewStore.removeView(viewID);
  };

  const removeData = (dataID: string, viewID?: string) => {
    viewSliceStore.removeData(dataID, viewID);
    windowingStore.removeData(dataID, viewID);
    layerColoringStore.removeData(dataID, viewID);
    viewCameraStore.removeData(dataID, viewID);
    volumeColoringStore.removeData(dataID, viewID);
    cinePlaybackStore.removeData(dataID, viewID);
    enFaceViewStore.removeData(dataID, viewID);
  };

  const serialize = (stateFile: StateFile) => {
    viewSliceStore.serialize(stateFile);
    windowingStore.serialize(stateFile);
    layerColoringStore.serialize(stateFile);
    viewCameraStore.serialize(stateFile);
    volumeColoringStore.serialize(stateFile);
    cinePlaybackStore.serialize(stateFile);
    enFaceViewStore.serialize(stateFile);
  };

  const deserialize = (
    viewID: string,
    config: Record<string, ViewConfig>,
    dataIDMap: Record<string, string>,
    segmentIdMap: Record<string, string> = {}
  ) => {
    // First update the view config map to use the new dataIDs
    const updatedConfig: Record<string, ViewConfig> = {};
    Object.entries(config).forEach(([dataID, viewConfig]) => {
      const newDataID = dataIDMap[dataID];
      // A dataset that failed to restore has no new id to carry its config.
      if (newDataID) updatedConfig[newDataID] = viewConfig;
    });

    viewSliceStore.deserialize(viewID, updatedConfig);
    windowingStore.deserialize(viewID, updatedConfig);
    layerColoringStore.deserialize(viewID, updatedConfig);
    viewCameraStore.deserialize(viewID, updatedConfig);
    volumeColoringStore.deserialize(viewID, updatedConfig);
    cinePlaybackStore.deserialize(viewID, updatedConfig);
    enFaceViewStore.deserialize(viewID, updatedConfig, segmentIdMap);
  };

  const deserializeAll = (
    manifest: StateFile['manifest'],
    dataIDMap: Record<string, string>,
    segmentIdMap: Record<string, string> = {}
  ) => {
    // Layer images are rebuilt after view settings are restored.
    const configIDMap = { ...dataIDMap };
    manifest.parentToLayers?.forEach(
      ({ selectionKey, sourceSelectionKeys }) => {
        const parent = dataIDMap[selectionKey];
        if (!parent) return;
        sourceSelectionKeys.forEach((sourceKey) => {
          const source = dataIDMap[sourceKey];
          if (!source) return;
          configIDMap[getLayerId(selectionKey, sourceKey)] = getLayerId(
            parent,
            source
          );
        });
      }
    );

    layerColoringStore.deserializeDisplayConfigs(
      manifest.layerDisplay ?? {},
      configIDMap
    );

    Object.entries(manifest.viewByID ?? {}).forEach(([viewID, view]) => {
      if (view.config) {
        deserialize(viewID, view.config, configIDMap, segmentIdMap);
      }
    });
  };

  return {
    removeView,
    removeData,
    serialize,
    deserialize,
    deserializeAll,
  };
});
