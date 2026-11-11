import { describe, expect, it } from 'vitest';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkLabelMap from '@/src/vtk/LabelMap';
import type { Extent3D } from '@/src/segmentation/geometry';
import { boundScalars, masksClearing } from '@/src/segmentation/masks/overlap';
import { createMaskSnapshot } from '../maskSnapshot';
import {
  createOccupiedDepthSession,
  measureOccupiedDepth,
  type OccupiedDepthInput,
} from '../occupiedDepth';

function fixture() {
  const image = vtkLabelMap.newInstance();
  const mask: OccupiedDepthInput['mask'] = {
    values: new Uint8Array(3 * 4 * 2),
    dimensions: [3, 4, 2],
    extent: [2, 4, 1, 4, 0, 1],
  };
  image
    .getPointData()
    .setScalars(vtkDataArray.newInstance({ values: mask.values }));
  const snapshot = createMaskSnapshot(image);
  const worker = createOccupiedDepthSession();
  const slab = { dimensions: [7, 6, 3], axis: 1 as const, first: 0, last: 5 };
  const check = (force = false) => {
    const result = worker(slab, snapshot.take(mask, force));
    expect(result).toEqual(measureOccupiedDepth({ ...slab, mask }));
    return result;
  };
  const dispose = () => {
    snapshot.dispose();
    image.getPointData().getScalars().delete();
    image.delete();
  };
  return { image, mask, snapshot, worker, slab, check, dispose };
}

describe('occupied-depth voxel updates', () => {
  it('keeps edits from every skipped request and leaves prior results intact', () => {
    const state = fixture();
    try {
      const original = state.check();
      state.mask.values[0] = 1;
      state.image.modifiedWithin([2, 2, 1, 1, 0, 0]);
      state.mask.values[23] = 1;
      state.image.modifiedWithin([4, 4, 4, 4, 1, 1]);
      expect(state.check().maximumCount).toBe(1);
      state.mask.values[0] = 0;
      state.image.modifiedWithin([2, 2, 1, 1, 0, 0]);
      expect(state.check().counts.filter(Boolean)).toHaveLength(1);
      expect(original.maximumCount).toBe(0);
      expect(original.counts.every((value) => value === 0)).toBe(true);
    } finally {
      state.dispose();
    }
  });

  it('publishes arbitrary image and scalar writes alongside later bounded edits', () => {
    const state = fixture();
    try {
      state.check();
      state.mask.values.fill(1);
      state.image.modified();
      state.mask.values[0] = 0;
      state.image.modifiedWithin([2, 2, 1, 1, 0, 0]);
      expect(state.check().maximumCount).toBe(4);
      state.mask.values.fill(0);
      state.image.getPointData().getScalars().dataChange();
      expect(state.check().maximumCount).toBe(0);
    } finally {
      state.dispose();
    }
  });

  it('replaces grown storage and initializes a restarted worker with current voxels', () => {
    const state = fixture();
    try {
      state.check();
      state.mask.values = new Uint8Array(4 * 5 * 2).fill(1);
      state.mask.dimensions = [4, 5, 2];
      state.mask.extent = [1, 4, 0, 4, 0, 1];
      state.image.getPointData().getScalars().setData(state.mask.values);
      state.image.modifiedWithin([1, 1, 0, 0, 0, 0]);
      expect(state.check().maximumCount).toBe(5);
      const restarted = createOccupiedDepthSession();
      const result = restarted(
        state.slab,
        state.snapshot.take(state.mask, true)
      );
      expect(result).toEqual(
        measureOccupiedDepth({ ...state.slab, mask: state.mask })
      );
    } finally {
      state.dispose();
    }
  });

  it('keeps independent consumers current when one measures less often', () => {
    const state = fixture();
    const slower = createMaskSnapshot(state.image);
    const secondWorker = createOccupiedDepthSession();
    try {
      state.check();
      secondWorker(state.slab, slower.take(state.mask));
      state.mask.values[0] = 1;
      state.image.modifiedWithin([2, 2, 1, 1, 0, 0]);
      state.check();
      state.mask.values[1] = 1;
      state.image.modifiedWithin([3, 3, 1, 1, 0, 0]);
      state.check();
      expect(secondWorker(state.slab, slower.take(state.mask))).toEqual(
        measureOccupiedDepth({ ...state.slab, mask: state.mask })
      );
    } finally {
      slower.dispose();
      state.dispose();
    }
  });

  it('measures neighbor erasures whose dirty boxes overhang a nonzero mask extent', () => {
    const state = fixture();
    const slower = createMaskSnapshot(state.image);
    const secondWorker = createOccupiedDepthSession();
    const neighbor = boundScalars({
      image: state.image,
      extent: [...state.mask.extent] as Extent3D,
    })!;
    const clear = (within: Extent3D, point: [number, number, number]) => {
      const clearing = masksClearing([neighbor], within)!;
      try {
        clearing.clear(...point);
      } finally {
        clearing.finish();
      }
    };
    try {
      state.mask.values.fill(1);
      state.check();
      secondWorker(state.slab, slower.take(state.mask));

      clear([0, 2, 0, 2, -1, 0], [2, 1, 0]);
      expect(state.check().counts).toEqual(
        new Uint32Array([
          0, 0, 3, 4, 4, 0, 0, 0, 0, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ])
      );

      clear([4, 6, 3, 6, 1, 2], [4, 4, 1]);
      const expected = new Uint32Array([
        0, 0, 3, 4, 4, 0, 0, 0, 0, 4, 4, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ]);
      expect(state.check().counts).toEqual(expected);
      expect(secondWorker(state.slab, slower.take(state.mask)).counts).toEqual(
        expected
      );
    } finally {
      slower.dispose();
      state.dispose();
    }
  });
});
