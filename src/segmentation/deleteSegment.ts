import type { SegmentRegistry } from '@/src/segmentation/segmentRegistry';

export function deleteUnlockedSegment(
  registry: SegmentRegistry,
  segmentId: string
) {
  if (
    !registry.getSegment(segmentId) ||
    registry.appearanceOf(segmentId).locked
  )
    return;
  registry.deleteSegment(segmentId);
}
