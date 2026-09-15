import { useSegmentationEditsStore } from '@/src/segmentation/editing/coordinator';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useSegmentationStore } from '@/src/segmentation/store';
import { allocateMask } from '@/src/segmentation/masks/storage';
import {
  boundScalars,
  groupByLayer,
  writeMaskInto,
} from '@/src/segmentation/masks/overlap';
import {
  LABELMAP_MAX_VALUE,
  nextUnusedLabelValue,
} from '@/src/segmentation/masks/labelValue';
import {
  fullExtent,
  maskScalars,
  type SegmentMask,
  type LabelmapBinding,
  type LabelmapSegment,
} from '@/src/segmentation/model';
import { toLabelmapSegment } from '@/src/segmentation/segment';

const boundedMask = (binding?: LabelmapBinding) =>
  binding && boundScalars(binding.image, binding.extent);

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
  const labelmap = allocateMask(parent, fullExtent(dimensions));
  const values = maskScalars(labelmap);

  const included = [...(members ?? imageMasks(parentImageId))].sort(
    (first, second) =>
      segmentRegistry.orderIndexOf(first.segmentId) -
      segmentRegistry.orderIndexOf(second.segmentId)
  );
  // One file carries one label per voxel, so the values are assigned here
  // rather than read off the masks, which all hold SEGMENT_VALUE. Callers
  // pass a group layeredSegments already sized to fit them.
  const used = new Set<number>();
  const segments: LabelmapSegment[] = [];
  included.forEach((segment) => {
    const labelValue = nextUnusedLabelValue(used, LABELMAP_MAX_VALUE);
    used.add(labelValue);
    segments.push(
      toLabelmapSegment(
        segmentRegistry.getSegment(segment.segmentId),
        labelValue
      )
    );
  });
  [...included].reverse().forEach((segment, index) => {
    const bounded = boundedMask(segment.representations.labelmap);
    const labelValue = segments[included.length - 1 - index].value;
    if (bounded) writeMaskInto(values, dimensions, bounded, labelValue);
  });

  return { labelmap, segments };
}

/**
 * The image's segments grouped so no group holds an overlap. A labelmap file
 * carries one label per voxel, so an export writes a file per group. Always
 * at least one group: an image with no segments still exports one file.
 */
export function layeredSegments(parentImageId: string) {
  const groups = groupByLayer(
    useSegmentationStore().imageMasks(parentImageId),
    (segment) => boundedMask(segment.representations.labelmap)
  );
  // One byte per voxel caps a file's segments however little they overlap,
  // so a group past the cap is split into files that fit.
  const sized = groups.flatMap((group) =>
    group.length <= LABELMAP_MAX_VALUE
      ? [group]
      : Array.from(
          { length: Math.ceil(group.length / LABELMAP_MAX_VALUE) },
          (_, n) =>
            group.slice(n * LABELMAP_MAX_VALUE, (n + 1) * LABELMAP_MAX_VALUE)
        )
  );
  return sized.length ? sized : [[]];
}
