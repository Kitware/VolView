import { useImage } from '@/src/composables/useCurrentImage';
import { useWindowingConfig } from '@/src/composables/useWindowingConfig';
import { WLAutoRanges, WL_AUTO_DEFAULT, WL_HIST_BINS } from '@/src/constants';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import useWindowingStore from '@/src/store/view-configs/windowing';
import { Maybe } from '@/src/types';
import { TypedArray } from '@kitware/vtk.js/types';
import { watchImmediate } from '@vueuse/core';
import { MaybeRef, computed, unref, watch } from 'vue';

function useAutoRangeValues(imageID: MaybeRef<Maybe<string>>) {
  const { imageData } = useImage(imageID);

  const histogram = (
    data: number[] | TypedArray,
    dataRange: number[],
    numberOfBins: number
  ) => {
    const [min, max] = dataRange;
    const width = (max - min + 1) / numberOfBins;
    const hist = new Array(numberOfBins).fill(0);
    data.forEach((value) => hist[Math.floor((value - min) / width)]++);
    return hist;
  };

  const autoRangeValues = computed(() => {
    if (!imageData.value) {
      return {};
    }

    // Pre-compute the auto-range values
    const scalarData = imageData.value.getPointData().getScalars();
    const [min, max] = scalarData.getRange();
    const hist = histogram(scalarData.getData(), [min, max], WL_HIST_BINS);
    const cumm = hist.reduce((acc, val, idx) => {
      const prev = idx !== 0 ? acc[idx - 1] : 0;
      acc.push(val + prev);
      return acc;
    }, []);

    const width = (max - min + 1) / WL_HIST_BINS;
    return Object.fromEntries(
      Object.entries(WLAutoRanges).map(([key, value]) => {
        const startIdx = cumm.findIndex(
          (v: number) => v >= value * 0.01 * scalarData.getData().length
        );
        const endIdx = cumm.findIndex(
          (v: number) => v >= (1 - value * 0.01) * scalarData.getData().length
        );
        const start = Math.max(min, min + width * startIdx);
        const end = Math.min(max, min + width * endIdx + width);
        return [key, [start, end]];
      })
    );
  });

  return { autoRangeValues };
}

export function useWindowingConfigInitializer(
  viewID: MaybeRef<string>,
  imageID: MaybeRef<Maybe<string>>
) {
  const { imageData } = useImage(imageID);
  const dicomStore = useDICOMStore();

  const store = useWindowingStore();
  const { config: windowConfig } = useWindowingConfig(viewID, imageID);
  const { autoRangeValues } = useAutoRangeValues(imageID);
  const autoRange = computed<keyof typeof WLAutoRanges>(
    () => windowConfig.value?.auto || WL_AUTO_DEFAULT
  );

  const firstTag = computed(() => {
    const id = unref(imageID);
    if (id && id in dicomStore.imageIDToVolumeKey) {
      const volKey = dicomStore.imageIDToVolumeKey[id];
      const { WindowWidth, WindowLevel } = dicomStore.volumeInfo[volKey];
      return {
        width: WindowWidth.split('\\')[0],
        level: WindowLevel.split('\\')[0],
      };
    }
    return {};
  });

  watchImmediate(windowConfig, (config) => {
    const image = imageData.value;
    const imageIdVal = unref(imageID);
    const viewIdVal = unref(viewID);
    if (config || !image || !imageIdVal) return;

    const [min, max] = image.getPointData().getScalars().getRange();
    store.updateConfig(viewIdVal, imageIdVal, { min, max });
    store.resetWindowLevel(viewIdVal, imageIdVal);
  });

  watchImmediate(imageData, (image) => {
    const imageIdVal = unref(imageID);
    const config = unref(windowConfig);
    const viewIdVal = unref(viewID);
    if (imageIdVal == null || config != null || !image) {
      return;
    }

    const range = autoRangeValues.value[autoRange.value];
    store.updateConfig(viewIdVal, imageIdVal, {
      min: range[0],
      max: range[1],
    });
    if (firstTag.value?.width) {
      store.updateConfig(viewIdVal, imageIdVal, {
        preset: {
          width: parseFloat(firstTag.value.width),
          level: parseFloat(firstTag.value.level),
        },
      });
    }
    store.resetWindowLevel(viewIdVal, imageIdVal);
  });

  watch(autoRange, (percentile) => {
    const image = imageData.value;
    const imageIdVal = unref(imageID);
    const viewIdVal = unref(viewID);
    if (imageIdVal == null || windowConfig.value == null || !image) {
      return;
    }
    const range = autoRangeValues.value[percentile];
    store.updateConfig(viewIdVal, imageIdVal, {
      min: range[0],
      max: range[1],
    });
    store.resetWindowLevel(viewIdVal, imageIdVal);
  });
}
