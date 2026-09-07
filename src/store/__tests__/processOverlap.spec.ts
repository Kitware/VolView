import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { createApp } from 'vue';
import type { TypedArray } from '@kitware/vtk.js/types';

import { CorePiniaProviderPlugin } from '@/src/core/provider';
import { fillHoles } from '@/src/core/tools/paint/fillHoles';
import { gaussianSmoothLabelMapWorker } from '@/src/core/tools/paint/gaussianSmooth.worker';
import {
  usePaintProcessStore,
  type ProcessTarget,
} from '@/src/store/tools/paintProcess';
import { useViewStore } from '@/src/store/views';
import {
  addMask,
  flatIndex,
  labelValueOf,
  markedVoxels,
  maskValueAt,
  seatImage,
  seedVoxel,
  store,
  type Index3,
  selectSegment,
  lockSegment,
} from '@/src/store/__tests__/segmentMaskFixtures';

// ---------------------------------------------------------------------------
// A process writes into empty space only. A brush stroke is aimed at a place
// and claims the voxel from an unlocked neighbour; a process is a sweep the
// user did not aim, so it stops at every voxel another segment holds, locked or
// not, and takes nothing from anyone. Nothing outside the active segment
// changes, so the preview is what confirm leaves behind.
//
// The three processes are driven through their real algorithms where those are
// plain functions. Fill Between's interpolator is itk-wasm, which has no build
// that loads in this environment, so its result is produced here instead.
// ---------------------------------------------------------------------------

const DIMENSIONS: Index3 = [5, 5, 5];
const HOLE: Index3 = [2, 2, 2];
/** A voxel the cube holds throughout, on a slice no process here touches. */
const INSIDE: Index3 = [2, 2, 1];

const offsetOf = flatIndex(DIMENSIONS);

type SegmentAlgorithm = (target: ProcessTarget) => TypedArray | number[];

const runFillHoles: SegmentAlgorithm = (target) =>
  fillHoles({
    data: target.voxels.scalars(),
    dimensions: DIMENSIONS,
    axis: 2,
    sliceIndex: HOLE[2],
    label: target.labelValue,
  });

const runGaussianSmooth: SegmentAlgorithm = (target) =>
  gaussianSmoothLabelMapWorker({
    data: target.voxels.scalars(),
    dimensions: DIMENSIONS,
    spacing: [1, 1, 1],
    maskExtent: target.maskExtent,
    parentDimensions: target.parentDimensions,
    params: { sigma: 1, label: target.labelValue },
  });

/** What contour interpolation leaves: a gap closed by the slices around it. */
const runFillBetween: SegmentAlgorithm = (target) => {
  const data = target.voxels.scalars();
  const plane = DIMENSIONS[0] * DIMENSIONS[1];
  const filled = data.slice();
  for (let offset = plane; offset < data.length - plane; offset += 1) {
    const enclosed =
      data[offset - plane] === target.labelValue &&
      data[offset + plane] === target.labelValue;
    if (data[offset] === 0 && enclosed) filled[offset] = target.labelValue;
  }
  return filled;
};

/** The active segment as a solid cube with one background voxel at its centre. */
function cubeWithHole(imageId: string) {
  const maskId = addMask(imageId, 'Tumor');
  selectSegment(maskId);
  const voxels = store().maskVoxels(maskId);
  const { labelValue } = voxels.materialize();
  voxels.ensureContains([0, 4, 0, 4, 0, 4]);
  const scalars = voxels.scalars();
  scalars.fill(labelValue);
  scalars[offsetOf(...HOLE)] = 0;
  voxels.image().modified();
  return maskId;
}

/** A second segment owning the one voxel the process is about to turn on. */
function neighbourOwningTheHole(imageId: string, locked: boolean) {
  const maskId = addMask(imageId, locked ? 'Locked' : 'Unlocked');
  seedVoxel(maskId, HOLE);
  lockSegment(maskId, locked);
  return maskId;
}

describe.each([
  ['fill holes', runFillHoles],
  ['fill between', runFillBetween],
  ['gaussian smooth', runGaussianSmooth],
])('%s writing only into empty space', (_name, run) => {
  let tumor: string;

  beforeEach(async () => {
    const pinia = createPinia().use(CorePiniaProviderPlugin());
    createApp({}).use(pinia);
    setActivePinia(pinia);
    await seatImage('img-1', { dimensions: DIMENSIONS });
    useViewStore().setDataForAllViews('img-1');
    tumor = cubeWithHole('img-1');
  });

  const process = async () => {
    const processStore = usePaintProcessStore();
    await processStore.startProcess(async (target) => run(target));
    return processStore;
  };

  it.each([
    ['an unlocked', false],
    ['a locked', true],
  ])('leaves the voxel with %s neighbour', async (_lock, locked) => {
    const neighbour = neighbourOwningTheHole('img-1', locked);

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
      const filled = (target.voxels.scalars() as TypedArray).slice();
      filled.fill(target.labelValue);
      return filled;
    });
    processStore.confirmProcess();

    expect(maskValueAt(tumor, OWNED)).toBe(0);
    expect(maskValueAt(neighbour, OWNED)).toBe(labelValueOf(neighbour));
    expect(maskValueAt(tumor, [2, 3, 4])).toBe(labelValueOf(tumor));
    expect(maskValueAt(tumor, [1, 2, 2])).toBe(labelValueOf(tumor));
  });
});
