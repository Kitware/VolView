import { clampValue } from '@/src/utils';
import { defineStore } from 'pinia';
import { reactive } from 'vue';
import {
  DoubleKeyRecord,
  deleteSecondKey,
  getDoubleKeyRecord,
  patchDoubleKeyRecord,
} from '@/src/utils/doubleKeyRecord';
import { Maybe } from '@/src/types';
import { useCurrentImage, useImage } from '@/src/composables/useCurrentImage';
import { createViewConfigSerializer } from '@/src/store/view-configs/common';
import { ViewConfig } from '@/src/io/state-file/schema';
import { SliceConfig } from '@/src/store/view-configs/types';
import { useImageStore } from '@/src/store/datasets-images';
import { useViewStore } from '@/src/store/views';

export const defaultSliceConfig = (): SliceConfig => ({
  slice: 0,
  min: 0,
  max: 1,
  syncState: false,
});

export const useViewSliceStore = defineStore('viewSlice', () => {
  const imageStore = useImageStore();
  const viewStore = useViewStore();
  const configs = reactive<DoubleKeyRecord<SliceConfig>>({});

  const computeDefaultSliceConfig = (
    viewID: Maybe<string>,
    imageID: Maybe<string>
  ): SliceConfig => {
    if (!viewID || !imageID) return defaultSliceConfig();

    const view = viewStore.getView(viewID);
    if (view?.type !== '2D') return defaultSliceConfig();

    const { orientation } = view.options;
    const { metadata } = useImage(imageID);
    const { lpsOrientation, dimensions } = metadata.value;
    const ijkIndex = lpsOrientation[orientation];
    const dimMax = dimensions[ijkIndex];

    return {
      min: 0,
      slice: Math.ceil((dimMax - 1) / 2),
      max: dimMax - 1,
      syncState: false,
    };
  };

  const getConfig = (viewID: Maybe<string>, dataID: Maybe<string>) =>
    getDoubleKeyRecord(configs, viewID, dataID) ??
    computeDefaultSliceConfig(viewID, dataID);

  const updateConfig = (
    viewID: string,
    dataID: string,
    patch: Partial<SliceConfig>
  ) => {
    const config = {
      ...defaultSliceConfig(),
      ...getConfig(viewID, dataID),
      ...patch,
    };

    config.slice = clampValue(config.slice, config.min, config.max);
    patchDoubleKeyRecord(configs, viewID, dataID, config);
  };

  const resetSlice = (viewID: string, dataID: string) => {
    const config = getConfig(viewID, dataID);
    if (!config) return;

    // Setting this to floor() will affect images where the
    // middle slice is fractional.
    // This is consistent with vtkImageMapper and SliceRepresentationProxy.
    updateConfig(viewID, dataID, {
      slice: Math.ceil((config.min + config.max) / 2),
    });
  };

  const removeView = (viewID: string) => {
    delete configs[viewID];
  };

  const removeData = (dataID: string, viewID?: string) => {
    if (viewID) {
      delete configs[viewID]?.[dataID];
    } else {
      deleteSecondKey(configs, dataID);
    }
  };

  const toggleSyncImages = () => {
    // Synchronize all images when toggled
    Object.keys(configs).forEach((viewID) => {
      imageStore.idList.forEach((imageID) => {
        const { syncState } = {
          ...defaultSliceConfig(),
          ...getConfig(viewID, imageID),
        };
        updateConfig(viewID, imageID, { syncState: !syncState });
      });
    });
  };

  const isSync = () => {
    const allSync = Object.keys(configs).every((sc) =>
      Object.keys(configs[sc]).every((c) => configs[sc][c].syncState)
    );

    return allSync;
  };

  const updateSyncConfigs = () => {
    Object.keys(configs).forEach((viewID) => {
      const { currentImageID } = useCurrentImage();
      const config = getConfig(viewID, currentImageID.value);
      imageStore.idList.forEach((imageID) => {
        const { syncState } = {
          ...defaultSliceConfig(),
          ...getConfig(viewID, imageID),
        };

        if (syncState) {
          updateConfig(viewID, imageID, { slice: config?.slice });
        }
      });
    });
  };

  const serialize = createViewConfigSerializer(configs, 'slice');

  const deserialize = (viewID: string, config: Record<string, ViewConfig>) => {
    Object.entries(config).forEach(([dataID, viewConfig]) => {
      if (viewConfig.slice) {
        updateConfig(viewID, dataID, viewConfig.slice);
      }
    });
  };

  return {
    configs,
    getConfig,
    updateConfig,
    resetSlice,
    removeView,
    removeData,
    toggleSyncImages,
    updateSyncConfigs,
    isSync,
    serialize,
    deserialize,
  };
});

export default useViewSliceStore;
