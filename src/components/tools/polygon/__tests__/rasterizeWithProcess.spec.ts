import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createApp, nextTick } from 'vue';
import type { Vector3 } from '@kitware/vtk.js/types';

import { CorePiniaProviderPlugin } from '@/src/core/provider';
import { rasterizePolygon } from '@/src/components/tools/polygon/rasterizeTarget';
import {
  addMask,
  extentOf,
  labelValueOf,
  maskValueAt,
  seatImage,
  seedVoxel,
  store,
  type Index3,
  selectSegment,
  segmentOfMask,
} from '@/src/store/__tests__/segmentMaskFixtures';
import { usePaintProcessStore } from '@/src/store/tools/paintProcess';
import { useViewStore } from '@/src/store/views';
import type { Extent3D } from '@/src/types/segmentation';

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
  const pinia = createPinia().use(CorePiniaProviderPlugin());
  createApp({}).use(pinia);
  setActivePinia(pinia);
  await seatImage('img-1', { dimensions: DIMENSIONS });
  useViewStore().setDataForAllViews('img-1');
  await nextTick();
}

function setUpOverlappingSegments(extent: Extent3D) {
  const target = addMask('img-1', 'Target');
  growMask(target, extent);
  const neighbor = addMask('img-1', 'Neighbor');
  seedVoxel(neighbor, [2, 3, 0]);
  return { target, neighbor, labelValue: labelValueOf(target)! };
}

describe('polygon rasterize action', () => {
  beforeEach(setUpRasterizeView);

  it('restores the original before rasterization grows the mask', async () => {
    const { target, neighbor, labelValue } = setUpOverlappingSegments([
      0, 1, 0, 1, 0, 0,
    ]);
    const processStore = usePaintProcessStore();

    await processStore.startProcess(async ({ voxels }) =>
      new Uint8Array(voxels.scalars().length).fill(labelValue)
    );
    expect(maskValueAt(target, [0, 0, 0])).toBe(labelValue);

    rasterize(target);

    expect(processStore.processState.step).toBe('start');
    expect(extentOf(target)).toEqual([0, 4, 0, 4, 0, 0]);
    expect(maskValueAt(target, [0, 0, 0])).toBe(0);
    expect(maskValueAt(target, [2, 3, 0])).toBe(labelValue);
    expect(maskValueAt(neighbor, [2, 3, 0])).toBe(0);
  });

  it('leaves same-sized rasterization intact after the preview is reset', async () => {
    const { target, neighbor, labelValue } = setUpOverlappingSegments([
      0, 5, 0, 5, 0, 0,
    ]);
    seedVoxel(target, [0, 0, 0]);
    const processStore = usePaintProcessStore();

    await processStore.startProcess(
      async ({ voxels }) => new Uint8Array(voxels.scalars().length)
    );
    expect(maskValueAt(target, [0, 0, 0])).toBe(0);

    rasterize(target);
    processStore.cancelProcess();
    processStore.togglePreview();

    expect(processStore.processState.step).toBe('start');
    expect(extentOf(target)).toEqual([0, 5, 0, 5, 0, 0]);
    expect(maskValueAt(target, [0, 0, 0])).toBe(labelValue);
    expect(maskValueAt(target, [2, 3, 0])).toBe(labelValue);
    expect(maskValueAt(neighbor, [2, 3, 0])).toBe(0);
  });
});
