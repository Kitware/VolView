import { computed, unref, type MaybeRef } from 'vue';
import type { Maybe } from '@/src/types';
import { useSegmentationStore } from '@/src/segmentation/store';
import { labelmapAppearance } from '@/src/segmentation/rendering/display';

/** The selected mask uses its source slice's normal fill and outline settings. */
export function useThinRegionAppearance(maskId: MaybeRef<Maybe<string>>) {
  const segmentationStore = useSegmentationStore();
  return computed(() => {
    const id = unref(maskId);
    if (!id) return null;
    const descriptor = segmentationStore.labelmapDescriptorByMask[id];
    const segmentation = segmentationStore.segmentationOfMask(id);
    if (!descriptor || !segmentation) return null;
    const appearance = labelmapAppearance(descriptor, segmentation);
    let reason: string | null = null;
    if (!descriptor.visible)
      reason = 'Show the selected segment to highlight thin regions.';
    else if (
      appearance.fillOpacity <= 0 &&
      (appearance.outlineThickness <= 0 || appearance.outlineOpacity <= 0)
    )
      reason =
        'Increase segmentation fill opacity or enable an outline to highlight thin regions.';
    return { ...appearance, reason };
  });
}
