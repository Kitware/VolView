import { defineStore } from 'pinia';
import { reactive, ref } from 'vue';
import {
  DoubleKeyRecord,
  deleteSecondKey,
  getDoubleKeyRecord,
  patchDoubleKeyRecord,
} from '@/src/utils/doubleKeyRecord';
import { Maybe } from '@/src/types';
import { createViewConfigSerializer } from './common';
import { ViewConfig } from '../../io/state-file/schema';
import { WindowLevelConfig } from './types';

export const defaultWindowLevelConfig = (): WindowLevelConfig => ({
  width: 1,
  level: 0.5,
  min: 0,
  max: 1,
  auto: 'Default',
  preset: {
    width: 1,
    level: 0.5,
  },
});

const useWindowingStore = defineStore('windowing', () => {
  const configs = reactive<DoubleKeyRecord<WindowLevelConfig>>({});
  const syncAcrossViews = ref(true);

  const setSyncAcrossViews = (yn: boolean) => {
    syncAcrossViews.value = yn;
  };

  const getConfig = (viewID: Maybe<string>, dataID: Maybe<string>) =>
    getDoubleKeyRecord(configs, viewID, dataID);

  /**
   * Syncs the window/level/min/max params of (srcViewID, srcDataID) across all views sharing the dataset.
   * @param srcViewID
   * @param srcDataID
   */
  const syncWindowLevel = (srcViewID: string, srcDataID: string) => {
    if (!syncAcrossViews.value) return;

    const config = configs[srcViewID]?.[srcDataID];
    if (!config) return;

    Object.keys(configs)
      .filter((viewID) => viewID !== srcViewID)
      .forEach((viewID) => {
        patchDoubleKeyRecord(configs, viewID, srcDataID, config);
      });
  };

  const updateConfig = (
    viewID: string,
    dataID: string,
    patch: Partial<WindowLevelConfig>
  ) => {
    patchDoubleKeyRecord(configs, viewID, dataID, {
      ...defaultWindowLevelConfig(),
      ...configs[viewID]?.[dataID],
      ...patch,
    });

    if (syncAcrossViews.value) {
      syncWindowLevel(viewID, dataID);
    }
  };

  const resetWindowLevel = (viewID: string, dataID: string) => {
    const config = configs[viewID]?.[dataID];
    if (config == null) return;

    let { width, level } = config.preset;
    const defaults = defaultWindowLevelConfig();
    if (width === defaults.width && level === defaults.level) {
      width = config.max - config.min;
      level = (config.max + config.min) / 2;
    }
    updateConfig(viewID, dataID, { width, level });
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

  const serialize = createViewConfigSerializer(configs, 'window');

  const deserialize = (viewID: string, config: Record<string, ViewConfig>) => {
    Object.entries(config).forEach(([dataID, viewConfig]) => {
      if (viewConfig.window) {
        updateConfig(viewID, dataID, viewConfig.window);
      }
    });
  };

  return {
    configs,
    getConfig,
    setSyncAcrossViews,
    updateConfig,
    resetWindowLevel,
    removeView,
    removeData,
    serialize,
    deserialize,
  };
});

export default useWindowingStore;
