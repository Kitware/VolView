import { MaybeRef } from '@vueuse/core';
import { useDoubleRecord } from '@/src/composables/useDoubleRecord';
import { clampValue } from '@/src/utils';
import {
  removeDataFromConfig,
  removeViewFromConfig,
  serializeViewConfig,
} from './common';
import { StateFile, ViewConfig } from '../../io/state-file/schema';
import { SliceConfig } from './types';

export const defaultSliceConfig = (): SliceConfig => ({
  slice: 0,
  min: 0,
  max: 1,
  axisDirection: 'Inferior',
});

export const setupSlicingConfig = () => {
  // (viewID, dataID) -> SliceConfig
  const sliceConfigs = useDoubleRecord<SliceConfig>();

  const getSliceConfig = (viewID: string, dataID: string) =>
    sliceConfigs.get(viewID, dataID);

  const getComputedSliceConfig = (
    viewID: MaybeRef<string | null>,
    dataID: MaybeRef<string | null>
  ) => sliceConfigs.getComputed(viewID, dataID);

  const updateSliceConfig = (
    viewID: string,
    dataID: string,
    update: Partial<SliceConfig>
  ) => {
    const config = {
      ...defaultSliceConfig(),
      ...sliceConfigs.get(viewID, dataID),
      ...update,
    };

    if ('min' in update || 'max' in update) {
      config.slice = Math.floor((config.min + config.max) / 2);
    }
    config.slice = clampValue(config.slice, config.min, config.max);

    sliceConfigs.set(viewID, dataID, config);
  };

  const resetSlice = (viewID: string, dataID: string) => {
    if (sliceConfigs.has(viewID, dataID)) {
      const config = sliceConfigs.get(viewID, dataID)!;
      // Make this consistent with ImageMapper + SliceRepresentationProxy
      // behavior. Setting this to floor() will affect images where the
      // middle slice is fractional.
      updateSliceConfig(viewID, dataID, {
        slice: Math.ceil((config.min + config.max) / 2),
      });
    }
  };

  const serialize = (stateFile: StateFile) => {
    serializeViewConfig(stateFile, getSliceConfig, 'slice');
  };

  const deserialize = (viewID: string, config: Record<string, ViewConfig>) => {
    Object.entries(config).forEach(([dataID, viewConfig]) => {
      if (viewConfig.slice) {
        sliceConfigs.set(viewID, dataID, viewConfig.slice);
      }
    });
  };

  return {
    removeView: removeViewFromConfig(sliceConfigs),
    removeData: removeDataFromConfig(sliceConfigs),
    serialize,
    deserialize,
    actions: {
      getSliceConfig,
      getComputedSliceConfig,
      updateSliceConfig,
      resetSlice,
    },
  };
};
