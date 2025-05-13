import { defineStore } from 'pinia';
import { reactive, ref, computed } from 'vue';
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

export const defaultWindowLevelConfig = () =>
  ({
    width: 1,
    level: 0.5,
    auto: WL_AUTO_DEFAULT,
    useAuto: false,
    userTriggered: false,
  } as const);

type WindowLevel = {
  width: number;
  level: number;
};

export const useWindowingStore = defineStore('windowing', () => {
  const configs = reactive<DoubleKeyRecord<WindowLevelConfig>>({});
  const syncAcrossViews = ref(true);
  const runtimeConfigWindowLevel = ref<WindowLevel | undefined>();
  const imageStatsStore = useImageStatsStore();

  const setSyncAcrossViews = (yn: boolean) => {
    syncAcrossViews.value = yn;
  };

  const getConfig = (viewID: string, dataID: string) => {
    return computed(() => {
      const internalConfig = getDoubleKeyRecord(configs, viewID, dataID);

      if (!internalConfig) {
        return defaultWindowLevelConfig();
      }

      let widthLevel = {
        width: internalConfig.width,
        level: internalConfig.level,
      };
      if (internalConfig.useAuto) {
        const autoKey = internalConfig.auto;
        const statsRef = imageStatsStore.getAutoRangeValues(dataID);
        const autoValues = statsRef.value;

        if (autoValues && autoValues[autoKey]) {
          const [min, max] = autoValues[autoKey];
          widthLevel = {
            width: max - min,
            level: (max + min) / 2,
          };
        } else {
          widthLevel = {
            width: internalConfig.width,
            level: internalConfig.level,
          };
        }
      }

      return {
        ...internalConfig,
        ...widthLevel,
      } as const;
    });
  };

  const getInternalConfig = (viewID: Maybe<string>, dataID: Maybe<string>) =>
    getDoubleKeyRecord(configs, viewID, dataID);

  const syncWindowLevel = (srcViewID: string, srcDataID: string) => {
    if (!syncAcrossViews.value) return;
    const config = getInternalConfig(srcViewID, srcDataID);
    if (!config) return;

    Object.keys(configs)
      .filter((viewID) => viewID !== srcViewID)
      .forEach((viewID) => {
        patchDoubleKeyRecord(configs, viewID, srcDataID, { ...config });
      });
  };

  const updateConfig = (
    viewID: string,
    dataID: string,
    patch: Partial<WindowLevelConfig>,
    userTriggered = false
  ) => {
    const currentInternalConfig = getInternalConfig(viewID, dataID);
    const defaults = defaultWindowLevelConfig();

    let effectiveUseAuto = currentInternalConfig?.useAuto ?? defaults.useAuto;
    let widthLevelPatchOnSwitchingFromAuto;

    if (patch.useAuto !== undefined) {
      effectiveUseAuto = patch.useAuto;
    } else if (patch.auto !== undefined) {
      effectiveUseAuto = true;
    } else if (patch.width !== undefined || patch.level !== undefined) {
      if (patch.useAuto === undefined) {
        effectiveUseAuto = false;
      }
      if (!effectiveUseAuto) {
        // patch may be only width or level so ensure we have both in the end
        const config = getConfig(viewID, dataID).value;
        if (config) {
          widthLevelPatchOnSwitchingFromAuto = {
            width: config.width,
            level: config.level,
          };
        }
      }
    }

    const newInternalConfig = {
      ...widthLevelPatchOnSwitchingFromAuto,
      ...patch,
      useAuto: effectiveUseAuto,
      userTriggered: currentInternalConfig?.userTriggered || userTriggered, // one way from false to true
    };

    patchDoubleKeyRecord(configs, viewID, dataID, newInternalConfig);
    syncWindowLevel(viewID, dataID);
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
    runtimeConfigWindowLevel,
    getConfig,
    setSyncAcrossViews,
    updateConfig,
    removeView,
    removeData,
    serialize,
    deserialize,
  };
});
