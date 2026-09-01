import { useSegmentationStore } from '@/src/store/segmentations';
import type { Maybe } from '@/src/types';

/**
 * The labelmap a polygon rasterizes into. Rasterizing is itself an edit, so it
 * routes through the one entry point that resolves and creates segments: a
 * polygon carrying no segment, or one whose segment was deleted, lands in the
 * default segment rather than failing.
 */
export function resolveRasterizeTarget(
  imageId: string,
  segmentId: Maybe<string>
) {
  const segmentationStore = useSegmentationStore();

  // A live segment owned by another image is a real inconsistency. A stale id,
  // left on the tool when its segment was deleted, is not: it falls through to
  // the default segment below.
  const owner = segmentationStore.getSegmentationForImage(imageId);
  if (
    segmentId &&
    !owner?.segments[segmentId] &&
    segmentationStore.segmentExists(segmentId)
  ) {
    throw new Error(`Segment ${segmentId} does not belong to image ${imageId}`);
  }

  const resolved = segmentationStore.resolveEditTarget(imageId, segmentId);

  const voxels = segmentationStore.segmentVoxels(
    resolved.segmentationId,
    resolved.segmentId
  );
  const binding = voxels.materialize();
  return { ...binding, voxels, segmentId: resolved.segmentId };
}
