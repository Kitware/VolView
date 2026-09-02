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
  addSegment,
  labelValueOf,
  maskValueAt,
  seatImage,
  seedVoxel,
  store,
  type Index3,
} from '@/src/store/__tests__/segmentMaskFixtures';

// ---------------------------------------------------------------------------
// A process turning a voxel ON claims it exactly as a brush stroke does: every
// unlocked segment of the image releases it, a locked one keeps it and the two
// overlap. The claim happens on confirm rather than on preview, so a cancelled
// preview leaves the neighbours holding everything they had.
//
// The three processes are driven through their real algorithms where those are
// plain functions. Fill Between's interpolator is itk-wasm, which has no build
// that loads in this environment, so its result is produced here instead.
// ---------------------------------------------------------------------------

const DIMENSIONS: Index3 = [5, 5, 5];
const HOLE: Index3 = [2, 2, 2];

const offsetOf = (i: number, j: number, k: number) =>
  i + j * DIMENSIONS[0] + k * DIMENSIONS[0] * DIMENSIONS[1];

/** The processes are all segment-scoped; the other arm never reaches them. */
function segmentTarget(target: ProcessTarget) {
  if (target.scope !== 'segment') throw new Error('Not a segment target');
  return target;
}

type SegmentAlgorithm = (
  target: ReturnType<typeof segmentTarget>
) => TypedArray | number[];

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
  const segmentId = addSegment(imageId, 'Tumor');
  store().setActiveSegment(segmentId);
  const voxels = store().segmentVoxels(segmentId);
  const { labelValue } = voxels.materialize();
  voxels.ensureContains([0, 4, 0, 4, 0, 4]);
  const scalars = voxels.scalars();
  scalars.fill(labelValue);
  scalars[offsetOf(...HOLE)] = 0;
  voxels.image().modified();
  return segmentId;
}

/** A second segment owning the one voxel the process is about to turn on. */
function neighbourOwningTheHole(imageId: string, locked: boolean) {
  const segmentId = addSegment(imageId, locked ? 'Locked' : 'Unlocked');
  seedVoxel(segmentId, HOLE);
  store().updateSegment(segmentId, { locked });
  return segmentId;
}

describe.each([
  ['fill holes', runFillHoles],
  ['fill between', runFillBetween],
  ['gaussian smooth', runGaussianSmooth],
])('%s claiming the voxels it turns on', (_name, run) => {
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
    await processStore.startProcess(async (target) =>
      run(segmentTarget(target))
    );
    return processStore;
  };

  it('takes the voxel from an unlocked neighbour', async () => {
    const neighbour = neighbourOwningTheHole('img-1', false);

    (await process()).confirmProcess();

    expect(maskValueAt(tumor, HOLE)).toBe(labelValueOf(tumor));
    expect(maskValueAt(neighbour, HOLE)).toBe(0);
  });

  it('shares the voxel with a locked neighbour', async () => {
    const neighbour = neighbourOwningTheHole('img-1', true);

    (await process()).confirmProcess();

    expect(maskValueAt(tumor, HOLE)).toBe(labelValueOf(tumor));
    expect(maskValueAt(neighbour, HOLE)).toBe(labelValueOf(neighbour));
  });

  it('takes nothing from a neighbour when the preview is cancelled', async () => {
    const neighbour = neighbourOwningTheHole('img-1', false);

    (await process()).cancelProcess();

    expect(maskValueAt(tumor, HOLE)).toBe(0);
    expect(maskValueAt(neighbour, HOLE)).toBe(labelValueOf(neighbour));
  });

  it('leaves the voxels it did not turn on with their owners', async () => {
    const neighbour = addSegment('img-1', 'Elsewhere');
    seedVoxel(neighbour, [0, 0, 0]);

    (await process()).confirmProcess();

    expect(maskValueAt(neighbour, [0, 0, 0])).toBe(labelValueOf(neighbour));
  });
});
