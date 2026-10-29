import { describe, expect, it } from 'vitest';
import {
  createOccupiedDepthMeasurer,
  measureOccupiedDepth,
  type OccupiedDepthInput,
} from '../occupiedDepth';

function gappedColumn(): OccupiedDepthInput {
  const values = new Uint8Array(2 * 6 * 2);
  for (const depth of [0, 1, 4, 5]) values[2 * depth] = 1;
  return {
    dimensions: [2, 6, 2],
    axis: 1,
    first: 0,
    last: 5,
    mask: { values, dimensions: [2, 6, 2], extent: [0, 1, 0, 5, 0, 1] },
  };
}

describe('selected-slab occupied depth', () => {
  it.each([
    [0, 5, 4],
    [1, 4, 2],
    [2, 3, 0],
    [1, 1, 1],
  ])('counts slab %i..%i without filling gaps', (first, last, count) => {
    const field = measureOccupiedDepth({ ...gappedColumn(), first, last });
    expect(Array.from(field.counts)).toEqual([count, 0, 0, 0]);
    expect(Array.from(field.known)).toEqual([1, 1, 1, 1]);
    expect(field.maximumCount).toBe(count);
  });

  it('marks only occupied invalid support inside the chosen slab as unknown', () => {
    const input = gappedColumn();
    input.validity = {
      values: new Uint8Array(24).fill(1),
      extent: [0, 1, 0, 5, 0, 1],
    };
    input.validity.values[8] = 0;
    input.validity.values[2 * 2] = 0;
    const full = measureOccupiedDepth(input);
    expect(Array.from(full.known)).toEqual([0, 1, 1, 1]);
    expect(full.maximumCount).toBe(0);
    const clipped = measureOccupiedDepth({ ...input, first: 0, last: 3 });
    expect(Array.from(clipped.counts)).toEqual([2, 0, 0, 0]);
    expect(Array.from(clipped.known)).toEqual([1, 1, 1, 1]);
  });

  it.each([0, 1, 2] as const)(
    'maps a nonzero cropped extent on axis %i',
    (axis) => {
      const field = measureOccupiedDepth({
        dimensions: [5, 6, 7],
        axis,
        first: 0,
        last: [4, 5, 6][axis],
        mask: {
          values: new Uint8Array(27).fill(1),
          dimensions: [3, 3, 3],
          extent: [1, 3, 2, 4, 3, 5],
        },
      });
      const expectedSizes = [
        [6, 7],
        [5, 7],
        [5, 6],
      ];
      const expectedCorner = [
        [2, 3],
        [1, 3],
        [1, 2],
      ][axis];
      expect([field.width, field.height]).toEqual(expectedSizes[axis]);
      const present = Array.from(field.counts.entries()).filter(
        ([, count]) => count > 0
      );
      expect(present).toHaveLength(9);
      expect(present[0]).toEqual([
        expectedCorner[0] + field.width * expectedCorner[1],
        3,
      ]);
      expect(field.maximumCount).toBe(3);
    }
  );

  it('includes mask voxels when the slab midpoint lies outside the crop', () => {
    const field = measureOccupiedDepth({
      dimensions: [2, 20, 2],
      axis: 1,
      first: 0,
      last: 19,
      mask: {
        values: new Uint8Array([1, 1]),
        dimensions: [1, 2, 1],
        extent: [1, 1, 1, 2, 1, 1],
      },
    });
    expect(Array.from(field.counts)).toEqual([0, 0, 0, 2]);
  });

  it.each([0, 1, 2] as const)(
    'attributes unavailable occupied support to its displayed column on axis %i',
    (axis) => {
      const validity = new Uint8Array(5 * 6 * 7).fill(1);
      validity[137] = 0;
      const field = measureOccupiedDepth({
        dimensions: [5, 6, 7],
        axis,
        first: 0,
        last: [4, 5, 6][axis],
        validity: { values: validity, extent: [0, 4, 0, 5, 0, 6] },
        mask: {
          values: new Uint8Array(27).fill(1),
          dimensions: [3, 3, 3],
          extent: [1, 3, 2, 4, 3, 5],
        },
      });
      const missingColumn = [27, 22, 17][axis];
      expect(field.known[missingColumn]).toBe(0);
      expect(field.counts[missingColumn]).toBe(0);
      expect(field.known.filter((known) => !known)).toHaveLength(1);
      expect(field.maximumCount).toBe(3);
    }
  );

  it.each([0, 1, 2] as const)(
    'maps bounded source validity for a cropped slab on axis %i',
    (axis) => {
      const extent = [1, 3, 2, 4, 3, 5];
      const slab = [2, 3, 4][axis];
      const supportExtent = [...extent];
      supportExtent[2 * axis] = slab;
      supportExtent[2 * axis + 1] = slab;
      const values = new Uint8Array(9).fill(1);
      values[4] = 0;
      const field = measureOccupiedDepth({
        dimensions: [5, 6, 7],
        axis,
        first: slab,
        last: slab,
        validity: { values, extent: supportExtent },
        mask: {
          values: new Uint8Array(27).fill(1),
          dimensions: [3, 3, 3],
          extent,
        },
      });
      const missingColumn = [27, 22, 17][axis];
      expect(field.known[missingColumn]).toBe(0);
      expect(field.counts.filter((count) => count === 1)).toHaveLength(8);
      expect(field.known.filter((known) => !known)).toHaveLength(1);
      expect(field.maximumCount).toBe(1);
    }
  );

  it('rejects malformed or nonbinary masks instead of treating them as empty', () => {
    const input = gappedColumn();
    input.mask.values[0] = 2;
    expect(() => measureOccupiedDepth(input)).toThrow('binary mask');
    expect(() =>
      measureOccupiedDepth({ ...gappedColumn(), first: -1 })
    ).toThrow('inclusive source range');
    expect(() =>
      measureOccupiedDepth({
        ...gappedColumn(),
        validity: { values: new Uint8Array(1), extent: [0, 1, 0, 5, 0, 1] },
      })
    ).toThrow('validity');
  });

  it('reuses a prepared mask across clipped slabs without changing prior results', () => {
    const { mask, ...slab } = gappedColumn();
    const measure = createOccupiedDepthMeasurer(mask);
    const full = measure(slab);
    const clipped = measure({ ...slab, first: 1, last: 4 });
    expect(Array.from(clipped.counts)).toEqual([2, 0, 0, 0]);
    expect(Array.from(full.counts)).toEqual([4, 0, 0, 0]);
    expect(full.maximumCount).toBe(4);
    expect(clipped.maximumCount).toBe(2);
  });

  it('applies current source validity on every prepared measurement', () => {
    const { mask, ...slab } = gappedColumn();
    const measure = createOccupiedDepthMeasurer(mask);
    const validity = new Uint8Array(24).fill(1);
    validity[0] = 0;
    const unknown = measure({
      ...slab,
      validity: { values: validity, extent: [0, 1, 0, 5, 0, 1] },
    });
    expect(Array.from(unknown.known)).toEqual([0, 1, 1, 1]);
    expect(unknown.maximumCount).toBe(0);
    expect(measure(slab).maximumCount).toBe(4);
  });

  it('validates each source grid and slab after preparing the mask', () => {
    const { mask, ...slab } = gappedColumn();
    const measure = createOccupiedDepthMeasurer(mask);
    expect(measure(slab).maximumCount).toBe(4);
    expect(() => measure({ ...slab, dimensions: [1, 6, 2] })).toThrow(
      'align with the source'
    );
    expect(() => measure({ ...slab, last: 6 })).toThrow(
      'inclusive source range'
    );
    expect(() =>
      measure({
        ...slab,
        validity: { values: new Uint8Array(12), extent: [0, 1, 0, 5, 0, 1] },
      })
    ).toThrow('validity');
    expect(measure({ ...slab, first: 1, last: 1 }).maximumCount).toBe(1);
  });

  it('validates one-shot mask contents again after the same array is edited', () => {
    const input = gappedColumn();
    expect(measureOccupiedDepth(input).maximumCount).toBe(4);
    input.mask.values[0] = 2;
    expect(() => measureOccupiedDepth(input)).toThrow('binary mask');
  });

  it('rejects malformed prepared storage and one-shot crop geometry', () => {
    const input = gappedColumn();
    expect(() =>
      createOccupiedDepthMeasurer({
        ...input.mask,
        values: new Uint8Array(12),
      })
    ).toThrow('scalar count');
    expect(() =>
      measureOccupiedDepth({
        ...input,
        mask: { ...input.mask, extent: [0, 1, 0, 4, 0, 1] },
      })
    ).toThrow('align with the source');
  });
});
