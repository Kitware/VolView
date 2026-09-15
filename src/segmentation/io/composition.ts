import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
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
  const snapshot = captureLabelmapParts(parentImageId, [
    members ?? useSegmentationStore().imageMasks(parentImageId),
  ]);
  return composeLabelmapPart(snapshot.parent, snapshot.parts[0]);
}

/** Snapshot bounded geometry and appearance without allocating full-volume parts. */
export function captureLabelmapParts(
  parentImageId: string,
  parts: SegmentMask[][]
) {
  const source = useImageCacheStore().getVtkImageData(parentImageId);
  if (!source) throw new Error('No such parent image');
  const parent = vtkImageData.newInstance({
    origin: [...source.getOrigin()],
    spacing: [...source.getSpacing()],
    direction: [...source.getDirection()],
  });
  parent.setDimensions(source.getDimensions());
  parent.computeTransforms();
  const registry = useSegmentStore().segments;
  return {
    parent,
    parts: parts.map((part) =>
      [...part]
        .sort(
          (a, b) =>
            registry.orderIndexOf(a.segmentId) -
            registry.orderIndexOf(b.segmentId)
        )
        .map((mask, index) => {
          const bounded = boundedMask(mask.representations.labelmap);
          return {
            descriptor: toLabelmapSegment(
              registry.getSegment(mask.segmentId),
              index + 1
            ),
            bounded: bounded && {
              ...bounded,
              scalars: bounded.scalars.slice(),
            },
          };
        })
    ),
  };
}

type CapturedPart = ReturnType<typeof captureLabelmapParts>['parts'][number];

export function composeLabelmapPart(parent: vtkImageData, part: CapturedPart) {
  const labelmap = allocateLabelmap(parent, part.length);
  const values = labelmapScalars(labelmap);
  for (const { descriptor, bounded } of [...part].reverse()) {
    if (bounded)
      writeMaskInto(values, parent.getDimensions(), bounded, descriptor.value);
  }
  return { labelmap, segments: part.map(({ descriptor }) => descriptor) };
}

/** Plan overlap-free files and retain why more than one file is necessary. */
export function planLabelmapExport(
  parentImageId: string,
  preferredSegmentId?: string
) {
  const registry = useSegmentStore().segments;
  const masks = [...useSegmentationStore().imageMasks(parentImageId)].sort(
    (a, b) => {
      if (a.segmentId === preferredSegmentId) return -1;
      if (b.segmentId === preferredSegmentId) return 1;
      return (
        registry.orderIndexOf(a.segmentId) - registry.orderIndexOf(b.segmentId)
      );
    }
  );
  // A mask holding no voxels still takes a label value and ships as an empty
  // segment: a consumer that declared the bin gets to see it came back empty.
  const layers = groupByLayer(masks, (segment) =>
    boundedMask(segment.representations.labelmap)
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
