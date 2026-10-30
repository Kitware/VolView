import { defineStore } from 'pinia';
import { useSegmentationStore } from '@/src/segmentation/store';
import { reactive } from 'vue';
import { createViewConfigSerializer } from '@/src/store/view-configs/common';
import {
  deleteSecondKey,
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
  selectedMaskId: string | null;
};

export type EnFaceViewControlState = {
  axes: { title: string; value: number }[];
  depthMaximum: number;
  thresholdMaximum: number;
  projectionReason: string | null;
  segmentationReason: string | null;
  highlightReason: string | null;
  thicknessReason: string | null;
  segments: { value: string; title: string; color?: string }[];
};

export const defaultEnFaceViewConfig = (): EnFaceViewConfig => ({
  axis: 1,
  method: 'mean',
  depthStart: 0,
  depthEnd: null,
  highlightThin: false,
  thresholdMicrons: 100,
  selectedMaskId: null,
});

export const useEnFaceViewStore = defineStore('enface-view', () => {
  const configs = reactive<DoubleKeyRecord<EnFaceViewConfig>>({});
  const controlStates = reactive<DoubleKeyRecord<EnFaceViewControlState>>({});
  const segmentationStore = useSegmentationStore();

  function configFor(viewID: string, dataID: string) {
    configs[viewID] ??= {};
    configs[viewID][dataID] ??= defaultEnFaceViewConfig();
    return configs[viewID][dataID];
  }

  /** Controls without a volume show, but never store, the defaults. */
  function settingsFor(viewID: string, dataID: Maybe<string>) {
    return dataID ? configFor(viewID, dataID) : defaultEnFaceViewConfig();
  }

  function controlStateFor(viewID: string, dataID: string) {
    return getDoubleKeyRecord(controlStates, viewID, dataID);
  }

  function setControlState(
    viewID: string,
    dataID: string,
    state: EnFaceViewControlState
  ) {
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
    const saved: DoubleKeyRecord<NonNullable<ViewConfig['enFace']>> = {};
    Object.entries(configs).forEach(([viewID, byDataID]) => {
      saved[viewID] = {};
      Object.entries(byDataID).forEach(([dataID, config]) => {
        const selectedMask =
          config.selectedMaskId &&
          segmentationStore.maskExists(config.selectedMaskId)
            ? segmentationStore.getMask(config.selectedMaskId)
            : undefined;
        const segmentId = selectedMask?.segmentId ?? null;
        saved[viewID][dataID] = {
          axis: config.axis,
          method: config.method,
          depthStart: config.depthStart,
          depthEnd: config.depthEnd,
          highlightThin: config.highlightThin && !!segmentId,
          segmentId,
          thresholdMicrons: config.thresholdMicrons,
        };
      });
    });
    createViewConfigSerializer(saved, 'enFace')(stateFile);
  }

  function deserialize(
    viewID: string,
    config: Record<string, ViewConfig>,
    segmentIdMap: Record<string, string> = {}
  ) {
    Object.entries(config).forEach(([dataID, viewConfig]) => {
      if (viewConfig.enFace) {
        const { segmentId, ...settings } = viewConfig.enFace;
        const mappedSegmentId = segmentId ? segmentIdMap[segmentId] : undefined;
        const selectedMaskId =
          segmentationStore.maskFor(dataID, mappedSegmentId)?.id ?? null;
        Object.assign(configFor(viewID, dataID), settings, {
          selectedMaskId,
          highlightThin: settings.highlightThin && !!selectedMaskId,
        });
      }
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
