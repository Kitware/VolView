import { useSegmentationStore } from '@/src/store/segmentations';
import type { Maybe } from '@/src/types';

/**
 * The labelmap a polygon rasterizes into. Storage is allocated on first use;
 * the active segment is left untouched.
 */
export function resolveRasterizeTarget(
  imageId: string,
  segmentId: Maybe<string>
) {
  if (!segmentId) throw new Error('Polygon has no segment to rasterize into');

  const segmentationStore = useSegmentationStore();
  const segmentation = segmentationStore.getSegmentationForImage(imageId);
  if (!segmentation || !segmentation.segments[segmentId]) {
    throw new Error(`Segment ${segmentId} does not belong to image ${imageId}`);
  }

  segmentationStore.ensureLabelmapBinding(segmentation.id, segmentId);
  const target = segmentationStore.resolveLabelmapBinding(
    segmentation.id,
    segmentId
  );
  if (!target) throw new Error('Failed to allocate labelmap storage');
  return target;
}
