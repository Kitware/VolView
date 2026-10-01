import { defineStore } from 'pinia';
import { markRaw, reactive, ref } from 'vue';
import { createEventHook } from '@vueuse/core';
import {
  DoubleKeyRecord,
  deleteSecondKey,
  getDoubleKeyRecord,
  patchDoubleKeyRecord,
} from '@/src/utils/doubleKeyRecord';
import { Maybe } from '@/src/types';
import { WL_AUTO_DEFAULT, WLAutoRanges } from '@/src/constants';
import { useImageStatsStore } from '@/src/store/image-stats';
import { createViewConfigSerializer } from '@/src/store/view-configs/common';
import { ViewConfig } from '@/src/io/state-file/schema';
import { WindowLevelConfig } from '@/src/store/view-configs/types';
import { isDicomImage } from '@/src/utils/dataSelection';
import { getWindowLevels, useDICOMStore } from '@/src/store/datasets-dicom';

export type WindowingAutoRanges = Record<
  keyof typeof WLAutoRanges,
  readonly [number, number]
>;

type WindowLevel = {
  width: number;
  level: number;
};

const minMaxToWidthLevel = (min: number, max: number) => ({
  width: max - min,
  level: (max + min) / 2,
});

export const defaultWindowLevelConfig = () =>
  ({
    width: 1,
    level: 0.5,
    auto: WL_AUTO_DEFAULT,
    useAuto: false,
    userTriggered: false,
  }) as WindowLevelConfig;

export const useWindowingStore = defineStore('windowing', () => {
  const configs = reactive<DoubleKeyRecord<WindowLevelConfig>>({});
  const runtimeConfigWindowLevel = ref<WindowLevel | undefined>();
  // Derived images can have different intensity units from their source volume.
  // These ranges belong to the live rendering and are regenerated after restore.
  const autoRangeOverrides = reactive<DoubleKeyRecord<WindowingAutoRanges>>({});

  const imageStatsStore = useImageStatsStore();
  const dicomStore = useDICOMStore();

  const WindowingUpdateEvent = markRaw(createEventHook<[string, string]>());

  const getDicomWindowLevel = (dataID: string) => {
    if (!isDicomImage(dataID)) return undefined;
    const wls = getWindowLevels(dicomStore.volumeInfo[dataID]);
    return wls[0];
  };

  const getStatsWindowLevel = (dataID: string) => {
    const stats = imageStatsStore.stats[dataID];
    const min = stats?.scalarMin ?? 0;
    const max = stats?.scalarMax ?? 1;
    return minMaxToWidthLevel(min, max);
  };

  const computeDefaultConfig = (viewID: string, dataID: string) => {
    const defaults = defaultWindowLevelConfig();
    if (getDoubleKeyRecord(autoRangeOverrides, viewID, dataID)) {
      return { ...defaults, useAuto: true };
    }

    const runtimeWL = runtimeConfigWindowLevel.value;
    if (runtimeWL) {
      return { ...defaults, ...runtimeWL, useAuto: false };
    }

    const dicomWL = getDicomWindowLevel(dataID);
    if (dicomWL) {
      return { ...defaults, ...dicomWL, useAuto: false };
    }

    const statsWL = getStatsWindowLevel(dataID);
    return { ...defaults, ...statsWL, useAuto: true };
  };

  const getConfig = (viewID: string, dataID: string): WindowLevelConfig => {
    const internalConfig =
      getDoubleKeyRecord(configs, viewID, dataID) ??
      computeDefaultConfig(viewID, dataID);

    if (!internalConfig.useAuto) {
      return { ...internalConfig };
    }

    const autoKey = internalConfig.auto;
    const override = getDoubleKeyRecord(autoRangeOverrides, viewID, dataID);
    const autoValues = override ?? imageStatsStore.getAutoRangeValues(dataID);
    if (autoValues?.[autoKey]) {
      const [min, max] = autoValues[autoKey];
      return {
        ...internalConfig,
        ...minMaxToWidthLevel(min, max),
        ...(override ? { width: Math.max(1e-12, max - min) } : {}),
      };
    }
    return { ...internalConfig };
  };

  const setAutoRangeValues = (
    viewID: string,
    dataID: string,
    values: WindowingAutoRanges | null
  ) => {
    const current = getDoubleKeyRecord(autoRangeOverrides, viewID, dataID);
    if (!values) {
      if (!current) return;
      delete autoRangeOverrides[viewID]?.[dataID];
    } else {
      const keys = Object.keys(WLAutoRanges) as Array<
        keyof typeof WLAutoRanges
      >;
      if (
        !keys.every((key) => {
          const range = values[key];
          return range && range.every(Number.isFinite) && range[0] <= range[1];
        })
      )
        throw new Error('Auto window ranges must be finite and ordered');
      if (
        current &&
        keys.every(
          (key) =>
            current[key][0] === values[key][0] &&
            current[key][1] === values[key][1]
        )
      )
        return;
      autoRangeOverrides[viewID] ??= {};
      autoRangeOverrides[viewID][dataID] = { ...values };
    }
    WindowingUpdateEvent.trigger(viewID, dataID);
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
    delete autoRangeOverrides[viewID];
  };

  const resetConfig = (viewID: Maybe<string>, dataID: Maybe<string>) => {
    if (!viewID || !dataID) return;
    delete configs[viewID]?.[dataID];
    WindowingUpdateEvent.trigger(viewID, dataID);
  };

  const removeData = (dataID: string, viewID?: string) => {
    if (viewID) {
      delete configs[viewID]?.[dataID];
      delete autoRangeOverrides[viewID]?.[dataID];
    } else {
      deleteSecondKey(configs, dataID);
      deleteSecondKey(autoRangeOverrides, dataID);
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
    setAutoRangeValues,
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
