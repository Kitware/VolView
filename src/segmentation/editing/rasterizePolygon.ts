import { fillPoly } from '@thi.ng/rasterize';
import type { IGrid2D } from '@thi.ng/api';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { TypedArray, Vector2, Vector3 } from '@kitware/vtk.js/types';
import { containsPoint } from '@kitware/vtk.js/Common/DataModel/BoundingBox';

import { useImageCacheStore } from '@/src/store/image-cache';
import { useMessageStore } from '@/src/store/messages';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import type { Maybe } from '@/src/types';
import type { LPSAxis } from '@/src/types/lps';
import {
  clipExtent,
  emptyExtent,
  fullExtent,
  isEmptyExtent,
  type Extent3D,
} from '@/src/segmentation/geometry';
import { getLPSDirections } from '@/src/utils/lps';

export function rasterizeTargetDisabledReason(segmentId: Maybe<string>) {
  const registry = useSegmentStore().segments;
  const preferred = registry.getSegment(segmentId);
  const effective =
    preferred ??
    registry.selectedSegment.value ??
    registry.segmentList.value[0];
  return effective?.locked ? 'Unlock this segment to rasterize into it' : '';
}

/**
 * The labelmap a polygon rasterizes into, absent when the record it lands in
 * is locked. Rasterizing is itself an edit, so it routes through the one entry
 * point that resolves and creates masks: a polygon carrying no segment, or one
 * whose segment was deleted, lands in the selected segment rather than failing.
 */
export function resolveRasterizeTarget(
  imageId: string,
  segmentId: Maybe<string>
) {
  const segmentationStore = useSegmentationStore();

  // A locked segment is not editable, the same refusal paint and the processes
  // make. Asked of the segment before the target is resolved, since resolving
  // mints the mask record and its segmentation: a refused polygon leaves
  // neither behind. A locked neighbour is a different rule and keeps the voxels
  // a fill claims, which an aimed `voxelClaim` already honours.
  if (segmentationStore.editTargetLocked(segmentId)) {
    useMessageStore().addError('Cannot rasterize into a locked segment');
    return undefined;
  }

  const resolved = segmentationStore.resolveEditTarget(imageId, segmentId);
  const voxels = segmentationStore.maskVoxels(resolved);
  // The binding's extent goes stale the moment the fill grows the mask, so
  // the accessor is what travels, not anything read off it now.
  voxels.materialize();
  return {
    labelValue: SEGMENT_VALUE,
    voxels,
    maskId: resolved,
    segmentId: segmentationStore.getMask(resolved).segmentId,
  };
}

/** A grid over the parent's index space, writing into the mask's own buffer. */
function createGridAccessor(
  parent: vtkImageData,
  mask: { image: vtkImageData; pixelData: TypedArray; extent: Extent3D },
  plane: { slice: number; axisIdx: 0 | 1 | 2 }, // i/j/k
  onFilled: (ijk: Vector3) => void
): IGrid2D {
  const { slice, axisIdx } = plane;
  const { extent } = mask;
  const axisDims = parent.getDimensions();
  axisDims.splice(axisIdx, 1);
  const convertTo3D = (a: number, b: number) => {
    const point = [a, b];
    point.splice(axisIdx, 0, slice);
    return point as Vector3;
  };

  return {
    size: axisDims,
    setAtUnsafe(d0: number, d1: number, value: number): boolean {
      const ijk = convertTo3D(d0, d1);
      if (containsPoint(extent, ...ijk)) {
        const offset = mask.image.computeOffsetIndex([
          ijk[0] - extent[0],
          ijk[1] - extent[2],
          ijk[2] - extent[4],
        ]);
        // XXX assumes single-component image
        mask.pixelData[offset] = value;
        onFilled(ijk);
        return true;
      }
      return false;
    },
  } as unknown as IGrid2D;
}

/** The box the polygon spans on its slice, in parent index space. */
function polygonBounds(
  indexPoints: number[][],
  axisIndex: 0 | 1 | 2,
  slice: number
): Extent3D {
  if (indexPoints.length === 0) return emptyExtent();
  const bounds = [0, 0, 0, 0, 0, 0] as Extent3D;
  [0, 1, 2].forEach((axis) => {
    if (axis === axisIndex) {
      bounds[axis * 2] = slice;
      bounds[axis * 2 + 1] = slice;
      return;
    }
    const values = indexPoints.map((point) => point[axis]);
    bounds[axis * 2] = Math.floor(Math.min(...values));
    bounds[axis * 2 + 1] = Math.ceil(Math.max(...values));
  });
  return bounds;
}

/**
 * Fills a polygon into its segment's mask. The write lives here rather than in
 * the tool component because it is a voxel operation: the mask has to grow to
 * hold the polygon before `fillPoly` runs, since a mask that does not reach a
 * pixel swallows it silently, and the filled voxels have to be cleared in the
 * other segments of the image. World points, parent slice index. Edit target resolution cancels any competing preview before storage changes.
 */
export function rasterizePolygon({
  imageId,
  segmentId,
  points,
  slice,
  viewAxis,
}: {
  imageId: string;
  segmentId: Maybe<string>;
  points: Vector3[];
  slice: number;
  viewAxis: LPSAxis;
}) {
  const segmentationStore = useSegmentationStore();
  const parent = useImageCacheStore().getVtkImageData(imageId);
  if (!parent) throw new Error('No such parent image');

  const axisIndex = getLPSDirections(parent.getDirection())[viewAxis];
  const indexPoints = points.map((point) => [...parent.worldToIndex(point)]);

  // The part of the image the polygon lands on: what the mask has to grow to
  // hold, and the only place this fill can take a voxel from a neighbour.
  // Asked before the target is resolved, since resolving mints the mask record
  // and its storage: a polygon covering nothing leaves neither behind.
  const polygonExtent = clipExtent(
    polygonBounds(indexPoints, axisIndex, slice),
    fullExtent(parent.getDimensions())
  );
  if (isEmptyExtent(polygonExtent)) return { segmentId, maskId: undefined };

  // A refusal names the segment it was given and no mask: nothing was written.
  const target = resolveRasterizeTarget(imageId, segmentId);
  if (!target) return { segmentId, maskId: undefined };

  target.voxels.ensureContains(polygonExtent);

  // Copied out of the reactive tree: the claim below runs per filled pixel.
  const extent = [...target.voxels.binding()!.extent] as Extent3D;
  if (isEmptyExtent(extent))
    return { segmentId: target.segmentId, maskId: target.maskId };
  // Scan conversion stays in parent coordinates: `fillPoly` rounds its edge
  // intersections by magnitude, so translating first would tie the pixels a
  // polygon fills to where the mask happens to be allocated.
  const points2D = indexPoints.map((point) => {
    const inPlane = [...point];
    inPlane.splice(axisIndex, 1);
    return inPlane as Vector2;
  });

  // A polygon is aimed at a place, so filling it takes the voxel. Scoped to
  // the polygon rather than the whole mask: a neighbour the polygon does not
  // reach has nothing here to give up, and it would be walked per filled pixel.
  const claimVoxel = segmentationStore.voxelClaim(
    target.maskId,
    'aimed',
    polygonExtent
  );
  const mask = target.voxels.image();
  const grid = createGridAccessor(
    parent,
    { image: mask, pixelData: target.voxels.scalars(), extent },
    { slice, axisIdx: axisIndex },
    (ijk) => claimVoxel?.claim(ijk[0], ijk[1], ijk[2])
  );

  try {
    fillPoly(grid, points2D, target.labelValue);
  } finally {
    claimVoxel?.finish();
    mask.modified();
  }
  return { segmentId: target.segmentId, maskId: target.maskId };
}
