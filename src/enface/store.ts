import { defineStore } from 'pinia';
import { useSegmentStore } from '@/src/segmentation/segments';
import { reactive } from 'vue';
import { createViewConfigSerializer } from '@/src/store/view-configs/common';
import {
  deleteSecondKey,
  forEachEntry,
  getDoubleKeyRecord,
  type DoubleKeyRecord,
} from '@/src/utils/doubleKeyRecord';
import type { StateFile, ViewConfig } from '@/src/io/state-file/schema';
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
};

export type ThicknessControlState = {
  thresholdMaximum: number;
  segmentationReason: string | null;
  highlightReason: string | null;
  thicknessReason: string | null;
  segments: { value: string; title: string; color?: string }[];
};

export type EnFaceViewControlState = {
  axes: { title: string; value: number }[];
  depthMaximum: number;
  projectionReason: string | null;
  thickness: ThicknessControlState;
};

export const defaultEnFaceViewConfig = (): EnFaceViewConfig => ({
  axis: 1,
  method: 'mean',
  depthStart: 0,
  depthEnd: null,
  highlightThin: false,
  thresholdMicrons: 100,
  segmentId: null,
});

export const useEnFaceViewStore = defineStore('enface-view', () => {
  const configs = reactive<DoubleKeyRecord<EnFaceViewConfig>>({});
  const controlStates = reactive<DoubleKeyRecord<EnFaceViewControlState>>({});
  const segmentsRegistry = useSegmentStore().segments;

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

  function serialize(stateFile: StateFile) {
    // Saved files name only segments that still exist.
    const saved: DoubleKeyRecord<EnFaceViewConfig> = {};
    forEachEntry(configs, (viewID, dataID, config) => {
      const segmentId =
        segmentsRegistry.getSegment(config.segmentId)?.id ?? null;
      (saved[viewID] ??= {})[dataID] = {
        ...config,
        segmentId,
        highlightThin: config.highlightThin && !!segmentId,
      };
    });
    createViewConfigSerializer(saved, 'enFace')(stateFile);
  }

  function deserialize(
    viewID: string,
    config: Record<string, ViewConfig>,
    segmentIdMap: Record<string, string>
  ) {
    Object.entries(config).forEach(([dataID, viewConfig]) => {
      if (!viewConfig.enFace) return;
      const saved = viewConfig.enFace;
      const segmentId =
        (saved.segmentId && segmentIdMap[saved.segmentId]) || null;
      Object.assign(configFor(viewID, dataID), saved, {
        segmentId,
        highlightThin: saved.highlightThin && !!segmentId,
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
