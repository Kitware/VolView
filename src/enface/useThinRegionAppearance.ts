import { computed, unref, type MaybeRef } from 'vue';
import type { Maybe } from '@/src/types';
import { useSegmentStore } from '@/src/segmentation/segments';
import { toLabelmapSegment } from '@/src/segmentation/segment';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import { labelmapAppearance } from '@/src/segmentation/rendering/display';

/** The selected mask uses its source slice's normal fill and outline settings. */
export function useThinRegionAppearance(segmentId: MaybeRef<Maybe<string>>) {
  const registry = useSegmentStore().segments;
  return computed(() => {
    const id = unref(segmentId);
    if (!id || !registry.maskOf(id)) return null;
    const descriptor = toLabelmapSegment(
      registry.getSegment(id),
      SEGMENT_VALUE
    );
    const appearance = labelmapAppearance(
      descriptor,
      registry.displayOf(registry.ownerImageId(id))
    );
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
