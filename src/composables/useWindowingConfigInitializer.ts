import { MaybeRef, computed, unref, watch } from 'vue';
import * as Comlink from 'comlink';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { computedAsync, watchImmediate } from '@vueuse/core';
import { useImage } from '@/src/composables/useCurrentImage';
import { useWindowingConfig } from '@/src/composables/useWindowingConfig';
import { WLAutoRanges, WL_AUTO_DEFAULT, WL_HIST_BINS } from '@/src/constants';
import { getWindowLevels, useDICOMStore } from '@/src/store/datasets-dicom';
import { vtkFieldRef } from '@/src/core/vtk/vtkFieldRef';
import useWindowingStore from '@/src/store/view-configs/windowing';
import { Maybe } from '@/src/types';
import { useResetViewsEvents } from '@/src/components/tools/ResetViews.vue';
import { isDicomImage } from '@/src/utils/dataSelection';
import { HistogramWorker } from '@/src/utils/histogram.worker';

function useAutoRangeValues(imageID: MaybeRef<Maybe<string>>) {
  const { imageData, isLoading: isImageLoading } = useImage(imageID);

  const worker = Comlink.wrap<HistogramWorker>(
    new Worker(new URL('@/src/utils/histogram.worker.ts', import.meta.url), {
      type: 'module',
    })
  );

  const scalars = vtkFieldRef(
    computed(() => imageData.value?.getPointData()),
    'scalars'
  );

  const autoRangeValues = computedAsync(async () => {
    if (isImageLoading.value || !scalars.value) {
      return {};
    }

    // Pre-compute the auto-range values
    const scalarData = scalars.value.getData();
    // Assumes all data is one component
    const { min, max } = vtkDataArray.fastComputeRange(
      scalarData as number[],
      0,
      1
    );
    const hist = await worker.histogram(scalarData, [min, max], WL_HIST_BINS);
    const cumulativeHist = hist.reduce((acc, val, idx) => {
      const prev = idx !== 0 ? acc[idx - 1] : 0;
      acc.push(val + prev);
      return acc;
    }, [] as number[]);

    const width = (max - min + 1) / WL_HIST_BINS;
    return Object.fromEntries(
      Object.entries(WLAutoRanges).map(([key, value]) => {
        const startIdx = cumulativeHist.findIndex(
          (v: number) => v >= value * 0.01 * scalarData.length
        );
        const endIdx = cumulativeHist.findIndex(
          (v: number) => v >= (1 - value * 0.01) * scalarData.length
        );
        const start = Math.max(min, min + width * startIdx);
        const end = Math.min(max, min + width * endIdx + width);
        return [key, [start, end]];
      })
    );
  }, {});

  return { autoRangeValues };
}

export function useWindowingConfigInitializer(
  viewID: MaybeRef<string>,
  imageID: MaybeRef<Maybe<string>>
) {
  const { imageData } = useImage(imageID);
  const dicomStore = useDICOMStore();

  const scalarRange = vtkFieldRef(
    computed(() => imageData.value?.getPointData()?.getScalars()),
    'range'
  );

  const store = useWindowingStore();
  const { config: windowConfig } = useWindowingConfig(viewID, imageID);
  const { autoRangeValues } = useAutoRangeValues(imageID);
  const useAuto = computed(() => windowConfig.value?.useAuto);
  const autoRange = computed(() => windowConfig.value?.auto || WL_AUTO_DEFAULT);

  const firstTag = computed(() => {
    const id = unref(imageID);
    if (id && isDicomImage(id)) {
      const windowLevels = getWindowLevels(dicomStore.volumeInfo[id]);
      if (windowLevels.length) {
        return windowLevels[0];
      }
    }
    return undefined;
  });

  watchImmediate(scalarRange, (range) => {
    const imageIdVal = unref(imageID);
    const viewIdVal = unref(viewID);
    if (!range || !imageIdVal || !viewIdVal) return;
    store.updateConfig(viewIdVal, imageIdVal, { min: range[0], max: range[1] });
  });

  function updateConfigFromAutoRangeValues() {
    const imageIdVal = unref(imageID);
    const viewIdVal = unref(viewID);
    if (imageIdVal == null) {
      return;
    }

    if (autoRange.value in autoRangeValues.value) {
      const [min, max] = autoRangeValues.value[autoRange.value];
      const width = max - min;
      const level = (max + min) / 2;
      store.updateConfig(viewIdVal, imageIdVal, {
        width,
        level,
      });
    }

    const firstTagVal = unref(firstTag);
    if (firstTagVal?.width) {
      store.updateConfig(viewIdVal, imageIdVal, {
        width: firstTagVal.width,
        level: firstTagVal.level,
      });
    }

    const jsonWidthLevel = store.runtimeConfigWindowLevel;
    if (jsonWidthLevel) {
      store.updateConfig(viewIdVal, imageIdVal, {
        ...jsonWidthLevel,
      });
    }
  }

  watchImmediate(
    [imageData, autoRangeValues],
    () => {
      if (!imageData.value) {
        return;
      }

      const config = store.getConfig(unref(viewID), unref(imageID));
      if (config?.userTriggered) {
        return;
      }

      updateConfigFromAutoRangeValues();
    },
    { deep: true }
  );

  watch([useAuto, autoRange, autoRangeValues], () => {
    if (!useAuto.value) {
      return;
    }
    const image = imageData.value;
    const imageIdVal = unref(imageID);
    const viewIdVal = unref(viewID);
    if (imageIdVal == null || windowConfig.value == null || !image) {
      return;
    }
    const range = autoRangeValues.value[autoRange.value];
    const width = range[1] - range[0];
    const level = (range[1] + range[0]) / 2;
    store.updateConfig(viewIdVal, imageIdVal, {
      width,
      level,
    });
  });

  useResetViewsEvents().onClick(() => {
    updateConfigFromAutoRangeValues();
  });
}
