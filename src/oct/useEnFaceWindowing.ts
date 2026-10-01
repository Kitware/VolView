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
  let registered: { viewID: string; imageID: string } | null = null;
  function clearRanges() {
    if (!registered) return;
    windowing.setAutoRangeValues(registered.viewID, registered.imageID, null);
    registered = null;
  }
  watch(
    [() => unref(viewId), () => unref(imageId), () => unref(autoRanges)],
    ([viewID, imageID, ranges]) => {
      if (
        registered &&
        (registered.viewID !== viewID ||
          registered.imageID !== imageID ||
          !ranges)
      )
        clearRanges();
      if (!imageID || !ranges) return;
      windowing.setAutoRangeValues(viewID, imageID, ranges);
      registered = { viewID, imageID };
    },
    { immediate: true, flush: 'sync' }
  );
  onScopeDispose(clearRanges);
  const resets = useResetViewsEvents().onClick(() =>
    windowing.resetConfig(unref(viewId), unref(imageId))
  );
  onScopeDispose(resets.off);
  return config;
}
