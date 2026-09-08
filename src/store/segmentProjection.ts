import { computed } from 'vue';

import type { SegmentRegistry } from '@/src/store/tools/segmentRegistry';
import { sameLabelmapSegments, toLabelmapSegment } from '@/src/types/segment';
import { SEGMENT_VALUE } from '@/src/store/segmentLabelValue';
import {
  listMasks,
  type LabelmapSegment,
  type Segmentation,
} from '@/src/types/segmentation';

/** What the projection needs from the store that owns the records. */
export type SegmentProjectionDeps = {
  segmentations: Record<string, Segmentation>;
  segmentRegistry: SegmentRegistry;
};

/**
 * The value-keyed projection the labelmap renderer colors by, one list per
 * bound mask. Any change to any segment rebuilds it, but a mask whose own list
 * is unchanged keeps its previous array: a representation reads one mask's
 * entry, and a fresh array there costs it a transfer function and label
 * outline table rebuild in every view it draws in.
 */
export function createSegmentProjection({
  segmentations,
  segmentRegistry,
}: SegmentProjectionDeps) {
  function project() {
    const byMask: Record<string, LabelmapSegment[]> = {};
    Object.values(segmentations).forEach((segmentation) => {
      listMasks(segmentation).forEach((segment) => {
        if (!segment.representations.labelmap) return;
        byMask[segment.id] = [
          toLabelmapSegment(
            segmentRegistry.getSegment(segment.segmentId),
            SEGMENT_VALUE
          ),
        ];
      });
    });
    return byMask;
  }

  let projected: Record<string, LabelmapSegment[]> = {};

  return computed(() => {
    const fresh = project();
    const stable = Object.fromEntries(
      Object.entries(fresh).map(([maskId, list]) => {
        const previous = projected[maskId];
        return [maskId, sameLabelmapSegments(previous, list) ? previous : list];
      })
    );
    // The record's own identity is what a consumer of the whole projection
    // watches, so it survives a change that left every mask alone.
    const unchanged =
      Object.keys(stable).length === Object.keys(projected).length &&
      Object.entries(stable).every(([id, list]) => projected[id] === list);
    if (!unchanged) projected = stable;
    return projected;
  });
}
