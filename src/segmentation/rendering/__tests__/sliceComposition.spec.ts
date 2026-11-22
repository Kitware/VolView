import { describe, expect, it } from 'vitest';
import type { Extent3D } from '@/src/segmentation/geometry';
import {
  PLANE_LABEL_CAPACITY,
  composeSlice,
  createSliceScratch,
  slicePlaneExtent,
  type SliceMask,
} from '@/src/segmentation/rendering/sliceComposition';

const PARENT: Extent3D = [0, 9, 0, 9, 0, 9];

// A mask claiming every voxel of `extent`, unless `values` says otherwise.
const mask = (id: string, extent: Extent3D, values?: number[]): SliceMask => {
  const size =
    (extent[1] - extent[0] + 1) *
    (extent[3] - extent[2] + 1) *
    (extent[5] - extent[4] + 1);
  return {
    id,
    extent,
    scalars: Uint8Array.from(values ?? new Array(size).fill(1)),
  };
};

const rows = (values: Uint8Array, width: number) =>
  Array.from({ length: values.length / width }, (_, row) =>
    Array.from(values.subarray(row * width, (row + 1) * width))
  );

describe('slicePlaneExtent', () => {
  it('pads the union of the reaching masks by one voxel in plane', () => {
    expect(
      slicePlaneExtent(
        [
          [2, 3, 2, 2, 4, 6],
          [5, 5, 6, 7, 5, 5],
        ],
        PARENT,
        2,
        5
      )
    ).toEqual([1, 6, 1, 8, 5, 5]);
  });

  it('ignores masks the slice misses and empty masks', () => {
    expect(
      slicePlaneExtent(
        [
          [2, 2, 2, 2, 4, 4],
          [7, 7, 7, 7, 5, 5],
          [0, -1, 0, -1, 0, -1],
        ],
        PARENT,
        2,
        5
      )
    ).toEqual([6, 8, 6, 8, 5, 5]);
  });

  it('is null when no mask reaches the slice', () => {
    expect(slicePlaneExtent([[2, 2, 2, 2, 4, 4]], PARENT, 2, 5)).toBeNull();
    expect(slicePlaneExtent([], PARENT, 2, 5)).toBeNull();
  });

  it.each([0, 1, 2])('stops padding at the scan on axis %i', (axis) => {
    const extent: Extent3D = [0, 9, 0, 9, 0, 9];
    extent[axis * 2] = 3;
    extent[axis * 2 + 1] = 3;
    const expected: Extent3D = [0, 9, 0, 9, 0, 9];
    expected[axis * 2] = 3;
    expected[axis * 2 + 1] = 3;
    expect(slicePlaneExtent([extent], PARENT, axis, 3)).toEqual(expected);
  });

  it('rounds a fractional slice to the voxel it shows', () => {
    expect(slicePlaneExtent([[4, 4, 4, 4, 4, 4]], PARENT, 0, 3.6)).toEqual([
      4, 4, 3, 5, 3, 5,
    ]);
  });
});

describe('composeSlice', () => {
  const plane: Extent3D = [0, 3, 0, 2, 0, 0];

  it('labels masks that do not overlap in one plane, in order', () => {
    const planes = composeSlice(
      [mask('a', [0, 1, 0, 0, 0, 0]), mask('b', [2, 3, 1, 2, 0, 0])],
      plane
    );

    expect(planes.map((entry) => entry.segmentIds)).toEqual([['a', 'b']]);
    expect(rows(planes[0].values, 4)).toEqual([
      [1, 1, 0, 0],
      [0, 0, 2, 2],
      [0, 0, 2, 2],
    ]);
  });

  it('moves a mask that overlaps a claimed pixel to the next plane', () => {
    const planes = composeSlice(
      [
        mask('a', [0, 1, 0, 0, 0, 0]),
        mask('b', [1, 2, 0, 0, 0, 0]),
        mask('c', [3, 3, 0, 2, 0, 0]),
      ],
      plane
    );

    expect(planes.map((entry) => entry.segmentIds)).toEqual([
      ['a', 'c'],
      ['b'],
    ]);
    expect(rows(planes[0].values, 4)).toEqual([
      [1, 1, 0, 2],
      [0, 0, 0, 2],
      [0, 0, 0, 2],
    ]);
    expect(rows(planes[1].values, 4)).toEqual([
      [0, 1, 1, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
  });

  it('lets boxes overlap when the claimed pixels do not', () => {
    const planes = composeSlice(
      [
        mask('a', [0, 1, 0, 0, 0, 0], [1, 0]),
        mask('b', [0, 1, 0, 0, 0, 0], [0, 1]),
      ],
      plane
    );

    expect(planes.map((entry) => entry.segmentIds)).toEqual([['a', 'b']]);
    expect(rows(planes[0].values, 4)[0]).toEqual([1, 2, 0, 0]);
  });

  it('writes only the slice the plane is on', () => {
    const planes = composeSlice(
      [mask('a', [1, 1, 1, 1, 0, 1], [0, 1])],
      [0, 2, 0, 2, 1, 1]
    );

    expect(rows(planes[0].values, 3)).toEqual([
      [0, 0, 0],
      [0, 1, 0],
      [0, 0, 0],
    ]);
  });

  it('writes a sagittal plane in j, k order', () => {
    const planes = composeSlice(
      [mask('a', [2, 2, 0, 1, 1, 1], [1, 0])],
      [2, 2, 0, 1, 0, 1]
    );

    expect(Array.from(planes[0].values)).toEqual([0, 0, 1, 0]);
  });

  it('gives no label to a mask with nothing on this plane', () => {
    const planes = composeSlice(
      [mask('empty', [0, 0, 0, 0, 0, 0], [0]), mask('a', [1, 1, 0, 0, 0, 0])],
      plane
    );

    expect(planes.map((entry) => entry.segmentIds)).toEqual([['a']]);
    expect(rows(planes[0].values, 4)[0]).toEqual([0, 1, 0, 0]);
  });

  it('composes nothing from no masks', () => {
    expect(composeSlice([], plane)).toEqual([]);
  });

  it('opens another plane past the byte label capacity', () => {
    const wide: Extent3D = [0, PLANE_LABEL_CAPACITY, 0, 0, 0, 0];
    const masks = Array.from({ length: PLANE_LABEL_CAPACITY + 1 }, (_, i) =>
      mask(`${i}`, [i, i, 0, 0, 0, 0])
    );

    const planes = composeSlice(masks, wide);

    expect(planes.map((entry) => entry.segmentIds.length)).toEqual([
      PLANE_LABEL_CAPACITY,
      1,
    ]);
    expect(planes[0].values[PLANE_LABEL_CAPACITY - 1]).toBe(
      PLANE_LABEL_CAPACITY
    );
    expect(planes[1].values[PLANE_LABEL_CAPACITY]).toBe(1);
  });

  it('stacks masks that all claim one pixel past 32 planes, in order', () => {
    const masks = Array.from({ length: 40 }, (_, i) =>
      mask(`${i}`, [1, 1, 1, 1, 0, 0])
    );

    const planes = composeSlice(masks, plane);

    expect(planes.map((entry) => entry.segmentIds)).toEqual(
      masks.map(({ id }) => [id])
    );
    expect(planes.every(({ values }) => values[5] === 1)).toBe(true);
  });

  it('clears and writes into reused buffers of the right size', () => {
    const first = composeSlice([mask('a', [0, 0, 0, 0, 0, 0])], plane);
    const reused = first[0].values;

    const second = composeSlice([mask('b', [3, 3, 2, 2, 0, 0])], plane, [
      reused,
    ]);

    expect(second[0].values).toBe(reused);
    expect(rows(reused, 4)).toEqual([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 1],
    ]);
  });

  it('allocates instead of reusing a buffer of another size', () => {
    const small = new Uint8Array(2);

    const [composed] = composeSlice([mask('a', [0, 0, 0, 0, 0, 0])], plane, [
      small,
    ]);

    expect(composed.values).not.toBe(small);
    expect(composed.values).toHaveLength(12);
  });

  it('composes the same with scratch left by another composition', () => {
    const scratch = createSliceScratch();
    const masks = [
      mask('a', [0, 1, 0, 0, 0, 0]),
      mask('b', [1, 3, 0, 2, 0, 0]),
    ];
    composeSlice(
      [mask('full', plane), mask('over', plane)],
      plane,
      [],
      scratch
    );

    expect(composeSlice(masks, plane, [], scratch)).toEqual(
      composeSlice(masks, plane)
    );
  });

  it('leaves the masks untouched', () => {
    const source = mask('a', [0, 1, 0, 0, 0, 0]);

    composeSlice([source], plane)[0].values.fill(9);

    expect(Array.from(source.scalars)).toEqual([1, 1]);
  });
});
