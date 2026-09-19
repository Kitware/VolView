import { fillPoly } from '@thi.ng/rasterize';
import type { IGrid2D } from '@thi.ng/api';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { TypedArray, Vector2, Vector3 } from '@kitware/vtk.js/types';

import { useImageCacheStore } from '@/src/store/image-cache';
import { useMessageStore } from '@/src/store/messages';
import { useSegmentationStore } from '@/src/segmentation/store';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import type { Maybe } from '@/src/types';
import type { LPSAxis } from '@/src/types/lps';
import {
  clipExtent,
  emptyExtent,
  extentContainsIndex,
  extentSize,
  fullExtent,
  inPlaneAxes,
  isEmptyExtent,
  maskOffset,
  sliceExtent,
  type Extent3D,
} from '@/src/segmentation/geometry';
import { getLPSDirections } from '@/src/utils/lps';

export const rasterizeTargetDisabledReason = (segmentId: Maybe<string>) =>
  useSegmentationStore().editTargetLocked(segmentId)
    ? 'Unlock this segment to rasterize into it'
    : '';

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
  // neither behind. A locked neighbor is a different rule: the fill goes
  // around it, which an aimed `voxelClaim` already honors.
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
    voxels,
    maskId: resolved,
    segmentId: segmentationStore.getMask(resolved).segmentId,
  };
}

/**
 * A grid over the parent's index space, writing into the mask's own buffer
 * wherever `mayFill` agrees. Asked before the write, since a claim clears the
 * voxel from the neighbors it takes it from.
 */
function createGridAccessor(
  parent: vtkImageData,
  mask: { pixelData: TypedArray; extent: Extent3D },
  plane: { slice: number; axisIdx: 0 | 1 | 2 }, // i/j/k
  mayFill: (i: number, j: number, k: number) => boolean
): IGrid2D {
  const { slice, axisIdx } = plane;
  const { extent, pixelData } = mask;
  const axisDims = parent.getDimensions();
  axisDims.splice(axisIdx, 1);
  const [mi, mj] = extentSize(extent);
  const bounds = { extent, mi, mj };
  // One scratch voxel with the slice already in place: the setter runs per
  // filled pixel, so it allocates nothing.
  const [axisU, axisV] = inPlaneAxes(axisIdx);
  const ijk = [0, 0, 0];
  ijk[axisIdx] = slice;

  return {
    size: axisDims,
    setAtUnsafe(d0: number, d1: number, value: number): boolean {
      ijk[axisU] = d0;
      ijk[axisV] = d1;
      const i = ijk[0];
      const j = ijk[1];
      const k = ijk[2];
      if (!extentContainsIndex(extent, i, j, k) || !mayFill(i, j, k))
        return false;
      // XXX assumes single-component image
      pixelData[maskOffset(bounds, i, j, k)] = value;
      return true;
    },
  } as unknown as IGrid2D;
}

/** The box the polygon spans on its slice, in parent index space. */
function polygonBounds(
  indexPoints: number[][],
  axisIndex: 0 | 1 | 2,
  slice: number
) {
  if (indexPoints.length === 0) return emptyExtent();
  return sliceExtent(axisIndex, slice, (axis) => {
    const values = indexPoints.map((point) => point[axis]);
    return [Math.floor(Math.min(...values)), Math.ceil(Math.max(...values))];
  });
}

/**
 * Fills a polygon into its segment's mask. The write lives here rather than in
 * the tool component because it is a voxel operation: the mask has to grow to
 * hold the polygon before `fillPoly` runs, since a mask that does not reach a
 * pixel swallows it silently, and each filled voxel is claimed from the other
 * segments under the aimed rule of `voxelClaim`. World points, parent slice
 * index. Resolving the edit target cancels any competing preview before
 * storage changes.
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
  // hold, and the only place this fill can take a voxel from a neighbor.
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
  // Scan conversion stays in parent coordinates: `fillPoly` rounds its edge
  // intersections by magnitude, so translating first would tie the pixels a
  // polygon fills to where the mask happens to be allocated.
  const points2D = indexPoints.map((point) => {
    const inPlane = [...point];
    inPlane.splice(axisIndex, 1);
    return inPlane as Vector2;
  });

  // A polygon is aimed at a place, so filling it takes the voxel. Scoped to
  // the polygon rather than the whole mask: a neighbor the polygon does not
  // reach has nothing here to give up, and it would be walked per filled pixel.
  const claimVoxel = segmentationStore.voxelClaim(
    target.maskId,
    'aimed',
    polygonExtent
  );
  const mask = target.voxels.image();
  const grid = createGridAccessor(
    parent,
    { pixelData: target.voxels.scalars(), extent },
    { slice, axisIdx: axisIndex },
    (i, j, k) => claimVoxel?.claim(i, j, k) ?? true
  );

  try {
    fillPoly(grid, points2D, SEGMENT_VALUE);
  } finally {
    claimVoxel?.finish();
    mask.modified();
  }
  return { segmentId: target.segmentId, maskId: target.maskId };
}
