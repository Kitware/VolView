import { computed } from 'vue';

import type { SegmentRegistry } from '@/src/segmentation/segmentRegistry';
import {
  sameLabelmapSegment,
  toLabelmapSegment,
} from '@/src/segmentation/segment';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import {
  listMasks,
  type LabelmapSegment,
  type Segmentation,
} from '@/src/segmentation/model';

type SegmentProjectionDeps = {
  segmentations: Record<string, Segmentation>;
  segmentRegistry: SegmentRegistry;
};

/** One descriptor per bound mask; unchanged appearances retain object identity. */
export function createSegmentProjection({
  segmentations,
  segmentRegistry,
}: SegmentProjectionDeps) {
  return computed((previous: Record<string, LabelmapSegment> = {}) => {
    const stable = Object.fromEntries(
      Object.values(segmentations)
        .flatMap(listMasks)
        .filter((mask) => mask.representations.labelmap)
        .map((mask) => {
          const fresh = toLabelmapSegment(
            segmentRegistry.getSegment(mask.segmentId),
            SEGMENT_VALUE
          );
          const kept = previous[mask.id];
          return [
            mask.id,
            kept && sameLabelmapSegment(kept, fresh) ? kept : fresh,
          ] as const;
        })
    );
    // The record's own identity is what a consumer of the whole projection
    // watches, so it survives a change that left every mask alone.
    const unchanged =
      Object.keys(stable).length === Object.keys(previous).length &&
      Object.entries(stable).every(
        ([id, descriptor]) => previous[id] === descriptor
      );
    return unchanged ? previous : stable;
  });
}
