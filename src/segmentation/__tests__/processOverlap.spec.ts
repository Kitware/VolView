import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { createApp } from 'vue';
import type { TypedArray } from '@kitware/vtk.js/types';

import { morphologicalContourInterpolationNode } from '@itk-wasm/morphological-contour-interpolation';
import { CorePiniaProviderPlugin } from '@/src/core/provider';
import { fillHoles } from '@/src/segmentation/editing/algorithms/fillHoles';
import { gaussianSmoothLabelMapWorker } from '@/src/segmentation/editing/algorithms/gaussianSmooth.worker';
import { useFillBetweenStore } from '@/src/segmentation/editing/fillBetween';
import {
  usePaintProcessStore,
  type ProcessTarget,
  type ProcessResult,
} from '@/src/segmentation/editing/paintProcess';
import { useViewStore } from '@/src/store/views';
import {
  addMask,
  labelValueOf,
  markedVoxels,
  maskValueAt,
  seatImage,
  seedVoxel,
  store,
  type Index3,
  selectSegment,
  lockSegment,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';

// ---------------------------------------------------------------------------
// A process writes into empty space only. A brush stroke is aimed at a place
// and claims the voxel from an unlocked neighbour; a process is a sweep the
// user did not aim, so it stops at every voxel another segment holds, locked or
// not, and takes nothing from anyone. Nothing outside the active segment
// changes, so the preview is what confirm leaves behind.
//
// The three processes run their real algorithms, Fill Between through the Node
// build of its interpolator.
// ---------------------------------------------------------------------------

const DIMENSIONS: Index3 = [5, 5, 5];
const HOLE: Index3 = [2, 2, 2];
/** A voxel the cube holds throughout, on a slice no process here touches. */
const INSIDE: Index3 = [2, 2, 1];

/** The parent index of an offset into a mask covering the whole image. */
const indexAt = (offset: number): Index3 => [
  offset % DIMENSIONS[0],
  Math.floor(offset / DIMENSIONS[0]) % DIMENSIONS[1],
  Math.floor(offset / (DIMENSIONS[0] * DIMENSIONS[1])),
];

type SegmentAlgorithm = (
  target: ProcessTarget
) => ProcessResult | Promise<ProcessResult>;

const runFillHoles: SegmentAlgorithm = (target) => ({
  scalars: fillHoles({
    data: target.scalars,
    dimensions: DIMENSIONS,
    axis: 2,
    sliceIndex: HOLE[2],
  }).out,
  extent: target.maskExtent,
});

const runGaussianSmooth: SegmentAlgorithm = (target) =>
  gaussianSmoothLabelMapWorker({
    data: target.scalars,
    dimensions: DIMENSIONS,
    spacing: [1, 1, 1],
    maskExtent: target.maskExtent,
    parentDimensions: target.parentDimensions,
    params: { sigma: 1 },
  })!;

const runFillBetween: SegmentAlgorithm = (target) =>
  useFillBetweenStore().computeAlgorithm(
    target,
    morphologicalContourInterpolationNode
  );

/** Every voxel but HOLE, which fill holes and smoothing close. */
const cubeWithHole = (index: Index3) =>
  index.some((n, axis) => n !== HOLE[axis]);

// Interpolation only closes a slice with no contour, so HOLE's is left empty.
const squaresAroundHole = ([i, j, k]: Index3) =>
  Math.abs(k - HOLE[2]) === 1 &&
  Math.abs(i - HOLE[0]) <= 1 &&
  Math.abs(j - HOLE[1]) <= 1;

function tumorHolding(imageId: string, holds: (index: Index3) => boolean) {
  const maskId = addMask(imageId, 'Tumor');
  selectSegment(maskId);
  const voxels = store().maskVoxels(maskId);
  voxels.materialize();
  voxels.ensureContains([0, 4, 0, 4, 0, 4]);
  const scalars = voxels.scalars();
  scalars.forEach((_, offset) => {
    if (holds(indexAt(offset))) scalars[offset] = SEGMENT_VALUE;
  });
  voxels.image().modified();
  return maskId;
}

function neighbourOwningTheHole(imageId: string, locked: boolean) {
  const maskId = addMask(imageId, locked ? 'Locked' : 'Unlocked');
  seedVoxel(maskId, HOLE);
  lockSegment(maskId, locked);
  return maskId;
}

describe.each([
  ['fill holes', runFillHoles, cubeWithHole],
  ['fill between', runFillBetween, squaresAroundHole],
  ['gaussian smooth', runGaussianSmooth, cubeWithHole],
])('%s writing only into empty space', (_name, run, holds) => {
  let tumor: string;

  beforeEach(async () => {
    const pinia = createPinia().use(CorePiniaProviderPlugin());
    createApp({}).use(pinia);
    setActivePinia(pinia);
    await seatImage('img-1', { dimensions: DIMENSIONS });
    useViewStore().setDataForAllViews('img-1');
    tumor = tumorHolding('img-1', holds);
  });

  const process = async () => {
    const processStore = usePaintProcessStore();
    await processStore.startProcess(async (target) => run(target));
    return processStore;
  };

  it.each([
    ['an unlocked neighbour', false, false],
    ['a locked neighbour', true, false],
    ['a neighbour while overlap is allowed', false, true],
  ])('leaves the voxel with %s', async (_case, locked, overlap) => {
    const neighbour = neighbourOwningTheHole('img-1', locked);
    store().allowOverlap = overlap;

    (await process()).confirmProcess();

    expect(maskValueAt(neighbour, HOLE)).toBe(labelValueOf(neighbour));
    expect(maskValueAt(tumor, HOLE)).toBe(0);
  });

  it('confirms exactly what the preview showed', async () => {
    const neighbour = neighbourOwningTheHole('img-1', false);
    const processStore = await process();
    const previewed = [markedVoxels(tumor), markedVoxels(neighbour)];

    processStore.confirmProcess();

    expect([markedVoxels(tumor), markedVoxels(neighbour)]).toEqual(previewed);
  });

  it('takes nothing from a neighbour when the preview is cancelled', async () => {
    const neighbour = neighbourOwningTheHole('img-1', false);

    (await process()).cancelProcess();

    expect(maskValueAt(tumor, HOLE)).toBe(0);
    expect(maskValueAt(neighbour, HOLE)).toBe(labelValueOf(neighbour));
  });

  it('leaves the voxels it did not turn on with their owners', async () => {
    // An overlap the user already has, inside the cube so no algorithm here
    // rounds it away: a process that turned it on for neither keeps both.
    const neighbour = addMask('img-1', 'Elsewhere');
    seedVoxel(neighbour, INSIDE);
    seedVoxel(neighbour, [0, 0, 0]);

    (await process()).confirmProcess();

    expect(maskValueAt(neighbour, [0, 0, 0])).toBe(labelValueOf(neighbour));
    expect(maskValueAt(tumor, INSIDE)).toBe(labelValueOf(tumor));
    expect(maskValueAt(neighbour, INSIDE)).toBe(labelValueOf(neighbour));
  });
});

// The result is swept a row at a time, so a mask whose i, j and k counts all
// differ is what pins the row start against the parent index the sweep asks
// the neighbouring masks about.
describe('a process over a mask with no two dimensions alike', () => {
  const SHAPE: Index3 = [3, 4, 5];
  const OWNED: Index3 = [1, 2, 3];

  beforeEach(async () => {
    const pinia = createPinia().use(CorePiniaProviderPlugin());
    createApp({}).use(pinia);
    setActivePinia(pinia);
    await seatImage('img-1', { dimensions: SHAPE });
    useViewStore().setDataForAllViews('img-1');
  });

  it('stops at the one voxel a neighbour holds', async () => {
    const tumor = addMask('img-1', 'Tumor');
    selectSegment(tumor);
    const voxels = store().maskVoxels(tumor);
    voxels.materialize();
    voxels.ensureContains([0, 2, 0, 3, 0, 4]);
    seedVoxel(tumor, [0, 0, 0]);

    const neighbour = addMask('img-1', 'Neighbour');
    seedVoxel(neighbour, OWNED);

    const processStore = usePaintProcessStore();
    await processStore.startProcess(async (target) => {
      const filled = (target.scalars as TypedArray).slice();
      filled.fill(SEGMENT_VALUE);
      return { scalars: filled, extent: target.maskExtent };
    });
    processStore.confirmProcess();

    expect(maskValueAt(tumor, OWNED)).toBe(0);
    expect(maskValueAt(neighbour, OWNED)).toBe(labelValueOf(neighbour));
    expect(maskValueAt(tumor, [2, 3, 4])).toBe(labelValueOf(tumor));
    expect(maskValueAt(tumor, [1, 2, 2])).toBe(labelValueOf(tumor));
  });
});
