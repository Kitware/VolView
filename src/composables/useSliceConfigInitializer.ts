import { useImage } from '@/src/composables/useCurrentImage';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import useViewSliceStore from '@/src/store/view-configs/slicing';
import { Maybe } from '@/src/types';
import { LPSAxisDir } from '@/src/types/lps';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import { watchImmediate } from '@vueuse/core';
import { MaybeRef, computed, toRef, unref } from 'vue';

export function useSliceConfigInitializer(
  viewID: MaybeRef<string>,
  imageID: MaybeRef<Maybe<string>>,
  viewDirection: MaybeRef<LPSAxisDir>,
  slicingDomain?: MaybeRef<{ min: number; max: number }>
) {
  const store = useViewSliceStore();
  const { config: sliceConfig } = useSliceConfig(viewID, imageID);
  const { metadata } = useImage(imageID);

  const viewAxis = computed(() => getLPSAxisFromDir(unref(viewDirection)));
  const sliceDomain = computed(() => {
    const domainArg = unref(slicingDomain);
    if (domainArg) return domainArg;
    const { lpsOrientation, dimensions } = metadata.value;
    const ijkIndex = lpsOrientation[viewAxis.value];
    const dimMax = dimensions[ijkIndex];

    return {
      min: 0,
      max: dimMax - 1,
    };
  });

  watchImmediate(toRef(sliceDomain), (domain) => {
    const imageIdVal = unref(imageID);
    if (!imageIdVal) return;
    store.updateConfig(unref(viewID), imageIdVal, domain);
  });

  watchImmediate(sliceConfig, (config) => {
    const imageIdVal = unref(imageID);
    const viewIdVal = unref(viewID);
    if (config || !imageIdVal) return;
    store.updateConfig(viewIdVal, imageIdVal, {
      ...unref(sliceDomain),
      axisDirection: unref(viewDirection),
    });
    store.resetSlice(viewIdVal, imageIdVal);
  });
}
