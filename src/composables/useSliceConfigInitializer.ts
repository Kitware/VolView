import { useSliceConfig } from '@/src/composables/useSliceConfig';
import useViewSliceStore from '@/src/store/view-configs/slicing';
import { Maybe } from '@/src/types';
import { LPSAxisDir } from '@/src/types/lps';
import { MaybeRef, toRef, unref, watch } from 'vue';

export function useSliceConfigInitializer(
  viewID: MaybeRef<string>,
  imageID: MaybeRef<Maybe<string>>,
  viewDirection: MaybeRef<LPSAxisDir>,
  sliceDomain: MaybeRef<{ min: number; max: number }>
) {
  const store = useViewSliceStore();
  const { config: sliceConfig } = useSliceConfig(viewID, imageID);

  watch(
    toRef(sliceDomain),
    (domain) => {
      const imageIdVal = unref(imageID);
      if (!imageIdVal) return;
      store.updateConfig(unref(viewID), imageIdVal, domain);
    },
    { immediate: true }
  );

  watch(
    sliceConfig,
    (config) => {
      const imageIdVal = unref(imageID);
      const viewIdVal = unref(viewID);
      if (config || !imageIdVal) return;
      store.updateConfig(viewIdVal, imageIdVal, {
        ...unref(sliceDomain),
        axisDirection: unref(viewDirection),
      });
      store.resetSlice(viewIdVal, imageIdVal);
    },
    { immediate: true }
  );
}
