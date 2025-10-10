import { defineStore } from 'pinia';
import { markRaw, reactive, ref } from 'vue';
import {
  DoubleKeyRecord,
  deleteSecondKey,
  getDoubleKeyRecord,
  patchDoubleKeyRecord,
} from '@/src/utils/doubleKeyRecord';
import { Maybe } from '@/src/types';
import { WL_AUTO_DEFAULT } from '@/src/constants';
import { useImageStatsStore } from '@/src/store/image-stats';
import { createViewConfigSerializer } from '@/src/store/view-configs/common';
import { ViewConfig } from '@/src/io/state-file/schema';
import { WindowLevelConfig } from '@/src/store/view-configs/types';
import { isDicomImage } from '@/src/utils/dataSelection';
import { getWindowLevels, useDICOMStore } from '@/src/store/datasets-dicom';
import { createEventHook } from '@vueuse/core';

type WindowLevel = {
  width: number;
  level: number;
};

export const defaultWindowLevelConfig = () =>
  ({
    width: 1,
    level: 0.5,
    auto: WL_AUTO_DEFAULT,
    useAuto: false,
    userTriggered: false,
  } as WindowLevelConfig);

export const useWindowingStore = defineStore('windowing', () => {
  const configs = reactive<DoubleKeyRecord<WindowLevelConfig>>({});
  const runtimeConfigWindowLevel = ref<WindowLevel | undefined>();

  const imageStatsStore = useImageStatsStore();
  const dicomStore = useDICOMStore();

  const WindowingUpdateEvent = markRaw(createEventHook<[string, string]>());

  const computeDefaultConfig = (dataID: string): WindowLevelConfig => {
    const defaults = defaultWindowLevelConfig();
    let { width, level } = defaults;
    let useAuto = false;
    let hasDicomWindowLevel = false;

    if (isDicomImage(dataID)) {
      const wls = getWindowLevels(dicomStore.volumeInfo[dataID]);
      const wl = wls[0];
      if (wl) {
        ({ width, level } = wl);
        hasDicomWindowLevel = true;
      }
    }

    if (!hasDicomWindowLevel) {
      useAuto = true;

      const stats = imageStatsStore.stats[dataID];
      const min = stats?.scalarMin ?? 0;
      const max = stats?.scalarMax ?? 1;
      width = max - min;
      level = (max + min) / 2;
    }

    if (runtimeConfigWindowLevel.value) {
      ({ width, level } = runtimeConfigWindowLevel.value);
    }

    return {
      useAuto,
      auto: WL_AUTO_DEFAULT,
      width,
      level,
    };
  };

  const getConfig = (viewID: string, dataID: string): WindowLevelConfig => {
    const internalConfig =
      getDoubleKeyRecord(configs, viewID, dataID) ??
      computeDefaultConfig(dataID);

    if (!internalConfig.useAuto) {
      return { ...internalConfig };
    }

    const autoKey = internalConfig.auto;
    const autoValues = imageStatsStore.getAutoRangeValues(dataID);
    if (autoValues?.[autoKey]) {
      const [min, max] = autoValues[autoKey];
      return {
        ...internalConfig,
        width: max - min,
        level: (max + min) / 2,
      };
    }
    return { ...internalConfig };
  };

  const getInternalConfig = (viewID: Maybe<string>, dataID: Maybe<string>) =>
    getDoubleKeyRecord(configs, viewID, dataID);

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
    }
    if (
      (patch.width !== undefined || patch.level !== undefined) &&
      patch.useAuto === undefined
    ) {
      effectiveUseAuto = false;
      if (!effectiveUseAuto) {
        // patch may be only width or level so ensure we have both in the end
        const config = getConfig(viewID, dataID);
        widthLevelPatchOnSwitchingFromAuto = {
          width: config.width,
          level: config.level,
        };
      }
    }

    // Ensure we always have required fields from defaults
    const baseConfig = currentInternalConfig || defaults;

    const newInternalConfig = {
      ...baseConfig,
      ...widthLevelPatchOnSwitchingFromAuto,
      ...patch,
      auto: patch.auto ?? currentInternalConfig?.auto ?? defaults.auto,
      useAuto: effectiveUseAuto,
      // one way from false to true
      userTriggered:
        currentInternalConfig?.userTriggered ||
        userTriggered ||
        patch.userTriggered,
    };

    patchDoubleKeyRecord(configs, viewID, dataID, newInternalConfig);

    WindowingUpdateEvent.trigger(viewID, dataID);
  };

  const removeView = (viewID: string) => {
    delete configs[viewID];
  };

  const resetConfig = (viewID: Maybe<string>, dataID: Maybe<string>) => {
    if (!viewID || !dataID) return;
    delete configs[viewID]?.[dataID];
    WindowingUpdateEvent.trigger(viewID, dataID);
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
    updateConfig,
    resetConfig,
    removeView,
    removeData,
    serialize,
    deserialize,
    WindowingUpdateEvent,
  };
});
