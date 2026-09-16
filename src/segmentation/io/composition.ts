import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useSegmentationStore } from '@/src/segmentation/store';
import {
  boundScalars,
  groupByLayer,
  writeMaskInto,
} from '@/src/segmentation/masks/overlap';
import {
  allocateLabelmap,
  labelmapScalars,
  LABELMAP_MAX_VALUE,
} from '@/src/segmentation/io/labelmap';
import { type SegmentMask } from '@/src/segmentation/model';
import type { SegmentRegistry } from '@/src/segmentation/segmentRegistry';
import { toLabelmapSegment } from '@/src/segmentation/segment';
import { chunk } from '@/src/utils';

const byRegistryOrder =
  (registry: SegmentRegistry) => (a: SegmentMask, b: SegmentMask) =>
    registry.orderIndexOf(a.segmentId) - registry.orderIndexOf(b.segmentId);

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
      [...part].sort(byRegistryOrder(registry)).map((mask, index) => {
        const bounded = boundScalars(mask.representations.labelmap);
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
  const inRegistryOrder = byRegistryOrder(useSegmentStore().segments);
  const masks = [...useSegmentationStore().imageMasks(parentImageId)].sort(
    (a, b) => {
      if (a.segmentId === preferredSegmentId) return -1;
      if (b.segmentId === preferredSegmentId) return 1;
      return inRegistryOrder(a, b);
    }
  );
  // A mask holding no voxels still takes a label value and ships as an empty
  // segment: a consumer that declared the bin gets to see it came back empty.
  const layers = groupByLayer(masks, (mask) =>
    boundScalars(mask.representations.labelmap)
  );
  const parts = layers.flatMap((layer) => chunk(layer, LABELMAP_MAX_VALUE));
  return {
    parts: parts.length ? parts : [[]],
    hasOverlap: layers.length > 1,
    exceedsCapacity: parts.length > layers.length,
  };
}
