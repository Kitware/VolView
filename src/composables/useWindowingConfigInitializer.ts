import { MaybeRef, computed, unref } from 'vue';
import { watchImmediate } from '@vueuse/core';
import { useImage } from '@/src/composables/useCurrentImage';
import { getWindowLevels, useDICOMStore } from '@/src/store/datasets-dicom';
import { useWindowingStore } from '@/src/store/view-configs/windowing';
import { Maybe } from '@/src/types';
import { useResetViewsEvents } from '@/src/components/tools/ResetViews.vue';
import { isDicomImage } from '@/src/utils/dataSelection';
import { WL_AUTO_DEFAULT } from '../constants';

export function useWindowingConfigInitializer(
  viewID: MaybeRef<string>,
  imageID: MaybeRef<Maybe<string>>
) {
  const { imageData } = useImage(imageID);
  const dicomStore = useDICOMStore();

  const store = useWindowingStore();
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

  function resetWidthLevel() {
    const imageIdVal = unref(imageID);
    const viewIdVal = unref(viewID);
    if (imageIdVal == null) {
      return;
    }

    store.updateConfig(viewIdVal, imageIdVal, {
      auto: WL_AUTO_DEFAULT,
    });

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
    [imageData],
    () => {
      const imageIdValue = unref(imageID);
      if (!imageData.value || !imageIdValue) {
        return;
      }

      const config = store.getConfig(unref(viewID), imageIdValue).value;
      if (config?.userTriggered) {
        return;
      }

      resetWidthLevel();
    },
    { deep: true }
  );

  useResetViewsEvents().onClick(() => {
    resetWidthLevel();
  });
}
