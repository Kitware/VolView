import { defineStore } from 'pinia';
import { reactive, watch, computed, MaybeRef, unref } from 'vue';
import * as Comlink from 'comlink';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { vtkFieldRef } from '@/src/core/vtk/vtkFieldRef';
import { WLAutoRanges, WL_HIST_BINS } from '@/src/constants';
import { HistogramWorker } from '@/src/utils/histogram.worker';
import { Maybe } from '@/src/types';
import { useImage } from '@/src/composables/useCurrentImage';
import { useImageCacheStore } from './image-cache';
import { useMessageStore } from './messages';

export type ImageStats = {
  scalarMin: number;
  scalarMax: number;
  autoRangeValues?: Record<string, [number, number]>;
};

async function computeAutoRangeValues(
  imageData: ReturnType<typeof useImage>['imageData']['value'],
  isImageLoading: ReturnType<typeof useImage>['isLoading']['value']
): Promise<Record<string, [number, number]>> {
  if (isImageLoading || !imageData) {
    return {};
  }

  const scalars = imageData.getPointData()?.getScalars();
  if (!scalars) {
    return {};
  }

  const worker = Comlink.wrap<HistogramWorker>(
    new Worker(new URL('@/src/utils/histogram.worker.ts', import.meta.url), {
      type: 'module',
    })
  );

  const scalarData = scalars.getData() as number[];
  const { min, max } = vtkDataArray.fastComputeRange(scalarData, 0, 1);
  const hist = await worker.histogram(scalarData, [min, max], WL_HIST_BINS);
  worker[Comlink.releaseProxy]();

  const cumulativeHist: number[] = [];
  hist.reduce((acc, val) => {
    const currentSum = acc + val;
    cumulativeHist.push(currentSum);
    return currentSum;
  }, 0);

  const width = (max - min + 1) / WL_HIST_BINS;
  const totalCount = scalarData.length;

  return Object.fromEntries(
    Object.entries(WLAutoRanges).map(([key, percentage]) => {
      const lowerBound = percentage * 0.01 * totalCount;
      const upperBound = (1 - percentage * 0.01) * totalCount;

      const startIdx = cumulativeHist.findIndex((v) => v >= lowerBound);
      const endIdx = cumulativeHist.findIndex((v) => v >= upperBound);

      const start = Math.max(min, min + width * startIdx);
      const end = Math.min(max, min + width * (endIdx + 1)); // Adjusted end calculation
      return [key, [start, end] as [number, number]];
    })
  );
}

export const useImageStatsStore = defineStore('image-stats', () => {
  const stats = reactive<Record<string, ImageStats>>({});
  const imageCacheStore = useImageCacheStore();
  const messageStore = useMessageStore();

  const scalarRangeWatchers: Record<string, () => void> = {};
  const autoRangeComputations: Record<
    string,
    Promise<Record<string, [number, number]>>
  > = {};

  const internalSetScalarRange = (
    imageID: string,
    min: number,
    max: number
  ) => {
    stats[imageID] = {
      ...stats[imageID],
      scalarMin: min,
      scalarMax: max,
    };
  };

  const internalSetAutoRangeValues = (
    imageID: string,
    autoValues: Record<string, [number, number]>
  ) => {
    stats[imageID] = {
      ...(stats[imageID] ?? { scalarMin: 0, scalarMax: 0 }),
      autoRangeValues: autoValues,
    };
  };

  const internalRemoveStats = (imageID: string) => {
    delete stats[imageID];
  };

  const setupImageWatcher = (id: string) => {
    if (scalarRangeWatchers[id]) {
      scalarRangeWatchers[id]();
    }

    const { imageData, isLoading: isImageLoading } = useImage(
      computed(() => id)
    );

    const activeScalars = computed(() =>
      imageData.value?.getPointData()?.getScalars()
    );
    const scalarRange = vtkFieldRef(activeScalars, 'range');

    scalarRangeWatchers[id] = watch(
      scalarRange,
      (range) => {
        if (imageData.value && range) {
          internalSetScalarRange(id, range[0], range[1]);
        } else {
          internalRemoveStats(id);
        }
      },
      { immediate: true }
    );

    const updateAutoRangeValuesIfNeeded = () => {
      const currentImageData = imageData.value;
      const currentIsLoading = isImageLoading.value;

      if (!currentIsLoading && currentImageData) {
        if (id in autoRangeComputations) {
          return;
        }
        autoRangeComputations[id] = computeAutoRangeValues(
          currentImageData,
          currentIsLoading
        );

        autoRangeComputations[id]
          .then((autoValues) => {
            if (imageCacheStore.imageIds.includes(id)) {
              internalSetAutoRangeValues(id, autoValues);
            }
          })
          .catch((error) => {
            console.error(
              `[ImageStatsStore] Auto range computation for image ${id} FAILED:`,
              error
            );
            messageStore.addError(
              `Auto range computation failed for image ${id}`,
              error instanceof Error ? error : String(error)
            );
            if (imageCacheStore.imageIds.includes(id)) {
              internalSetAutoRangeValues(id, {});
            }
          })
          .finally(() => {
            delete autoRangeComputations[id];
          });
      } else if (!currentImageData) {
        internalSetAutoRangeValues(id, {});
        if (id in autoRangeComputations) {
          delete autoRangeComputations[id];
        }
      }
    };

    watch(
      [imageData, isImageLoading],
      () => {
        updateAutoRangeValuesIfNeeded();
      },
      { immediate: true, deep: false }
    );
  };

  const cleanupImageWatcher = (id: string) => {
    internalRemoveStats(id);
    if (scalarRangeWatchers[id]) {
      scalarRangeWatchers[id]();
      delete scalarRangeWatchers[id];
    }
    delete autoRangeComputations[id];
  };

  watch(
    () => [...imageCacheStore.imageIds],
    (currentImageIds, previousImageIds = []) => {
      const addedIds = currentImageIds.filter(
        (id) => !previousImageIds.includes(id)
      );
      const removedIds = previousImageIds.filter(
        (id) => !currentImageIds.includes(id)
      );

      removedIds.forEach(cleanupImageWatcher);
      addedIds.forEach(setupImageWatcher);
    },
    { immediate: true }
  );

  const getAutoRangeValues = (imageID: MaybeRef<Maybe<string>>) => {
    return computed(() => {
      const id = unref(imageID);
      if (id && stats[id]) {
        return stats[id].autoRangeValues ?? {};
      }
      return {};
    });
  };

  return {
    stats,
    getAutoRangeValues,
  };
});
