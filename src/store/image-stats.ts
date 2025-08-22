import { defineStore } from 'pinia';
import {
  reactive,
  watch,
  computed,
  MaybeRef,
  unref,
  effectScope,
  type EffectScope,
} from 'vue';
import * as Comlink from 'comlink';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { useVtkComputed } from '@/src/core/vtk/useVtkComputed';
import { WLAutoRanges, WL_HIST_BINS } from '@/src/constants';
import { HistogramWorker } from '@/src/utils/histogram.worker';
import { Maybe } from '@/src/types';
import { useImage } from '@/src/composables/useCurrentImage';
import { ensureError } from '@/src/utils';
import { useImageCacheStore } from './image-cache';
import { useMessageStore } from './messages';

export type ImageStats = {
  scalarMin: number;
  scalarMax: number;
  autoRangeValues?: Record<string, [number, number]>;
};

function getRangesWithCache(scalars: vtkDataArray) {
  const numberOfComponents = scalars.getNumberOfComponents();
  return Array.from({ length: numberOfComponents }, (_, i) => {
    const [min, max] = scalars.getRange(i);
    return { min, max };
  });
}

function getAllComponentRange(scalars: vtkDataArray) {
  const ranges = getRangesWithCache(scalars);

  const min = ranges
    .map((range) => range.min)
    .reduce((acc, val) => Math.min(acc, val), Infinity);
  const max = ranges
    .map((range) => range.max)
    .reduce((acc, val) => Math.max(acc, val), -Infinity);

  return { min, max };
}

async function computeAutoRangeValues(imageData: vtkImageData) {
  const scalars = imageData.getPointData()?.getScalars();
  if (!scalars) {
    return {};
  }

  const worker = Comlink.wrap<HistogramWorker>(
    new Worker(new URL('@/src/utils/histogram.worker.ts', import.meta.url), {
      type: 'module',
    })
  );

  const { min, max } = getAllComponentRange(scalars);
  const scalarData = scalars.getData() as number[];
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

  const statsEffectScope: Record<string, EffectScope> = {};
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
      ...stats[imageID],
      autoRangeValues: autoValues,
    };
  };

  const internalRemoveStats = (imageID: string) => {
    delete stats[imageID];
  };

  const setupImageWatchers = (id: string) => {
    const { imageData, isLoading: isImageLoading } = useImage(
      computed(() => id)
    );

    const activeScalars = computed(() =>
      imageData.value?.getPointData()?.getScalars()
    );
    const scalarRange = useVtkComputed(activeScalars, () =>
      activeScalars.value?.getRange(0)
    );

    watch(
      scalarRange,
      (range) => {
        if (range) {
          internalSetScalarRange(id, range[0], range[1]);
        }
      },
      { immediate: true }
    );

    const triggerAutoRangeComputation = (image: vtkImageData) => {
      autoRangeComputations[id] = computeAutoRangeValues(image);

      autoRangeComputations[id]
        .then((autoValues) => {
          if (imageCacheStore.imageIds.includes(id)) {
            // not deleted yet, save values
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
            ensureError(error)
          );
        })
        .finally(() => {
          delete autoRangeComputations[id];
        });
    };

    watch(
      [imageData, isImageLoading],
      () => {
        if (
          isImageLoading.value ||
          !imageData.value ||
          id in autoRangeComputations ||
          (stats[id] && stats[id].autoRangeValues)
        )
          return;
        triggerAutoRangeComputation(imageData.value);
      },
      { immediate: true }
    );
  };

  const cleanupImage = (id: string) => {
    internalRemoveStats(id);

    if (statsEffectScope[id]) {
      statsEffectScope[id].stop();
      delete statsEffectScope[id];
    }

    if (id in autoRangeComputations) {
      delete autoRangeComputations[id];
    }
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

      removedIds.forEach(cleanupImage);
      addedIds.forEach((id) => {
        if (statsEffectScope[id]) {
          cleanupImage(id);
          console.error(`Setting up stats for ${id} twice!`);
        }
        statsEffectScope[id] = effectScope();
        statsEffectScope[id].run(() => {
          setupImageWatchers(id);
        });
      });
    },
    { immediate: true }
  );

  const getAutoRangeValues = (imageID: MaybeRef<Maybe<string>>) => {
    const id = unref(imageID);
    if (id && stats[id]) {
      return stats[id].autoRangeValues ?? {};
    }
    return {};
  };

  const removeData = (id: string) => {
    delete stats[id];
  };

  return {
    stats,
    getAutoRangeValues,
    removeData,
  };
});
