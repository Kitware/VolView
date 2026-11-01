import { defineStore } from 'pinia';
import { reactive } from 'vue';
import { createViewConfigSerializer } from '@/src/store/view-configs/common';
import {
  deleteSecondKey,
  getDoubleKeyRecord,
  type DoubleKeyRecord,
} from '@/src/utils/doubleKeyRecord';
import type { ViewConfig } from '@/src/io/state-file/schema';
import type { SlabAxis, SlabMethod } from '@/src/core/slab/types';
import type { Maybe } from '@/src/types';

export type EnFaceViewConfig = {
  axis: SlabAxis;
  method: SlabMethod;
  depthStart: number;
  depthEnd: number | null;
};

export type EnFaceViewControlState = {
  axes: { title: string; value: number }[];
  depthMaximum: number;
  projectionReason: string | null;
};

export const defaultEnFaceViewConfig = (): EnFaceViewConfig => ({
  axis: 1,
  method: 'mean',
  depthStart: 0,
  depthEnd: null,
});

export const useEnFaceViewStore = defineStore('enface-view', () => {
  const configs = reactive<DoubleKeyRecord<EnFaceViewConfig>>({});
  const controlStates = reactive<DoubleKeyRecord<EnFaceViewControlState>>({});

  function configFor(viewID: string, dataID: string) {
    configs[viewID] ??= {};
    configs[viewID][dataID] ??= defaultEnFaceViewConfig();
    return configs[viewID][dataID];
  }

  /** Controls without a volume show, but never store, the defaults. */
  function settingsFor(viewID: string, dataID: Maybe<string>) {
    return (
      (dataID ? getDoubleKeyRecord(configs, viewID, dataID) : undefined) ??
      defaultEnFaceViewConfig()
    );
  }

  function controlStateFor(viewID: string, dataID: string) {
    return getDoubleKeyRecord(controlStates, viewID, dataID);
  }

  function setControlState(
    viewID: string,
    dataID: string,
    state: EnFaceViewControlState
  ) {
    if (!getDoubleKeyRecord(configs, viewID, dataID)) return;
    controlStates[viewID] ??= {};
    controlStates[viewID][dataID] = state;
  }

  function removeView(viewID: string) {
    delete configs[viewID];
    delete controlStates[viewID];
  }

  function removeData(dataID: string, viewID?: string) {
    if (viewID) {
      delete configs[viewID]?.[dataID];
      delete controlStates[viewID]?.[dataID];
    } else {
      deleteSecondKey(configs, dataID);
      deleteSecondKey(controlStates, dataID);
    }
  }

  const serialize = createViewConfigSerializer(configs, 'enFace');

  function deserialize(viewID: string, config: Record<string, ViewConfig>) {
    Object.entries(config).forEach(([dataID, viewConfig]) => {
      if (viewConfig.enFace)
        Object.assign(configFor(viewID, dataID), viewConfig.enFace);
    });
  }

  return {
    configFor,
    settingsFor,
    controlStateFor,
    setControlState,
    removeView,
    removeData,
    serialize,
    deserialize,
  };
});
