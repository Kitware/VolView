import type { SegmentRegistry } from '@/src/segmentation/segmentRegistry';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useMessageStore } from '@/src/store/messages';
import { AnnotationToolStoreMap } from '@/src/store/tools';
import { plural } from '@/src/utils';

/**
 * What deleting a segment is about to take with it, counted before the cascade
 * runs: its mask on every image, and every finished annotation naming it. A
 * tool still being placed is not counted, because the cascade leaves it alone.
 */
function countCascade(segmentId: string) {
  const images = Object.values(useSegmentationStore().segmentations).flatMap(
    (segmentation) =>
      Object.values(segmentation.masks)
        .filter((mask) => mask.segmentId === segmentId)
        .map(() => segmentation.parentImageId)
  );
  const annotations = Object.values(AnnotationToolStoreMap).reduce(
    (total, useStore) =>
      total +
      useStore().finishedTools.filter((tool) => tool.segmentId === segmentId)
        .length,
    0
  );
  return { masks: images.length, images: new Set(images).size, annotations };
}

/**
 * Deletes a segment and says what went with it. The cascade reaches masks on
 * images this one is not viewing and annotations on other slices and axes, so
 * its scope is invisible from here and there is no undo: the same reason
 * `removeSelectedTools` reports its count. No dialog asks first, which is what
 * the rest of the app does.
 */
export function deleteSegmentAndReport(
  registry: SegmentRegistry,
  segmentId: string
) {
  if (!registry.getSegment(segmentId)) return;
  const { masks, images, annotations } = countCascade(segmentId);
  registry.deleteSegment(segmentId);

  const removed = [
    masks > 0 &&
      `${masks} ${plural(masks, 'mask')} on ${images} ${plural(images, 'image')}`,
    annotations > 0 && `${annotations} ${plural(annotations, 'annotation')}`,
  ].filter((part): part is string => !!part);
  if (removed.length > 0)
    useMessageStore().addInfo(`Deleted ${removed.join(' and ')}`);
}
