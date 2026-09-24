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

export type SegmentProjectionDeps = {
  segmentations: Record<string, Segmentation>;
  segmentRegistry: SegmentRegistry;
};

/** One descriptor per bound mask; unchanged appearances retain object identity. */
export function createSegmentProjection({
  segmentations,
  segmentRegistry,
}: SegmentProjectionDeps) {
  function project() {
    const byMask: Record<string, LabelmapSegment> = {};
    Object.values(segmentations).forEach((segmentation) => {
      listMasks(segmentation).forEach((segment) => {
        if (!segment.representations.labelmap) return;
        byMask[segment.id] = toLabelmapSegment(
          segmentRegistry.getSegment(segment.segmentId),
          SEGMENT_VALUE
        );
      });
    });
    return byMask;
  }

  let projected: Record<string, LabelmapSegment> = {};

  return computed(() => {
    const fresh = project();
    const stable = Object.fromEntries(
      Object.entries(fresh).map(([maskId, list]) => {
        const previous = projected[maskId];
        return [
          maskId,
          previous && sameLabelmapSegment(previous, list) ? previous : list,
        ];
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
