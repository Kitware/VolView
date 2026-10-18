import { computed, onScopeDispose, unref, watch, type MaybeRef } from 'vue';
import type { Maybe } from '@/src/types';
import {
  useWindowingStore,
  type WindowingAutoRanges,
} from '@/src/store/view-configs/windowing';
import { useResetViewsEvents } from '@/src/components/tools/ResetViews.vue';

export function useEnFaceWindowing(
  viewId: MaybeRef<string>,
  imageId: MaybeRef<Maybe<string>>,
  autoRanges: MaybeRef<WindowingAutoRanges | null>
) {
  const windowing = useWindowingStore();
  const config = computed(() => {
    const imageID = unref(imageId);
    const shared = imageID
      ? windowing.getConfig(unref(viewId), imageID)
      : undefined;
    return {
      ...shared,
      userTriggered: shared?.userTriggered ?? false,
      width: Math.max(1e-12, shared?.width ?? 1),
      level: shared?.level ?? 0.5,
    };
  });
  watch(
    [() => unref(viewId), () => unref(imageId), () => unref(autoRanges)],
    ([viewID, imageID, ranges], _previous, onCleanup) => {
      if (!imageID || !ranges) return;
      windowing.setAutoRangeValues(viewID, imageID, ranges);
      onCleanup(() => windowing.setAutoRangeValues(viewID, imageID, null));
    },
    { immediate: true, flush: 'sync' }
  );
  const resets = useResetViewsEvents().onClick(() =>
    windowing.resetConfig(unref(viewId), unref(imageId))
  );
  onScopeDispose(resets.off);
  return config;
}
