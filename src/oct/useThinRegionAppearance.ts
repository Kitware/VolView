import { computed, unref, type MaybeRef } from 'vue';
import type { Maybe } from '@/src/types';
import { useSegmentationStore } from '@/src/segmentation/store';
import { segmentFillAlpha } from '@/src/segmentation/rendering/display';

/** The selected mask uses the same color, visibility, and fill as its source slice. */
export function useThinRegionAppearance(maskId: MaybeRef<Maybe<string>>) {
  const segmentationStore = useSegmentationStore();
  return computed(() => {
    const id = unref(maskId);
    if (!id) return null;
    const descriptor = segmentationStore.labelmapDescriptorByMask[id];
    const segmentation = segmentationStore.segmentationOfMask(id);
    if (!descriptor || !segmentation) return null;
    const alpha = segmentFillAlpha(descriptor, segmentation.fillOpacity);
    let reason: string | null = null;
    if (!descriptor.visible)
      reason = 'Show the selected segment to highlight thin regions.';
    else if (segmentation.fillOpacity <= 0)
      reason = 'Increase segmentation fill opacity to highlight thin regions.';
    else if (alpha <= 0)
      reason =
        'Increase the selected segment opacity to highlight thin regions.';
    return { color: descriptor.color, alpha, reason };
  });
}
