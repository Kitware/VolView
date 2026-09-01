import { useSegmentationStore } from '@/src/store/segmentations';
import type { Maybe } from '@/src/types';

/**
 * The labelmap a polygon rasterizes into. Storage is allocated on first use;
 * the active segment is left untouched when the polygon already names one.
 */
export function resolveRasterizeTarget(
  imageId: string,
  segmentId: Maybe<string>
) {
  const segmentationStore = useSegmentationStore();

  // Rasterizing is itself an edit, so a polygon drawn before any segment exists
  // lands in the default segment rather than failing.
  const owner = segmentId
    ? segmentationStore.getSegmentationForImage(imageId)
    : undefined;
  if (segmentId && !owner?.segments[segmentId]) {
    throw new Error(`Segment ${segmentId} does not belong to image ${imageId}`);
  }

  const resolved =
    segmentId && owner
      ? { segmentationId: owner.id, segmentId }
      : segmentationStore.resolveEditTarget(imageId);

  segmentationStore.ensureLabelmapBinding(
    resolved.segmentationId,
    resolved.segmentId
  );
  const target = segmentationStore.resolveLabelmapBinding(
    resolved.segmentationId,
    resolved.segmentId
  );
  if (!target) throw new Error('Failed to allocate labelmap storage');
  return target;
}
