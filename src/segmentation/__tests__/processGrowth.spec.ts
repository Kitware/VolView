import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createApp, nextTick } from 'vue';
import { CorePiniaProviderPlugin } from '@/src/core/provider';
import { gaussianSmoothLabelMapWorker } from '@/src/segmentation/editing/algorithms/gaussianSmooth.worker';
import { morphologicalContourInterpolationNode } from '@itk-wasm/morphological-contour-interpolation';
import { useFillBetweenStore } from '@/src/segmentation/editing/fillBetween';
import {
  usePaintProcessStore,
  type ProcessResult,
  type ProcessTarget,
} from '@/src/segmentation/editing/paintProcess';
import { useViewStore } from '@/src/store/views';
import { useMessageStore } from '@/src/store/messages';
import { fullExtent, type Extent3D } from '@/src/segmentation/geometry';
import {
  addMask,
  markedVoxels,
  maskValueAt,
  seatImage,
  seedVoxel,
  selectSegment,
  lockSegment,
  store,
  type Index3,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

/** The real smoothing filter, as a process algorithm. */
const smoothAlgorithm = () => async (target: ProcessTarget) =>
  gaussianSmoothLabelMapWorker({
    data: target.scalars,
    dimensions: target.dimensions,
    spacing: [1, 1, 1],
    maskExtent: target.maskExtent,
    parentDimensions: target.parentDimensions,
    params: { sigma: 1, label: target.labelValue },
  });

// Both real algorithms run in process previews. Interpolation uses the
// installed Node WASM entry point in place of its browser worker transport.
const cases = [
  {
    name: 'Gaussian smoothing',
    dimensions: [9, 9, 9] as Index3,
    extent: [1, 4, 1, 4, 1, 4] as Extent3D,
    count: 62,
    growth: [0, 2, 2] as Index3,
    mark: (i: number, j: number, k: number) =>
      i >= 1 && i <= 4 && j >= 1 && j <= 4 && k >= 1 && k <= 4,
    algorithm: smoothAlgorithm,
  },
  {
    name: 'Fill Between',
    dimensions: [12, 12, 12] as Index3,
    extent: [3, 7, 3, 7, 3, 8] as Extent3D,
    count: 81,
    growth: [2, 4, 5] as Index3,
    mark: (i: number, j: number, k: number) => {
      const rows =
        k === 3
          ? ['11000', '11111', '11000', '11000', '00000']
          : k === 8
            ? ['00000', '11000', '11111', '01111', '01111']
            : [];
      return rows[j - 3]?.[i - 3] === '1';
    },
    algorithm: () => (target: ProcessTarget) =>
      useFillBetweenStore().computeAlgorithm(
        target,
        morphologicalContourInterpolationNode
      ),
  },
];

beforeEach(async () => {
  const pinia = createPinia().use(CorePiniaProviderPlugin());
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

describe.each(cases)('$name with bounded storage', (fixture) => {
  async function mask(padded = false) {
    await seatImage('img', {
      dimensions: fixture.dimensions,
      origin: [8, -3, 11],
      spacing: [1, 1, 1],
    });
    useViewStore().setDataForAllViews('img');
    const id = addMask('img', 'Target');
    selectSegment(id);
    const voxels = store().maskVoxels(id);
    voxels.materialize();
    voxels.ensureContains(
      padded ? fullExtent(fixture.dimensions) : fixture.extent
    );
    for (let k = 0; k < fixture.dimensions[2]; k += 1) {
      for (let j = 0; j < fixture.dimensions[1]; j += 1) {
        for (let i = 0; i < fixture.dimensions[0]; i += 1) {
          if (fixture.mark(i, j, k)) seedVoxel(id, [i, j, k]);
        }
      }
    }
    await nextTick();
    return id;
  }

  it('preserves whole-parent geometry through preview, cancel and confirm', async () => {
    const id = await mask();
    const before = markedVoxels(id);
    const process = usePaintProcessStore();
    await process.startProcess(fixture.algorithm());
    expect(process.processStep).toBe('previewing');
    expect(markedVoxels(id)).toHaveLength(fixture.count);
    expect(maskValueAt(id, fixture.growth)).toBe(1);
    const preview = markedVoxels(id);
    expect(store().maskVoxels(id).scalars().length).toBeLessThan(
      fixture.dimensions.reduce((a, b) => a * b, 1)
    );
    process.togglePreview();
    expect(markedVoxels(id)).toEqual(before);
    process.togglePreview();
    expect(markedVoxels(id)).toEqual(preview);
    process.cancelProcess();
    expect(markedVoxels(id)).toEqual(before);
    await process.startProcess(fixture.algorithm());
    process.togglePreview();
    process.confirmProcess();
    expect(markedVoxels(id)).toEqual(preview);

    store().deleteMask(id);
    const padded = await mask(true);
    await process.startProcess(fixture.algorithm());
    expect(markedVoxels(padded)).toEqual(preview);
  });

  it.each([false, true])(
    'does not claim newly reached voxels from a neighbour (locked: %s)',
    async (locked) => {
      const id = await mask();
      const neighbour = addMask('img', 'Neighbour');
      seedVoxel(neighbour, fixture.growth);
      lockSegment(neighbour, locked);
      await usePaintProcessStore().startProcess(fixture.algorithm());
      expect(markedVoxels(id)).toHaveLength(fixture.count - 1);
      expect(maskValueAt(neighbour, fixture.growth)).toBe(1);
      expect(maskValueAt(id, fixture.growth)).toBe(0);
    }
  );
});

async function oneVoxel() {
  await seatImage('img', { dimensions: [5, 1, 1] });
  useViewStore().setDataForAllViews('img');
  const id = addMask('img', 'Target');
  selectSegment(id);
  seedVoxel(id, [2, 0, 0]);
  await nextTick();
  return id;
}

const grownResult = (): ProcessResult => ({
  scalars: new Uint8Array([1, 1, 1]),
  extent: [1, 3, 0, 0, 0, 0],
});

describe('process result placement', () => {
  it.each([
    { scalars: new Uint8Array(3), extent: [-1, 1, 0, 0, 0, 0] },
    { scalars: new Uint8Array(3), extent: [3, 5, 0, 0, 0, 0] },
    { scalars: new Uint8Array(3), extent: [1.5, 3.5, 0, 0, 0, 0] },
    { scalars: new Uint8Array(2), extent: [1, 3, 0, 0, 0, 0] },
    { scalars: new Uint8Array(0), extent: [0, -1, 0, 0, 0, 0] },
  ] as ProcessResult[])(
    'rejects invalid extent/size before growing storage: $extent',
    async (result) => {
      const id = await oneVoxel();
      const voxels = store().maskVoxels(id);
      const buffer = voxels.scalars();
      await usePaintProcessStore().startProcess(async () => result);
      expect(usePaintProcessStore().processStep).toBe('start');
      expect(voxels.scalars()).toBe(buffer);
      expect(markedVoxels(id)).toEqual([[2, 0, 0, 1]]);
      expect(
        useMessageStore().messages.some(({ title }) =>
          title.includes('Operation Failed')
        )
      ).toBe(true);
    }
  );

  it('does not grow or write a result after cancellation during computation', async () => {
    const id = await oneVoxel();
    const voxels = store().maskVoxels(id);
    const buffer = voxels.scalars();
    let resolve!: (value: ProcessResult) => void;
    const promise = new Promise<ProcessResult>((done) => {
      resolve = done;
    });
    const process = usePaintProcessStore();
    const run = process.startProcess(async () => promise);
    process.cancelProcess();
    resolve(grownResult());
    await run;
    expect(voxels.scalars()).toBe(buffer);
    expect(markedVoxels(id)).toEqual([[2, 0, 0, 1]]);
  });

  it('rolls back a grown earlier mask if applying a later result fails', async () => {
    const id = await oneVoxel();
    const other = addMask('img', 'Other');
    seedVoxel(other, [4, 0, 0]);
    const access = store().maskVoxels;
    vi.spyOn(store(), 'maskVoxels').mockImplementation((maskId) => {
      const voxels = access(maskId);
      if (maskId === other)
        vi.spyOn(voxels, 'apply').mockImplementationOnce(() => {
          throw new Error('Failed write');
        });
      return voxels;
    });
    await usePaintProcessStore().startProcess(
      async (target) => {
        if (target.maskId === id) return grownResult();
        return { scalars: new Uint8Array([1]), extent: target.maskExtent };
      },
      { requiresActiveSegment: false }
    );
    expect(usePaintProcessStore().processStep).toBe('start');
    expect(markedVoxels(id)).toEqual([[2, 0, 0, 1]]);
    expect(markedVoxels(other)).toEqual([[4, 0, 0, 1]]);
    vi.restoreAllMocks();
  });

  it('leaves every allocation alone when another algorithm rejects', async () => {
    const id = await oneVoxel();
    const other = addMask('img', 'Other');
    seedVoxel(other, [4, 0, 0]);
    const original = store().maskVoxels(id).scalars();
    await usePaintProcessStore().startProcess(
      async (target) => {
        if (target.maskId === id) return grownResult();
        throw new Error('Interpolation failed');
      },
      { requiresActiveSegment: false }
    );
    expect(usePaintProcessStore().processStep).toBe('start');
    expect(store().maskVoxels(id).scalars()).toBe(original);
    expect(markedVoxels(id)).toEqual([[2, 0, 0, 1]]);
    expect(markedVoxels(other)).toEqual([[4, 0, 0, 1]]);
  });

  it('says an emptied mask has nothing to smooth rather than previewing it', async () => {
    const id = await oneVoxel();
    // Erasing the last voxel keeps the allocation, so the run has a target
    // whose buffer holds none of the label.
    store().maskVoxels(id).scalars().fill(0);
    const process = usePaintProcessStore();

    await process.startProcess(smoothAlgorithm());

    expect(process.processStep).toBe('start');
    expect(
      useMessageStore().messages.some(({ title }) =>
        title.includes('had nothing to do')
      )
    ).toBe(true);
  });

  it('leaves a mask the failed run never wrote untouched', async () => {
    const id = await oneVoxel();
    const other = addMask('img', 'Other');
    seedVoxel(other, [4, 0, 0]);
    const untouched = store().maskVoxels(other);
    const buffer = untouched.scalars();
    const revision = untouched.image().getMTime();
    await usePaintProcessStore().startProcess(
      async () => {
        throw new Error('Interpolation failed');
      },
      { requiresActiveSegment: false }
    );
    expect(usePaintProcessStore().processStep).toBe('start');
    expect(store().maskVoxels(other).scalars()).toBe(buffer);
    expect(store().maskVoxels(other).image().getMTime()).toBe(revision);
    expect(markedVoxels(other)).toEqual([[4, 0, 0, 1]]);
    expect(markedVoxels(id)).toEqual([[2, 0, 0, 1]]);
  });

  it('restores the original when a smaller output erases old edge voxels', async () => {
    const id = await oneVoxel();
    seedVoxel(id, [1, 0, 0]);
    seedVoxel(id, [3, 0, 0]);
    const process = usePaintProcessStore();
    await process.startProcess(async () => ({
      scalars: new Uint8Array([1]),
      extent: [2, 2, 0, 0, 0, 0],
    }));
    expect(markedVoxels(id)).toEqual([[2, 0, 0, 1]]);
    process.cancelProcess();
    expect(markedVoxels(id)).toEqual([
      [1, 0, 0, 1],
      [2, 0, 0, 1],
      [3, 0, 0, 1],
    ]);
  });
});
