import { useSegmentationEditsStore } from '@/src/segmentation/editing/coordinator';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useSegmentationStore } from '@/src/segmentation/store';
import { groupByLayer, writeMaskInto } from '@/src/segmentation/masks/overlap';
import { boundedMask } from '@/src/segmentation/masks/voxelAccess';
import {
  allocateLabelmap,
  labelmapScalars,
  LABELMAP_MAX_VALUE,
} from '@/src/segmentation/io/labelmap';
import { type SegmentMask } from '@/src/segmentation/model';
import { toLabelmapSegment } from '@/src/segmentation/segment';

/**
 * The given segments as one parent-shaped labelmap, built on demand and never
 * stored: what leaves VolView means the whole segmentation, not one segment's
 * bounded mask. Earlier in the registry wins where two segments overlap, which
 * is the order their actors stack in, so the flattened file resolves an
 * overlap the way the screen did. `members` defaults to the image's segments;
 * an export passes one group so no overlap is flattened away.
 */
export function compositeLabelmap(
  parentImageId: string,
  members?: SegmentMask[]
) {
  useSegmentationEditsStore().beforeRead();
  const imageCacheStore = useImageCacheStore();
  const segmentRegistry = useSegmentStore().segments;
  const imageMasks = useSegmentationStore().imageMasks;
  const parent = imageCacheStore.getVtkImageData(parentImageId);
  if (!parent) throw new Error('No such parent image');

  const dimensions = parent.getDimensions();

  const included = [...(members ?? imageMasks(parentImageId))].sort(
    (first, second) =>
      segmentRegistry.orderIndexOf(first.segmentId) -
      segmentRegistry.orderIndexOf(second.segmentId)
  );
  const labelmap = allocateLabelmap(parent, included.length);
  const values = labelmapScalars(labelmap);
  const segments = included.map((segment, index) =>
    toLabelmapSegment(segmentRegistry.getSegment(segment.segmentId), index + 1)
  );
  [...included].reverse().forEach((segment, index) => {
    const bounded = boundedMask(segment.representations.labelmap);
    const labelValue = segments[included.length - 1 - index].value;
    if (bounded) writeMaskInto(values, dimensions, bounded, labelValue);
  });

  return { labelmap, segments };
}

/** Plan overlap-free files and retain why more than one file is necessary. */
export function planLabelmapExport(parentImageId: string) {
  const layers = groupByLayer(
    useSegmentationStore().imageMasks(parentImageId),
    (segment) => boundedMask(segment.representations.labelmap)
  );
  const parts = layers.flatMap((layer) =>
    Array.from(
      { length: Math.max(1, Math.ceil(layer.length / LABELMAP_MAX_VALUE)) },
      (_, index) =>
        layer.slice(
          index * LABELMAP_MAX_VALUE,
          (index + 1) * LABELMAP_MAX_VALUE
        )
    )
  );
  return {
    parts: parts.length ? parts : [[]],
    hasOverlap: layers.length > 1,
    exceedsCapacity: layers.some((layer) => layer.length > LABELMAP_MAX_VALUE),
  };
}
