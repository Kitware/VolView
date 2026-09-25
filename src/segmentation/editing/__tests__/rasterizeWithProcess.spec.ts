import { beforeEach, describe, expect, it } from 'vitest';
import type { Vector3 } from '@kitware/vtk.js/types';

import { rasterizePolygon } from '@/src/segmentation/editing/rasterizePolygon';
import {
  addMask,
  extentOf,
  maskValueAt,
  activateAppPinia,
  viewImage,
  seedVoxel,
  store,
  type Index3,
  selectSegment,
  segmentOfMask,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { usePaintProcessStore } from '@/src/segmentation/editing/paintProcess';
import type { Extent3D } from '@/src/segmentation/geometry';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';

const DIMENSIONS: Index3 = [6, 6, 1];
const SQUARE: Vector3[] = [
  [1, 1, 0],
  [4, 1, 0],
  [4, 4, 0],
  [1, 4, 0],
];

function growMask(maskId: string, extent: Extent3D) {
  const voxels = store().maskVoxels(maskId);
  voxels.materialize();
  voxels.ensureContains(extent);
  selectSegment(maskId);
}

function rasterize(maskId: string) {
  return rasterizePolygon({
    imageId: 'img-1',
    segmentId: segmentOfMask(maskId),
    points: SQUARE,
    slice: 0,
    viewAxis: 'Axial',
  });
}

async function setUpRasterizeView() {
  activateAppPinia();
  await viewImage('img-1', { dimensions: DIMENSIONS });
}

function setUpOverlappingSegments(extent: Extent3D) {
  const target = addMask('img-1', 'Target');
  growMask(target, extent);
  const neighbor = addMask('img-1', 'Neighbor');
  seedVoxel(neighbor, [2, 3, 0]);
  // Outside the polygon, so the neighbor keeps a voxel and its mask.
  seedVoxel(neighbor, [5, 5, 0]);
  return { target, neighbor };
}

describe('polygon rasterize action', () => {
  beforeEach(setUpRasterizeView);

  it('restores the original before rasterization grows the mask', async () => {
    const { target, neighbor } = setUpOverlappingSegments([0, 1, 0, 1, 0, 0]);
    const processStore = usePaintProcessStore();

    await processStore.startProcess(async ({ scalars, maskExtent }) => ({
      scalars: new Uint8Array(scalars.length).fill(SEGMENT_VALUE),
      extent: maskExtent,
    }));
    expect(maskValueAt(target, [0, 0, 0])).toBe(SEGMENT_VALUE);

    rasterize(target);

    expect(processStore.processState.step).toBe('start');
    expect(extentOf(target)).toEqual([0, 4, 0, 4, 0, 0]);
    expect(maskValueAt(target, [0, 0, 0])).toBe(0);
    expect(maskValueAt(target, [2, 3, 0])).toBe(SEGMENT_VALUE);
    expect(maskValueAt(neighbor, [2, 3, 0])).toBe(0);
  });

  it('leaves same-sized rasterization intact after the preview is reset', async () => {
    const { target, neighbor } = setUpOverlappingSegments([0, 5, 0, 5, 0, 0]);
    seedVoxel(target, [0, 0, 0]);
    const processStore = usePaintProcessStore();

    await processStore.startProcess(async ({ scalars, maskExtent }) => ({
      scalars: new Uint8Array(scalars.length),
      extent: maskExtent,
    }));
    expect(maskValueAt(target, [0, 0, 0])).toBe(0);

    rasterize(target);
    processStore.cancelProcess();
    processStore.setShowingOriginal(true);

    expect(processStore.processState.step).toBe('start');
    expect(extentOf(target)).toEqual([0, 5, 0, 5, 0, 0]);
    expect(maskValueAt(target, [0, 0, 0])).toBe(SEGMENT_VALUE);
    expect(maskValueAt(target, [2, 3, 0])).toBe(SEGMENT_VALUE);
    expect(maskValueAt(neighbor, [2, 3, 0])).toBe(0);
  });
});
