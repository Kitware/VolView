import { defineStore } from 'pinia';
import { useSegmentationStore } from '@/src/segmentation/store';
import { reactive } from 'vue';
import { createViewConfigSerializer } from '@/src/store/view-configs/common';
import {
  deleteSecondKey,
  type DoubleKeyRecord,
} from '@/src/utils/doubleKeyRecord';
import type { StateFile, ViewConfig } from '@/src/io/state-file/schema';
import type { ProjectionAxis, ProjectionMethod } from '@/src/oct/types';

export type OCTViewConfig = {
  axis: ProjectionAxis;
  method: ProjectionMethod;
  depthStart: number;
  depthEnd: number | null;
  highlightThin: boolean;
  thresholdMicrons: number;
  selectedMaskId: string | null;
};

export const defaultOCTViewConfig = (): OCTViewConfig => ({
  axis: 1,
  method: 'mean',
  depthStart: 0,
  depthEnd: null,
  highlightThin: false,
  thresholdMicrons: 100,
  selectedMaskId: null,
});

export const useOCTViewStore = defineStore('oct-view', () => {
  const configs = reactive<DoubleKeyRecord<OCTViewConfig>>({});
  const segmentationStore = useSegmentationStore();

  function configFor(viewID: string, dataID: string) {
    configs[viewID] ??= {};
    configs[viewID][dataID] ??= defaultOCTViewConfig();
    return configs[viewID][dataID];
  }

  function removeView(viewID: string) {
    delete configs[viewID];
  }

  function removeData(dataID: string, viewID?: string) {
    if (viewID) delete configs[viewID]?.[dataID];
    else deleteSecondKey(configs, dataID);
  }

  function serialize(stateFile: StateFile) {
    const saved: DoubleKeyRecord<NonNullable<ViewConfig['octEnFace']>> = {};
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
    createViewConfigSerializer(saved, 'octEnFace')(stateFile);
  }

  function deserialize(
    viewID: string,
    config: Record<string, ViewConfig>,
    segmentIdMap: Record<string, string> = {}
  ) {
    Object.entries(config).forEach(([dataID, viewConfig]) => {
      if (viewConfig.octEnFace) {
        const { segmentId, ...settings } = viewConfig.octEnFace;
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

  return { configFor, removeView, removeData, serialize, deserialize };
});
