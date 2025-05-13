import { defineStore } from 'pinia';
import { reactive, ref, watch, WatchStopHandle } from 'vue'; // Added WatchStopHandle
import {
  DoubleKeyRecord,
  deleteSecondKey,
  getDoubleKeyRecord,
  patchDoubleKeyRecord,
} from '@/src/utils/doubleKeyRecord';
import { Maybe } from '@/src/types';
import { WL_AUTO_DEFAULT } from '@/src/constants';
import { useImageStatsStore } from '@/src/store/image-stats';
import { createViewConfigSerializer } from './common';
import { ViewConfig } from '../../io/state-file/schema';
import { WindowLevelConfig } from './types';

export const defaultWindowLevelConfig = () => ({
  width: 1,
  level: 0.5,
  auto: WL_AUTO_DEFAULT,
  useAuto: false,
  userTriggered: false,
});

type WindowLevel = {
  width: number;
  level: number;
};

export const useWindowingStore = defineStore('windowing', () => {
  const configs = reactive<DoubleKeyRecord<WindowLevelConfig>>({});
  const syncAcrossViews = ref(true);
  const runtimeConfigWindowLevel = ref<WindowLevel | undefined>();
  const imageStatsStore = useImageStatsStore();

  // Use DoubleKeyRecord for autoWindowUpdaters
  const autoWindowUpdaters = reactive<DoubleKeyRecord<WatchStopHandle>>({});

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

  const teardownAutoWindowUpdater = (viewID: string, dataID: string) => {
    const stop = getDoubleKeyRecord(autoWindowUpdaters, viewID, dataID);
    if (stop) {
      stop();
      // Remove the specific dataID entry for the viewID
      if (autoWindowUpdaters[viewID]) {
        delete autoWindowUpdaters[viewID][dataID];
        if (Object.keys(autoWindowUpdaters[viewID]).length === 0) {
          delete autoWindowUpdaters[viewID];
        }
      }
    }
  };

  const setupAutoWindowUpdater = (viewID: string, dataID: string) => {
    teardownAutoWindowUpdater(viewID, dataID); // Stop existing watcher if any

    const newStopHandle = watch(
      [
        () => imageStatsStore.getAutoRangeValues(dataID).value,
        () => configs[viewID]?.[dataID],
      ],
      ([autoValues, config]) => {
        if (!config?.useAuto) {
          return;
        }

        const autoKey = config.auto || WL_AUTO_DEFAULT;
        if (autoValues && autoValues[autoKey]) {
          const [min, max] = autoValues[autoKey];
          const newWidth = max - min;
          const newLevel = (max + min) / 2;

          if (config.width !== newWidth || config.level !== newLevel) {
            patchDoubleKeyRecord(configs, viewID, dataID, {
              width: newWidth,
              level: newLevel,
            });
            syncWindowLevel(viewID, dataID);
          }
        }
      },
      { deep: true, immediate: true }
    );

    // Store the new stop handle
    if (!autoWindowUpdaters[viewID]) {
      autoWindowUpdaters[viewID] = {};
    }
    autoWindowUpdaters[viewID][dataID] = newStopHandle;
  };

  const updateConfig = (
    viewID: string,
    dataID: string,
    patch: Partial<WindowLevelConfig>,
    userTriggered = false
  ) => {
    const currentConfig = configs[viewID]?.[dataID];

    // Ensure userTriggered only goes from false to true, never true to false
    const effectiveUserTriggered =
      currentConfig?.userTriggered || userTriggered;

    let effectiveUseAuto =
      patch.useAuto ??
      currentConfig?.useAuto ??
      defaultWindowLevelConfig().useAuto;

    if (patch.auto !== undefined) {
      effectiveUseAuto = true;
    } else if (
      (patch.width !== undefined || patch.level !== undefined) &&
      patch.useAuto === undefined
    ) {
      effectiveUseAuto = false;
    }

    patchDoubleKeyRecord(configs, viewID, dataID, {
      ...defaultWindowLevelConfig(),
      ...currentConfig,
      ...patch,
      useAuto: effectiveUseAuto,
      userTriggered: effectiveUserTriggered,
    });

    syncWindowLevel(viewID, dataID);
    setupAutoWindowUpdater(viewID, dataID);
  };

  const removeView = (viewID: string) => {
    const dataConfigs = configs[viewID];
    if (dataConfigs) {
      Object.keys(dataConfigs).forEach((dataID) => {
        teardownAutoWindowUpdater(viewID, dataID);
      });
    }
    delete configs[viewID];
    if (
      autoWindowUpdaters[viewID] &&
      Object.keys(autoWindowUpdaters[viewID]).length === 0
    ) {
      delete autoWindowUpdaters[viewID];
    }
  };

  const removeData = (dataID: string, viewID?: string) => {
    if (viewID) {
      teardownAutoWindowUpdater(viewID, dataID);
      delete configs[viewID]?.[dataID];
    } else {
      Object.keys(configs).forEach((vID) => {
        if (configs[vID]?.[dataID]) {
          teardownAutoWindowUpdater(vID, dataID);
        }
      });
      deleteSecondKey(configs, dataID);
      // Also remove from autoWindowUpdaters for all views
      Object.keys(autoWindowUpdaters).forEach((vID) => {
        if (autoWindowUpdaters[vID]?.[dataID]) {
          delete autoWindowUpdaters[vID][dataID];
          if (Object.keys(autoWindowUpdaters[vID]).length === 0) {
            delete autoWindowUpdaters[vID];
          }
        }
      });
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
    runtimeConfigWindowLevel,
    configs,
    getConfig,
    setSyncAcrossViews,
    updateConfig,
    removeView,
    removeData,
    serialize,
    deserialize,
  };
});
