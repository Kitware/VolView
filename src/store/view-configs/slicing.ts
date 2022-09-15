import { useDoubleRecord } from '@/src/composables/useDoubleRecord';
import { LPSAxisDir } from '@/src/types/lps';
import { clampValue } from '@/src/utils';
import { removeDataFromConfig, removeViewFromConfig } from './common';

interface SliceConfig {
  slice: number;
  min: number;
  max: number;
  axisDirection: LPSAxisDir;
}

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

  return {
    removeView: removeViewFromConfig(sliceConfigs),
    removeData: removeDataFromConfig(sliceConfigs),
    actions: {
      getSliceConfig,
      updateSliceConfig,
      resetSlice,
    },
  };
};
