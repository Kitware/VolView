import { computed, unref, watch, type MaybeRef } from 'vue';
import type { Maybe } from '@/src/types';
import type { WindowingAutoRanges } from '@/src/constants';
import { useWindowingStore } from '@/src/store/view-configs/windowing';

export function useViewWindowingRanges(
  viewId: MaybeRef<string>,
  imageId: MaybeRef<Maybe<string>>,
  autoRanges: MaybeRef<WindowingAutoRanges | null>
) {
  const windowing = useWindowingStore();
  watch(
    [() => unref(viewId), () => unref(imageId), () => unref(autoRanges)],
    ([viewID, imageID, ranges]) => {
      if (imageID) {
        windowing.setAutoRangeValues(viewID, imageID, ranges);
        windowing.materializeConfig(viewID, imageID);
      }
    },
    { immediate: true }
  );
  return computed(() => {
    const imageID = unref(imageId);
    const shared = imageID
      ? windowing.getConfig(unref(viewId), imageID)
      : undefined;
    const width = shared?.width ?? 1;
    return {
      ...shared,
      width: Number.isFinite(width) && width > 0 ? width : 1,
      level: shared?.level ?? 0.5,
    };
  });
}
