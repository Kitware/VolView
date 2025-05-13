import { MaybeRef, computed, unref, watch } from 'vue';
import { watchImmediate } from '@vueuse/core';
import { useImage } from '@/src/composables/useCurrentImage';
import { useWindowingConfig } from '@/src/composables/useWindowingConfig';
import { WL_AUTO_DEFAULT } from '@/src/constants';
import { getWindowLevels, useDICOMStore } from '@/src/store/datasets-dicom';
import useWindowingStore from '@/src/store/view-configs/windowing';
import { Maybe } from '@/src/types';
import { useResetViewsEvents } from '@/src/components/tools/ResetViews.vue';
import { isDicomImage } from '@/src/utils/dataSelection';
import { useImageStatsStore } from '@/src/store/image-stats';

export function useWindowingConfigInitializer(
  viewID: MaybeRef<string>,
  imageID: MaybeRef<Maybe<string>>
) {
  const { imageData } = useImage(imageID);
  const dicomStore = useDICOMStore();
  const imageStatsStore = useImageStatsStore();

  const store = useWindowingStore();
  const { config: windowConfig } = useWindowingConfig(viewID, imageID);
  const autoRangeValues = imageStatsStore.getAutoRangeValues(imageID);
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
    if (!range) {
      // This can happen during initial loading and range not computed yet.
      return;
    }
    const width = range[1] - range[0];
    const level = (range[1] + range[0]) / 2;
    store.updateConfig(viewIdVal, imageIdVal, {
      width,
      level,
      useAuto: true,
    });
  });

  useResetViewsEvents().onClick(() => {
    updateConfigFromAutoRangeValues();
  });
}
