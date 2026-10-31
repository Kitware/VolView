import { defineStore } from 'pinia';
import { resolveBaseColorPreset } from '@/src/vtk/LayerColorPresets';
import { markRaw, reactive, ref } from 'vue';
import { createEventHook } from '@vueuse/core';
import deepEqual from 'fast-deep-equal';
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
import type { StateFile, ViewConfig } from '@/src/io/state-file/schema';
import { WindowLevelConfig } from '@/src/store/view-configs/types';
import { isDicomImage } from '@/src/utils/dataSelection';
import { getWindowLevels, useDICOMStore } from '@/src/store/datasets-dicom';
import type { ViewInfo } from '@/src/types/views';

export type WindowingAutoRanges = Record<
  keyof typeof WLAutoRanges,
  readonly [number, number]
>;

type WindowingAutoSource = {
  defaultAuto: keyof WindowingAutoRanges;
  ranges: WindowingAutoRanges | null;
};

const autoRangeKeys = Object.keys(WLAutoRanges) as Array<
  keyof WindowingAutoRanges
>;

/**
 * En face views window independently: each projection method and slab has
 * its own intensity distribution.
 */
export const sharesSourceWindowing = (view: Maybe<ViewInfo>) =>
  view != null && view.type !== 'EnFace';

type WindowLevel = {
  width: number;
  level: number;
};

const minMaxToWidthLevel = (min: number, max: number) => ({
  width: max - min,
  level: (max + min) / 2,
});

const withAppearanceDefaults = (config: WindowLevelConfig) => ({
  ...config,
  preset: resolveBaseColorPreset(config.preset),
  visibility: config.visibility ?? true,
});

export const defaultWindowLevelConfig = () =>
  ({
    visibility: true,
    width: 1,
    level: 0.5,
    auto: WL_AUTO_DEFAULT,
    useAuto: false,
    userTriggered: false,
  }) as WindowLevelConfig;

export const useWindowingStore = defineStore('windowing', () => {
  const configs = reactive<
    DoubleKeyRecord<ReturnType<typeof withAppearanceDefaults>>
  >({});

  const runtimeConfigWindowLevel = ref<WindowLevel | undefined>();
  // Derived images can have different intensity units from their source volume.
  // Keep their small range summaries with the view/data configuration across remounts.
  const autoRangeSources = reactive<DoubleKeyRecord<WindowingAutoSource>>({});

  const imageStatsStore = useImageStatsStore();
  const dicomStore = useDICOMStore();

  const WindowingUpdateEvent = markRaw(createEventHook<[string, string]>());
  const ContrastResetEvent = markRaw(createEventHook<[string, string]>());

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
    const source = getDoubleKeyRecord(autoRangeSources, viewID, dataID);
    if (source) {
      return { ...defaults, auto: source.defaultAuto, useAuto: true };
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

  const resolveConfig = (
    viewID: string,
    dataID: string,
    internalConfig: ReturnType<typeof withAppearanceDefaults>
  ) => {
    if (!internalConfig.useAuto) {
      return internalConfig;
    }

    const autoKey = internalConfig.auto;
    const source = getDoubleKeyRecord(autoRangeSources, viewID, dataID);
    const autoValues = source
      ? source.ranges
      : imageStatsStore.getAutoRangeValues(dataID);
    if (autoValues?.[autoKey]) {
      const [min, max] = autoValues[autoKey];
      return {
        ...internalConfig,
        ...minMaxToWidthLevel(min, max),
        ...(source && min === max ? { width: 1 } : {}),
      };
    }
    return internalConfig;
  };

  const getConfig = (viewID: string, dataID: string) =>
    resolveConfig(
      viewID,
      dataID,
      withAppearanceDefaults(
        getDoubleKeyRecord(configs, viewID, dataID) ??
          computeDefaultConfig(viewID, dataID)
      )
    );

  const setAutoRangeValues = (
    viewID: string,
    dataID: string,
    values: WindowingAutoRanges | null,
    defaultAuto: keyof WindowingAutoRanges = 'FullRange'
  ) => {
    const current = getDoubleKeyRecord(autoRangeSources, viewID, dataID);
    if (
      values &&
      !autoRangeKeys.every((key) => {
        const range = values[key];
        return range && range.every(Number.isFinite) && range[0] <= range[1];
      })
    )
      throw new Error('Auto window ranges must be finite and ordered');
    if (
      current?.defaultAuto === defaultAuto &&
      deepEqual(current.ranges, values)
    )
      return;
    autoRangeSources[viewID] ??= {};
    autoRangeSources[viewID][dataID] = {
      defaultAuto,
      ranges: values ? { ...values } : null,
    };
  };

  const getInternalConfig = (viewID: Maybe<string>, dataID: Maybe<string>) =>
    getDoubleKeyRecord(configs, viewID, dataID);

  const getRange = (viewID: string, dataID: string): [number, number] => {
    const source = getDoubleKeyRecord(autoRangeSources, viewID, dataID);
    if (source?.ranges) return [...source.ranges.FullRange];
    if (source) {
      const config = getConfig(viewID, dataID);
      const width = config.width ?? 1;
      const level = config.level ?? 0.5;
      return [level - width / 2, level + width / 2];
    }
    const stats = imageStatsStore.stats[dataID];
    return stats?.scalarMin != null && stats.scalarMax != null
      ? [stats.scalarMin, stats.scalarMax]
      : [0, 1];
  };

  const updateConfig = (
    viewID: string,
    dataID: string,
    patch: Partial<WindowLevelConfig>,
    userTriggered = false
  ) => {
    const currentInternalConfig = getInternalConfig(viewID, dataID);
    const defaults = computeDefaultConfig(viewID, dataID);

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
      // patch may be only width or level so ensure we have both in the end
      const config = getConfig(viewID, dataID);
      widthLevelPatchOnSwitchingFromAuto = {
        width: config.width,
        level: config.level,
      };
    }

    // Ensure we always have required fields from defaults
    const baseConfig = currentInternalConfig || defaults;

    const newInternalConfig = withAppearanceDefaults({
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
    });

    patchDoubleKeyRecord(configs, viewID, dataID, newInternalConfig);

    WindowingUpdateEvent.trigger(viewID, dataID);
  };

  const resetContrast = (viewID: string, dataID: string) => {
    const { width, level, auto, useAuto } = computeDefaultConfig(
      viewID,
      dataID
    );
    updateConfig(viewID, dataID, { width, level, auto, useAuto }, true);
    ContrastResetEvent.trigger(viewID, dataID);
  };

  const removeView = (viewID: string) => {
    delete configs[viewID];
    delete autoRangeSources[viewID];
  };

  const resetConfig = (viewID: Maybe<string>, dataID: Maybe<string>) => {
    if (!viewID || !dataID) return;
    delete configs[viewID]?.[dataID];
    WindowingUpdateEvent.trigger(viewID, dataID);
  };

  const removeData = (dataID: string, viewID?: string) => {
    if (viewID) {
      delete configs[viewID]?.[dataID];
      delete autoRangeSources[viewID]?.[dataID];
    } else {
      deleteSecondKey(configs, dataID);
      deleteSecondKey(autoRangeSources, dataID);
    }
  };

  const materializeConfig = (viewID: string, dataID: string) => {
    patchDoubleKeyRecord(configs, viewID, dataID, getConfig(viewID, dataID));
  };
  const serialize = (stateFile: StateFile) => {
    const viewIDs = new Set([
      ...Object.keys(configs),
      ...Object.keys(autoRangeSources),
    ]);
    const effective = Object.fromEntries(
      [...viewIDs].map((viewID) => {
        const dataIDs = new Set([
          ...Object.keys(configs[viewID] ?? {}),
          ...Object.keys(autoRangeSources[viewID] ?? {}),
        ]);
        return [
          viewID,
          Object.fromEntries(
            [...dataIDs].map((dataID) => [dataID, getConfig(viewID, dataID)])
          ),
        ];
      })
    );
    createViewConfigSerializer(effective, 'window')(stateFile);
  };

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
    materializeConfig,
    getConfig,
    getInternalConfig,
    getRange,
    updateConfig,
    resetConfig,
    resetContrast,
    removeView,
    removeData,
    serialize,
    deserialize,
    WindowingUpdateEvent,
    ContrastResetEvent,
  };
});
