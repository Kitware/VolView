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
import { WL_HIST_BINS } from '@/src/constants';
import { histogramWindowRanges } from '@/src/utils/histogram';
import { HistogramWorker } from '@/src/utils/histogram.worker';
import { Maybe } from '@/src/types';
import { useImage } from '@/src/composables/useCurrentImage';
import { ensureError } from '@/src/utils';
import { useImageCacheStore } from './image-cache';
import { useMessageStore } from './messages';
import { isCineImage } from '@/src/core/cine/isCineImage';

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

  const { min, max } = getAllComponentRange(scalars);
  const scalarData = scalars.getData();
  const worker = new Worker(
    new URL('@/src/utils/histogram.worker.ts', import.meta.url),
    { type: 'module' }
  );
  const remote = Comlink.wrap<HistogramWorker>(worker);
  const hist = await remote
    .histogram(scalarData, [min, max], WL_HIST_BINS, 1)
    .finally(() => {
      remote[Comlink.releaseProxy]();
      worker.terminate();
    });

  return histogramWindowRanges(hist, [min, max], 1);
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
    // Cine: 8-bit display-encoded, no histogram.
    if (isCineImage(id)) return;

    const { imageData, isLoading: isImageLoading } = useImage(
      computed(() => id)
    );

    const activeScalars = computed(() =>
      imageData.value?.getPointData()?.getScalars()
    );

    // useVtkComputed listens to VTK onModified events for progressive range updates
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

    // Watch activeScalars directly to handle when entire scalars object is replaced
    // (e.g., SEG DICOM images that replace vtkImageData after loading)
    watch(activeScalars, (scalars) => {
      if (!scalars) return;

      const range = scalars.getRange(0);
      if (range) {
        internalSetScalarRange(id, range[0], range[1]);
      }
    });

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
            { error: ensureError(error) }
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
