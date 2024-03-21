import { useImage } from '@/src/composables/useCurrentImage';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import useViewSliceStore from '@/src/store/view-configs/slicing';
import { Maybe } from '@/src/types';
import { LPSAxisDir } from '@/src/types/lps';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import type { vtkRange } from '@kitware/vtk.js/interfaces';
import { watchImmediate } from '@vueuse/core';
import { MaybeRef, computed, toRef, unref } from 'vue';

export function useSliceConfigInitializer(
  viewID: MaybeRef<string>,
  imageID: MaybeRef<Maybe<string>>,
  viewDirection: MaybeRef<LPSAxisDir>,
  slicingDomain?: MaybeRef<vtkRange>
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

  watchImmediate(
    [toRef(sliceDomain), toRef(viewDirection)] as const,
    ([domain, axisDirection]) => {
      const configExisted = !!sliceConfig.value;
      const imageIdVal = unref(imageID);
      if (!imageIdVal) return;
      store.updateConfig(unref(viewID), imageIdVal, {
        ...domain,
        axisDirection,
      });
      if (!configExisted) {
        store.resetSlice(unref(viewID), imageIdVal);
      }
    }
  );
}
