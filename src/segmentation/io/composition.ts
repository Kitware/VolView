import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentStore } from '@/src/segmentation/segments';
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
import { type SegmentMaskEntry } from '@/src/segmentation/model';
import type { SegmentRegistry } from '@/src/segmentation/segmentRegistry';
import { toLabelmapSegment } from '@/src/segmentation/segment';
import { chunk } from '@/src/utils';

const byRegistryOrder =
  (registry: SegmentRegistry) => (a: SegmentMaskEntry, b: SegmentMaskEntry) =>
    registry.orderIndexOf(a.segmentId) - registry.orderIndexOf(b.segmentId);

/** Snapshot bounded geometry and appearance without allocating full-volume parts. */
export function captureLabelmapParts(
  parentImageId: string,
  parts: SegmentMaskEntry[][]
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
        const bounded = boundScalars(mask.binding);
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
  // Already in registry order, so only the preferred segment moves.
  const masks = useSegmentStore().segments.imageMasks(parentImageId);
  const preferred = masks.filter(
    ({ segmentId }) => segmentId === preferredSegmentId
  );
  const ordered = [
    ...preferred,
    ...masks.filter(({ segmentId }) => segmentId !== preferredSegmentId),
  ];
  const layers = groupByLayer(ordered, (mask) => boundScalars(mask.binding));
  const parts = layers.flatMap((layer) => chunk(layer, LABELMAP_MAX_VALUE));
  return {
    parts: parts.length ? parts : [[]],
    hasOverlap: layers.length > 1,
    exceedsCapacity: parts.length > layers.length,
  };
}
