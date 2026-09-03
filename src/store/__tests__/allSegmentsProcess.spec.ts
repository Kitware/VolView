import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { createApp } from 'vue';

import { CorePiniaProviderPlugin } from '@/src/core/provider';
import { fillHoles } from '@/src/core/tools/paint/fillHoles';
import { useMessageStore } from '@/src/store/messages';
import {
  usePaintProcessStore,
  type ProcessAlgorithm,
  type ProcessTarget,
} from '@/src/store/tools/paintProcess';
import { useViewStore } from '@/src/store/views';
import {
  addSegment,
  labelValueOf,
  markedVoxels,
  maskValueAt,
  seatImage,
  store,
  type Index3,
} from '@/src/store/__tests__/segmentMaskFixtures';

// ---------------------------------------------------------------------------
// An all-segments process is one run per editable segment, each on that
// segment's own bounded mask. Storage is a mask per segment and a mask holds
// one label, so there is no composite to run the algorithm over once.
//
// ACCEPTED BEHAVIOUR CHANGE: a hole used to be filled with the majority label
// bordering it in the composite of every segment. Per segment, each segment
// fills only what it encloses by itself, so a cavity two segments close
// together is no longer filled at all.
//
// A fill writes into empty space only. Both segment scopes stop at a voxel
// another segment holds, locked or not, so no run of a process takes a voxel
// from a segment the user did not aim at.
// ---------------------------------------------------------------------------

const SIZE = 7;
const DIMENSIONS: Index3 = [SIZE, SIZE, 1];

/** A segment covering the whole slice, marked at the named cells. */
function segmentAt(name: string, cells: Array<[number, number]>) {
  const segmentId = addSegment('img-1', name);
  const voxels = store().segmentVoxels(segmentId);
  const { labelValue } = voxels.materialize();
  voxels.ensureContains([0, SIZE - 1, 0, SIZE - 1, 0, 0]);
  const scalars = voxels.scalars();
  cells.forEach(([i, j]) => {
    scalars[i + j * SIZE] = labelValue;
  });
  voxels.image().modified();
  return segmentId;
}

/** A ring of eight cells around its centre. */
const ringAround = (ci: number, cj: number): Array<[number, number]> =>
  [-1, 0, 1].flatMap((dj) =>
    [-1, 0, 1]
      .filter((di) => di !== 0 || dj !== 0)
      .map((di) => [ci + di, cj + dj] as [number, number])
  );

/** The four sides of a square box, from `from` to `to` inclusive. */
const boxOutline = (from: number, to: number): Array<[number, number]> =>
  Array.from({ length: to - from + 1 }, (_, n) => from + n).flatMap((n) => [
    [n, from] as [number, number],
    [n, to] as [number, number],
    [from, n] as [number, number],
    [to, n] as [number, number],
  ]);

/** Every cell of a solid square, from `from` to `to` inclusive. */
const block = (from: number, to: number): Array<[number, number]> =>
  Array.from({ length: to - from + 1 }, (_, n) => from + n).flatMap((j) =>
    Array.from(
      { length: to - from + 1 },
      (_, n) => [from + n, j] as [number, number]
    )
  );

const fillHolesOn = async (target: ProcessTarget) =>
  fillHoles({
    data: target.voxels.scalars(),
    dimensions: target.voxels.image().getDimensions() as Index3,
    axis: 2,
    sliceIndex: 0,
    label: target.labelValue,
  });

const runOverEverySegment = (algorithm: ProcessAlgorithm = fillHolesOn) =>
  usePaintProcessStore().startProcess(algorithm, {
    requiresActiveSegment: false,
  });

describe('a process running over every segment', () => {
  beforeEach(async () => {
    const pinia = createPinia().use(CorePiniaProviderPlugin());
    createApp({}).use(pinia);
    setActivePinia(pinia);
    await seatImage('img-1', { dimensions: DIMENSIONS });
    useViewStore().setDataForAllViews('img-1');
  });

  it('fills the holes of every segment in one pass', async () => {
    const left = segmentAt('Left', ringAround(1, 1));
    const right = segmentAt('Right', ringAround(5, 5));

    await runOverEverySegment();
    usePaintProcessStore().confirmProcess();

    expect(maskValueAt(left, [1, 1, 0])).toBe(labelValueOf(left));
    expect(maskValueAt(right, [5, 5, 0])).toBe(labelValueOf(right));
  });

  it('stops filling a cavity two segments only close together', async () => {
    // The composite enclosed this cavity and filled it with the majority
    // bordering label. Neither segment encloses it alone, so it stays
    // background: the accepted cost of running per segment.
    const left = segmentAt('Left', [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
    const right = segmentAt('Right', [
      [3, 0],
      [4, 0],
      [5, 0],
      [5, 1],
      [3, 2],
      [4, 2],
      [5, 2],
    ]);

    await runOverEverySegment();
    usePaintProcessStore().confirmProcess();

    expect(maskValueAt(left, [2, 1, 0])).toBe(0);
    expect(maskValueAt(right, [3, 1, 0])).toBe(0);
  });

  it('leaves a segment nested inside another holding every voxel', async () => {
    const outer = segmentAt('Outer', boxOutline(1, 5));
    const inner = segmentAt('Inner', block(2, 4));
    const held = markedVoxels(inner);

    await runOverEverySegment();
    usePaintProcessStore().confirmProcess();

    expect(markedVoxels(inner)).toEqual(held);
    expect(maskValueAt(outer, [3, 3, 0])).toBe(0);
  });

  it.each([
    ['an unlocked', false],
    ['a locked', true],
  ])(
    'leaves %s enclosed neighbour holding the voxel',
    async (_name, locked) => {
      const ring = segmentAt('Ring', ringAround(1, 1));
      const inside = segmentAt('Inside', [[1, 1]]);
      store().updateSegment(inside, { locked });

      await runOverEverySegment();
      usePaintProcessStore().confirmProcess();

      expect(maskValueAt(inside, [1, 1, 0])).toBe(labelValueOf(inside));
      expect(maskValueAt(ring, [1, 1, 0])).toBe(0);
    }
  );

  it('gives a voxel nobody held to the first segment that fills it', async () => {
    // Both enclose (3, 3) by themselves. The earlier run writes it, and the
    // later one finds it held and leaves it, so it is not taken back.
    const inner = segmentAt('Inner', ringAround(3, 3));
    const outer = segmentAt('Outer', boxOutline(1, 5));

    await runOverEverySegment();
    usePaintProcessStore().confirmProcess();

    expect(maskValueAt(inner, [3, 3, 0])).toBe(labelValueOf(inner));
    expect(maskValueAt(outer, [3, 3, 0])).toBe(0);
    expect(maskValueAt(inner, [2, 2, 0])).toBe(labelValueOf(inner));
    expect(maskValueAt(outer, [2, 2, 0])).toBe(0);
  });

  it('skips a locked segment, which is not editable', async () => {
    const locked = segmentAt('Locked', ringAround(1, 1));
    const open = segmentAt('Open', ringAround(5, 5));
    store().updateSegment(locked, { locked: true });

    await runOverEverySegment();
    usePaintProcessStore().confirmProcess();

    expect(maskValueAt(locked, [1, 1, 0])).toBe(0);
    expect(maskValueAt(open, [5, 5, 0])).toBe(labelValueOf(open));
  });

  it('restores every segment when the preview is cancelled', async () => {
    const left = segmentAt('Left', ringAround(1, 1));
    const right = segmentAt('Right', ringAround(5, 5));

    await runOverEverySegment();
    expect(maskValueAt(left, [1, 1, 0])).toBe(labelValueOf(left));
    expect(maskValueAt(right, [5, 5, 0])).toBe(labelValueOf(right));

    usePaintProcessStore().cancelProcess();

    expect(maskValueAt(left, [1, 1, 0])).toBe(0);
    expect(maskValueAt(right, [5, 5, 0])).toBe(0);
  });

  it('shows the original in every segment while the preview is toggled', async () => {
    const left = segmentAt('Left', ringAround(1, 1));
    const right = segmentAt('Right', ringAround(5, 5));
    const processStore = usePaintProcessStore();

    await runOverEverySegment();
    processStore.togglePreview();

    expect(maskValueAt(left, [1, 1, 0])).toBe(0);
    expect(maskValueAt(right, [5, 5, 0])).toBe(0);

    processStore.togglePreview();

    expect(maskValueAt(left, [1, 1, 0])).toBe(labelValueOf(left));
    expect(maskValueAt(right, [5, 5, 0])).toBe(labelValueOf(right));
  });

  it('drops the run of a segment its algorithm had nothing to do to', async () => {
    // Defaults are current slice plus every segment, so a segment the slice
    // misses is the common case. Nothing is copied out for it, nothing is
    // written back, and the renderer is not told its mask changed.
    const filled = segmentAt('Filled', ringAround(1, 1));
    const spared = segmentAt('Spared', ringAround(5, 5));
    const sparedMask = store().segmentVoxels(spared).image();
    const held = markedVoxels(spared);
    const sparedTime = sparedMask.getMTime();

    await runOverEverySegment(async (target) =>
      target.segmentId === spared ? undefined : fillHolesOn(target)
    );

    expect(maskValueAt(filled, [1, 1, 0])).toBe(labelValueOf(filled));
    expect(sparedMask.getMTime()).toBe(sparedTime);

    usePaintProcessStore().cancelProcess();

    expect(markedVoxels(spared)).toEqual(held);
    expect(sparedMask.getMTime()).toBe(sparedTime);
  });

  it('rolls back the segments it already wrote when a later one is refused', async () => {
    const left = segmentAt('Left', ringAround(1, 1));
    const right = segmentAt('Right', ringAround(5, 5));
    let calls = 0;

    // The first result commits, then the second is refused for its shape: a
    // run that wrote part of the image has to undo all of it.
    await runOverEverySegment(async (target) => {
      calls += 1;
      return calls === 1 ? fillHolesOn(target) : new Uint8Array(3);
    });

    expect(usePaintProcessStore().processState.step).toBe('start');
    expect(maskValueAt(left, [1, 1, 0])).toBe(0);
    expect(maskValueAt(right, [5, 5, 0])).toBe(0);
    expect(
      useMessageStore().messages.some((message) =>
        message.title.includes('Operation Failed')
      )
    ).toBe(true);
  });
});
