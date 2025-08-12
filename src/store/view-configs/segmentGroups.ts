import { reactive, computed, unref, MaybeRef } from 'vue';
import { defineStore } from 'pinia';

import {
  DoubleKeyRecord,
  deleteSecondKey,
  getDoubleKeyRecord,
  patchDoubleKeyRecord,
} from '@/src/utils/doubleKeyRecord';
import { Maybe } from '@/src/types';

import { createViewConfigSerializer } from '@/src/store/view-configs/common';
import { ViewConfig } from '@/src/io/state-file/schema';
import { SegmentGroupConfig } from '@/src/store/view-configs/types';
import { useViewStore } from '@/src/store/views';

type Config = SegmentGroupConfig;
const CONFIG_NAME = 'segmentGroup';

export const defaultConfig = () => ({
  outlineOpacity: 1.0,
  outlineThickness: 2,
});

export const useSegmentGroupConfigStore = defineStore(
  `${CONFIG_NAME}Config`,
  () => {
    const configs = reactive<DoubleKeyRecord<Config>>({});

    const getConfig = (viewID: Maybe<string>, dataID: Maybe<string>) =>
      getDoubleKeyRecord(configs, viewID, dataID) ?? defaultConfig();

    const updateConfig = (
      viewID: string,
      dataID: string,
      patch: Partial<Config>
    ) => {
      const config = {
        ...defaultConfig(),
        ...getConfig(viewID, dataID),
        ...patch,
      };

      patchDoubleKeyRecord(configs, viewID, dataID, config);
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

    const serialize = createViewConfigSerializer(configs, CONFIG_NAME);

    const deserialize = (
      viewID: string,
      config: Record<string, ViewConfig>
    ) => {
      Object.entries(config).forEach(([dataID, viewConfig]) => {
        if (viewConfig.segmentGroup) {
          updateConfig(viewID, dataID, viewConfig.segmentGroup);
        }
      });
    };

    // For updating all configs together //

    const aConfig = computed(() => {
      const viewIDs = Object.keys(configs);
      if (viewIDs.length === 0) return null;
      const firstViewID = viewIDs[0];
      const dataIDs = Object.keys(configs[firstViewID]);
      if (dataIDs.length === 0) return null;
      const firstDataID = dataIDs[0];
      return configs[firstViewID][firstDataID];
    });

    const updateAllConfigs = (dataID: string, patch: Partial<Config>) => {
      Object.keys(configs).forEach((viewID) => {
        updateConfig(viewID, dataID, patch);
      });
    };

    return {
      configs,
      getConfig,
      updateConfig,
      removeView,
      removeData,
      serialize,
      deserialize,
      aConfig,
      updateAllConfigs,
    };
  }
);

export const useGlobalSegmentGroupConfig = (dataId: MaybeRef<string>) => {
  const store = useSegmentGroupConfigStore();
  const viewStore = useViewStore();

  const views = computed(() =>
    viewStore.getAllViews().filter((view) => view.type === '2D')
  );

  const configs = computed(() =>
    views.value.map((view) => ({
      config: store.getConfig(view.id, unref(dataId)),
      viewID: view.id,
    }))
  );

  // get any one
  const config = computed(() => configs.value.find(({ config: c }) => c));

  // update all configs
  const updateConfig = (patch: Partial<Config>) => {
    configs.value.forEach(({ viewID }) =>
      store.updateConfig(viewID, unref(dataId), patch)
    );
  };

  return { config, updateConfig };
};
