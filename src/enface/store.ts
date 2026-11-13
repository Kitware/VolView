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
  highlightThin: boolean;
  thresholdMicrons: number;
  segmentId: string | null;
  showFootprints: boolean;
  footprintSegmentIds: string[];
  footprintScope: 'slab' | 'volume';
};

export type ThicknessControlState = {
  thresholdMaximum: number;
  segmentationReason: string | null;
  highlightReason: string | null;
  thicknessReason: string | null;
  segments: { value: string; title: string; color?: string }[];
  segmentId: string | null;
  highlightThin: boolean;
};

export type EnFaceViewControlState = {
  axes: { title: string; value: number }[];
  depthMaximum: number;
  projectionReason: string | null;
  thickness: ThicknessControlState;
  footprints: Pick<ThicknessControlState, 'segments' | 'segmentationReason'>;
};

export const defaultEnFaceViewConfig = (): EnFaceViewConfig => ({
  axis: 1,
  method: 'mean',
  depthStart: 0,
  depthEnd: null,
  highlightThin: false,
  thresholdMicrons: 100,
  segmentId: null,
  showFootprints: false,
  footprintSegmentIds: [],
  footprintScope: 'slab',
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

  function deserialize(
    viewID: string,
    config: Record<string, ViewConfig>,
    segmentIdMap: Record<string, string>
  ) {
    Object.entries(config).forEach(([dataID, viewConfig]) => {
      const saved = viewConfig.enFace;
      if (!saved) return;
      Object.assign(configFor(viewID, dataID), saved, {
        segmentId: (saved.segmentId && segmentIdMap[saved.segmentId]) || null,
        footprintSegmentIds: saved.footprintSegmentIds
          .map((id) => segmentIdMap[id])
          .filter((id): id is string => !!id),
      });
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
