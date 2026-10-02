import { defineStore } from 'pinia';
import { getLayerId } from '@/src/utils/layers';
import { OBLIQUE_SUB_VIEWS } from '@/src/constants';

import useViewSliceStore from './view-configs/slicing';
import { useWindowingStore } from './view-configs/windowing';
import useLayerColoringStore from './view-configs/layers';
import useViewCameraStore from './view-configs/camera';
import useVolumeColoringStore from './view-configs/volume-coloring';
import useCinePlaybackStore from './view-configs/cine-playback';
import { useEnFaceViewStore } from '@/src/enface/store';
import { StateFile, ViewConfig } from '../io/state-file/schema';
import type { SegmentResolver } from '@/src/segmentation/segments';

// Oblique viewers own these synthetic view IDs for their four renderers.
const ownedViewIDs = (viewID: string) =>
  ['', ...Object.values(OBLIQUE_SUB_VIEWS)].map((suffix) => viewID + suffix);

// Configs contain JSON values; clones keep nested camera/coloring state independent.
const copyConfigs =
  <T>(
    configs: Record<string, Record<string, T>>,
    update: (viewID: string, dataID: string, config: T) => void
  ) =>
  (sourceID: string, targetID: string) =>
    Object.entries(configs[sourceID] ?? {}).forEach(([dataID, config]) =>
      update(targetID, dataID, JSON.parse(JSON.stringify(config)) as T)
    );

type PerViewConfigs = {
  removeView: (viewID: string) => void;
  removeData: (dataID: string, viewID?: string) => void;
  serialize: (stateFile: StateFile) => void;
  deserialize: (
    viewID: string,
    config: Record<string, ViewConfig>,
    resolveSegment: SegmentResolver
  ) => void;
};

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

  // Every per-view store, so copy, remove and save cannot miss one.
  const perViewStores: Array<{
    store: PerViewConfigs;
    copy: (sourceID: string, targetID: string) => void;
  }> = [
    {
      store: viewSliceStore,
      copy: copyConfigs(viewSliceStore.configs, viewSliceStore.updateConfig),
    },
    {
      store: windowingStore,
      copy: copyConfigs(windowingStore.configs, windowingStore.updateConfig),
    },
    // Layer coloring is derived from each layer's shared display config.
    { store: layerColoringStore, copy: () => {} },
    {
      store: viewCameraStore,
      copy: (sourceID, targetID) =>
        copyConfigs(viewCameraStore.configs, (viewID, dataID, config) => {
          viewCameraStore.updateConfig(viewID, dataID, config);
          if (viewCameraStore.isCameraInitialized(sourceID, dataID)) {
            viewCameraStore.markCameraAsInitialized(viewID, dataID);
          }
        })(sourceID, targetID),
    },
    {
      store: volumeColoringStore,
      copy: volumeColoringStore.copyView,
    },
    {
      store: cinePlaybackStore,
      copy: copyConfigs(cinePlaybackStore.configs, (viewID, dataID, config) =>
        cinePlaybackStore.updateConfig(viewID, dataID, {
          ...config,
          playing: false,
        })
      ),
    },
    {
      store: enFaceViewStore,
      copy: copyConfigs(enFaceViewStore.configs, (viewID, dataID, config) =>
        Object.assign(enFaceViewStore.configFor(viewID, dataID), config)
      ),
    },
  ];

  const removeView = (viewID: string) => {
    ownedViewIDs(viewID).forEach((id) =>
      perViewStores.forEach(({ store }) => store.removeView(id))
    );
  };

  const removeData = (dataID: string, viewID?: string) => {
    perViewStores.forEach(({ store }) => store.removeData(dataID, viewID));
  };

  const serialize = (stateFile: StateFile) => {
    perViewStores.forEach(({ store }) => store.serialize(stateFile));
  };

  const deserialize = (
    viewID: string,
    config: Record<string, ViewConfig>,
    dataIDMap: Record<string, string>,
    resolveSegment: SegmentResolver
  ) => {
    const updatedConfig: Record<string, ViewConfig> = {};
    Object.entries(config).forEach(([dataID, viewConfig]) => {
      const newDataID = dataIDMap[dataID];
      // A dataset that failed to restore has no new id to carry its config.
      if (newDataID) updatedConfig[newDataID] = viewConfig;
    });
    perViewStores.forEach(({ store }) =>
      store.deserialize(viewID, updatedConfig, resolveSegment)
    );
  };

  const deserializeAll = (
    manifest: StateFile['manifest'],
    dataIDMap: Record<string, string>,
    resolveSegment: SegmentResolver
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
        deserialize(viewID, view.config, configIDMap, resolveSegment);
      }
    });
  };

  const copyView = (sourceID: string, targetID: string) => {
    const sourceIDs = ownedViewIDs(sourceID);
    ownedViewIDs(targetID).forEach((id, index) =>
      perViewStores.forEach(({ copy }) => copy(sourceIDs[index], id))
    );
  };

  return {
    removeView,
    copyView,
    removeData,
    serialize,
    deserialize,
    deserializeAll,
  };
});
