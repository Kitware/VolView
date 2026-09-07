import { fillPoly } from '@thi.ng/rasterize';
import type { IGrid2D } from '@thi.ng/api';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { TypedArray, Vector2, Vector3 } from '@kitware/vtk.js/types';
import { containsPoint } from '@kitware/vtk.js/Common/DataModel/BoundingBox';

import { useImageCacheStore } from '@/src/store/image-cache';
import { useMessageStore } from '@/src/store/messages';
import { useSegmentationStore } from '@/src/store/segmentations';
import type { Maybe } from '@/src/types';
import type { LPSAxis } from '@/src/types/lps';
import {
  clipExtent,
  emptyExtent,
  fullExtent,
  isEmptyExtent,
  type Extent3D,
} from '@/src/types/segmentation';
import { getLPSDirections } from '@/src/utils/lps';

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

  const resolved = segmentationStore.resolveEditTarget(imageId, segmentId);
  // A locked segment is not editable, the same refusal paint and the processes
  // make. Checked before storage is allocated, so a refused polygon leaves no
  // empty mask behind. A locked neighbour is a different rule and keeps the
  // voxels a fill claims, which an aimed `voxelClaim` already honours.
  if (segmentationStore.isLocked(resolved)) {
    useMessageStore().addError('Cannot rasterize into a locked segment');
    return undefined;
  }

  const voxels = segmentationStore.maskVoxels(resolved);
  const binding = voxels.materialize();
  return {
    ...binding,
    voxels,
    maskId: resolved,
    segmentId: segmentationStore.getMask(resolved).segmentId,
  };
}

function createGridAccessor(
  image: vtkImageData,
  pixelData: TypedArray,
  slice: number,
  axisIdx: 0 | 1 | 2, // i/j/k
  onFilled: (ijk: Vector3) => void
): IGrid2D {
  const axisDims = image.getDimensions();
  axisDims.splice(axisIdx, 1);
  const extent = image.getExtent();
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
        const offset = image.computeOffsetIndex(ijk);
        // XXX assumes single-component image
        pixelData[offset] = value;
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
 * other segments of the image. World points, parent slice index.
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

  // A refusal names the segment it was given and no mask: nothing was written.
  const target = resolveRasterizeTarget(imageId, segmentId);
  if (!target) return { segmentId, maskId: undefined };

  const axisIndex = getLPSDirections(parent.getDirection())[viewAxis];
  const indexPoints = points.map((point) => [...parent.worldToIndex(point)]);

  target.voxels.ensureContains(
    clipExtent(
      polygonBounds(indexPoints, axisIndex, slice),
      fullExtent(parent.getDimensions())
    )
  );

  // Copied out of the reactive tree: `toParent` below runs per filled pixel.
  const extent = [...target.voxels.binding()!.extent] as Extent3D;
  if (isEmptyExtent(extent))
    return { segmentId: target.segmentId, maskId: target.maskId };

  const toParent = (ijk: Vector3): Vector3 => [
    ijk[0] + extent[0],
    ijk[1] + extent[2],
    ijk[2] + extent[4],
  ];
  const points2D = indexPoints.map((point) => {
    const local = [
      point[0] - extent[0],
      point[1] - extent[2],
      point[2] - extent[4],
    ];
    local.splice(axisIndex, 1);
    return local as Vector2;
  });

  // A polygon is aimed at a place, so filling it takes the voxel.
  const claimVoxel = segmentationStore.voxelClaim(
    target.maskId,
    'aimed',
    extent
  );
  const mask = target.voxels.image();
  const grid = createGridAccessor(
    mask,
    target.voxels.scalars(),
    slice - extent[axisIndex * 2],
    axisIndex,
    (ijk) => {
      const [i, j, k] = toParent(ijk);
      claimVoxel?.(i, j, k);
    }
  );

  fillPoly(grid, points2D, target.labelValue);
  mask.modified();
  return { segmentId: target.segmentId, maskId: target.maskId };
}
